import { getMaterialPriority } from './material-classification.js';
import { DEFAULT_WEIGHTS } from './subject-weights.js';
import { CONFIG } from '../config.js';

export const MAX_RAG_CHUNKS = CONFIG.rag.maxChunks;
export const RETRIEVAL_CANDIDATES = CONFIG.rag.retrievalCandidates;
export const MAX_CHUNKS_PER_SOURCE = CONFIG.rag.maxChunksPerSource;

export const MATERIAL_TYPE_WEIGHT = { ...DEFAULT_WEIGHTS };

export const MATERIAL_PRIORITY_WEIGHT = { ...CONFIG.materialPriorityWeights };

export function tokenize(text = '') {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(token => token.length > 3);
}

export function filterMatchesByTranscriptFocus(matches, transcriptFocus) {
    if (!matches) return matches;
    if (!transcriptFocus || !transcriptFocus.label) return matches;

    const keywords = tokenize(transcriptFocus.label).slice(0, 6);
    if (!keywords.length) return matches;

    const narrowed = matches.filter(match => {
        const text = String(match.metadata?.text || '').toLowerCase();
        return keywords.some(keyword => text.includes(keyword));
    });

    return narrowed.length > 0 ? narrowed : matches;
}

export function getMaterialWeight(materialType, customWeights) {
    const weights = customWeights || MATERIAL_TYPE_WEIGHT;
    return weights[materialType] || 1;
}

export function getPriorityWeight(materialPriority) {
    return MATERIAL_PRIORITY_WEIGHT[materialPriority] || 1;
}

export function resolveMaterialPriority(metadata, priorityMap = {}) {
    const safe = metadata || {};
    const materialId = safe.materialId;
    const override = (materialId && priorityMap[materialId]) || safe.materialPriority;
    return getMaterialPriority(safe.materialType, override);
}

export function rankMatches(matches = [], priorityMap = {}, materialWeights) {
    return [...matches]
        .map(match => {
            const materialType = match?.metadata?.materialType;
            const materialPriority = resolveMaterialPriority(match?.metadata, priorityMap);
            const baseScore = Number(match?.score || 0);
            const weightedScore = baseScore * getMaterialWeight(materialType, materialWeights) * getPriorityWeight(materialPriority);
            return {
                ...match,
                weightedScore,
            };
        })
        .sort((a, b) => b.weightedScore - a.weightedScore);
}

export function buildHybridContext(matches = [], maxChunks = MAX_RAG_CHUNKS, priorityMap = {}, materialWeights) {
    const ranked = rankMatches(matches, priorityMap, materialWeights);
    if (ranked.length <= maxChunks) return ranked;

    const selected = [];
    const selectedIds = new Set();
    const getMatchKey = (match, index) => match?.id || `${match?.metadata?.sourceFilename || 'unknown'}:${match?.metadata?.chunkIndex ?? index}`;

    const pickFirstByType = (type) => {
        const candidateIndex = ranked.findIndex((match, index) => {
            const key = getMatchKey(match, index);
            return match?.metadata?.materialType === type && !selectedIds.has(key);
        });
        const candidate = candidateIndex >= 0 ? ranked[candidateIndex] : null;
        if (!candidate) return;
        const candidateKey = getMatchKey(candidate, candidateIndex);
        selected.push(candidate);
        selectedIds.add(candidateKey);
    };

    pickFirstByType('notes');
    pickFirstByType('bibliography');

    for (const [index, match] of ranked.entries()) {
        if (selected.length >= maxChunks) break;
        const key = getMatchKey(match, index);
        if (selectedIds.has(key)) continue;
        selected.push(match);
        selectedIds.add(key);
    }

    return selected.slice(0, maxChunks);
}

export function diversifyBySourceFile(matches, maxPerFile = MAX_CHUNKS_PER_SOURCE, maxChunks = MAX_RAG_CHUNKS) {
    if (!Array.isArray(matches) || matches.length === 0) return [];

    const getSourceFile = (match) => match?.metadata?.sourceFilename ?? 'unknown';

    const fileBuckets = Object.create(null);
    const fileOrder = [];
    for (const match of matches) {
        const file = getSourceFile(match);
        if (!fileBuckets[file]) {
            fileBuckets[file] = [];
            fileOrder.push(file);
        }
        fileBuckets[file].push(match);
    }

    if (fileOrder.length <= 1) {
        return matches.slice(0, Math.min(maxChunks, maxPerFile));
    }

    const kept = [];
    const oversubscribed = Object.create(null);
    const oversubscribedOrder = [];

    for (const file of fileOrder) {
        const bucket = fileBuckets[file];
        if (bucket.length > maxPerFile) {
            kept.push(...bucket.slice(0, maxPerFile));
            oversubscribed[file] = bucket.slice(maxPerFile);
            oversubscribedOrder.push(file);
        } else {
            kept.push(...bucket);
        }
    }

    if (kept.length >= maxChunks) {
        return kept.slice(0, maxChunks);
    }

    const remaining = maxChunks - kept.length;
    let added = 0;
    while (added < remaining) {
        let madeProgress = false;
        for (const file of oversubscribedOrder) {
            if (added >= remaining) break;
            const extras = oversubscribed[file];
            if (extras.length > 0) {
                kept.push(extras.shift());
                added++;
                madeProgress = true;
            }
        }
        if (!madeProgress) break;
    }

    return kept;
}

export function resolveSourceMix(sources) {
    if (!sources || sources.length === 0) return 'none';

    const types = new Set(sources.map(s => s?.materialType).filter(Boolean));
    if (types.size === 0) return 'unknown';

    const hasNotes = types.has('notes');
    const hasBibliography = types.has('bibliography');
    const hasTranscript = types.has('transcript');
    const hasPresentation = types.has('presentation');
    const hasOther = [...types].some(t => !['notes', 'bibliography', 'transcript', 'presentation'].includes(t));

    if (hasNotes && hasBibliography && types.size === 2) return 'notes+bibliography';
    if (hasNotes && types.size === 1) return 'notes-only';
    if (hasBibliography && types.size === 1) return 'bibliography-only';
    if (hasTranscript && types.size === 1) return 'transcript-only';
    if (hasPresentation && types.size === 1) return 'presentation-only';
    if (hasOther) return 'mixed-other';

    return 'mixed-other';
}

export function resolveSelectedClassCount(classIds) {
    if (!classIds || classIds.length === 0 || classIds.includes('all')) return 0;
    return new Set(classIds.filter(id => id && id !== 'all')).size;
}

export function resolveFilterType(classIds) {
    if (!classIds || classIds.length === 0 || classIds.includes('all')) {
        return 'subject-only';
    }
    const unique = new Set(classIds.filter(id => id && id !== 'all'));
    if (unique.size === 0) return 'subject-only';
    return unique.size === 1 ? 'exact-classId' : 'multi-classIds';
}
