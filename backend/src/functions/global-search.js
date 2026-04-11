/**
 * global-search.js — POST /api/global-search
 * Búsqueda global por materia sobre transcripciones y bibliografía.
 */
import { app } from '@azure/functions';
import { generateEmbedding } from '../services/openai.js';
import { querySimilar } from '../services/vector-store.js';
import { validateFrontDoorId } from '../services/auth-utils.js';
import { resolveCorrelationId, buildDependencyHeaders, withCorrelationResponseHeaders } from '../services/correlation.js';

const MAX_GLOBAL_RESULTS = 12;

function buildSnippet(text = '', query = '') {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return '';

    const queryLower = query.toLowerCase();
    const textLower = cleanText.toLowerCase();
    const matchIndex = textLower.indexOf(queryLower);
    const snippetRadius = 120;

    if (matchIndex < 0) {
        return cleanText.slice(0, 220);
    }

    const start = Math.max(0, matchIndex - snippetRadius);
    const end = Math.min(cleanText.length, matchIndex + query.length + snippetRadius);
    const prefix = start > 0 ? '... ' : '';
    const suffix = end < cleanText.length ? ' ...' : '';
    return `${prefix}${cleanText.slice(start, end)}${suffix}`;
}

function keywordFrequency(text = '', query = '') {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return 0;
    const regex = new RegExp(normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = String(text || '').match(regex);
    return matches ? matches.length : 0;
}

app.http('global-search', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'global-search',
    handler: async (request, context) => {
        const correlationId = resolveCorrelationId(request);
        const openAiHeaders = buildDependencyHeaders(correlationId);

        if (!validateFrontDoorId(request)) {
            return {
                status: 403,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }),
            };
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return {
                status: 400,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: 'Body JSON inválido' }),
            };
        }

        const query = typeof body.query === 'string' ? body.query.trim() : '';
        const subjectId = typeof body.subjectId === 'string' ? body.subjectId.trim() : '';

        if (!query || !subjectId) {
            return {
                status: 400,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: 'Faltan campos requeridos: query, subjectId' }),
            };
        }

        try {
            const { embedding } = await generateEmbedding(query, { headers: openAiHeaders });
            const filter = {
                subjectId: { $eq: subjectId },
                materialType: { $in: ['transcript', 'bibliography'] },
            };

            const matches = await querySimilar(embedding, filter, MAX_GLOBAL_RESULTS);
            const boostedResults = matches.map((match) => {
                const text = match.metadata?.text || '';
                const filename = match.metadata?.sourceFilename || '';
                const keywordHits = keywordFrequency(text, query) + keywordFrequency(filename, query);
                const semanticScore = Number(match.score || 0);
                const finalScore = semanticScore + Math.min(keywordHits * 0.04, 0.2);

                return {
                    materialId: match.metadata?.materialId,
                    classIds: match.metadata?.classIds || [],
                    materialType: match.metadata?.materialType,
                    materialPriority: match.metadata?.materialPriority || (match.metadata?.materialType === 'bibliography' ? 'secondary' : 'primary'),
                    sourceFilename: filename,
                    chunkIndex: match.metadata?.chunkIndex,
                    snippet: buildSnippet(text, query),
                    score: Number(finalScore.toFixed(4)),
                };
            });

            boostedResults.sort((a, b) => b.score - a.score);

            return {
                status: 200,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    query,
                    subjectId,
                    total: boostedResults.length,
                    results: boostedResults,
                }),
            };
        } catch (err) {
            context.error('Error en global-search:', err);
            return {
                status: 500,
                headers: withCorrelationResponseHeaders(correlationId, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ error: `Error buscando en índice global: ${err.message}` }),
            };
        }
    },
});
