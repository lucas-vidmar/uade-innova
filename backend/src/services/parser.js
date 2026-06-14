/**
 * services/parser.js — Extracción de texto y chunking
 * Soporta: TXT, VTT, DOCX, PDF, PPTX (básico)
 */
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import AdmZip from 'adm-zip';
import { getEncoding } from 'js-tiktoken';
import { CategorizedError, ErrorCategory } from './error-categories.js';

// Usar el encoding estándar de OpenAI (GPT-4)
const encoder = getEncoding('cl100k_base');

/**
 * Extrae texto plano de un archivo según su MIME type.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename - usado como fallback para detectar tipo
 * @returns {Promise<string>}
 */
export async function parseFile(buffer, mimeType, filename = '') {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    let rawText = '';

    // TXT / VTT / SRT / archivos de texto plano
    if (
        mimeType === 'text/plain' ||
        mimeType === 'text/vtt' ||
        mimeType === 'application/x-subrip' ||
        mimeType === 'text/srt' ||
        ['txt', 'vtt', 'srt', 'md'].includes(ext)
    ) {
        rawText = buffer.toString('utf-8');
        // Si es VTT/SRT, limpiamos timestamps/metadatos y speakers (US #34)
        if (
            mimeType === 'text/vtt' ||
            mimeType === 'application/x-subrip' ||
            mimeType === 'text/srt' ||
            ext === 'vtt' ||
            ext === 'srt'
        ) {
            rawText = cleanTranscript(rawText);
        }
    }
    // DOCX — Microsoft Word
    else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === 'docx'
    ) {
        const result = await mammoth.extractRawText({ buffer });
        rawText = result.value;
    }
    // PDF - Resilient parsing with page markers (US #29)
    else if (mimeType === 'application/pdf' || ext === 'pdf') {
        try {
            const options = {
                // Custom pagerender to inject [Página X] markers
                pagerender: function(pageData) {
                    return pageData.getTextContent().then(function(textContent) {
                        let lastY, text = '';
                        for (let item of textContent.items) {
                            if (lastY !== undefined && lastY !== item.transform[5]) {
                                text += '\n';
                            }
                            text += item.str;
                            lastY = item.transform[5];
                        }
                        return `\n\n[Página ${pageData.pageIndex + 1}]\n\n${text}`;
                    });
                }
            };
            const result = await pdfParse(buffer, options);
            rawText = result.text;
        } catch (err) {
            console.error(`[Parser] Error parseando PDF ${filename}:`, err);
            throw new CategorizedError(`Error al procesar el PDF: ${err.message}. Asegúrese de que no esté protegido por contraseña.`, {
                errorCategory: ErrorCategory.PARSING,
                code: err?.code || 'PDF_PARSE_ERROR',
                status: 400,
                details: { filename, mimeType },
                cause: err,
            });
        }
    }
    // PPTX — extracción básica desde XML interno
    else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        ext === 'pptx'
    ) {
        rawText = extractPptxText(buffer);
    } else {
        throw new CategorizedError(`Tipo de archivo no soportado: ${mimeType || ext}`, {
            errorCategory: ErrorCategory.PARSING,
            code: 'UNSUPPORTED_FILE_TYPE',
            status: 400,
            details: { mimeType, ext, filename },
        });
    }

    return cleanText(rawText);
}

/**
 * Divide un texto en chunks de tamaño máximo con solapamiento usando tokens reales.
 * @param {string} text - texto completo
 * @param {number} maxTokens - tamaño máximo del chunk en tokens (default 512)
 * @param {number} overlapTokens - solapamiento entre chunks en tokens (default 50)
 * @returns {string[]}
 */
export function chunkText(text, maxTokens = 512, overlapTokens = 50) {
    if (!text || text.trim().length === 0) return [];

    const tokens = encoder.encode(text);
    const chunks = [];
    
    // Si el texto es más corto que maxTokens, devolverlo entero
    if (tokens.length <= maxTokens) {
        return [text];
    }

    const step = maxTokens - overlapTokens;
    
    for (let i = 0; i < tokens.length; i += step) {
        const end = Math.min(i + maxTokens, tokens.length);
        const chunkTokens = tokens.slice(i, end);
        const decoded = encoder.decode(chunkTokens);
        
        if (decoded.trim().length > 10) {
            chunks.push(decoded.trim());
        }
        
        // Evitaremos loops infinitos si step es 0 o negativo por error de params
        if (end === tokens.length) break;
    }

    return chunks;
}

/**
 * Limpia transcripciones VTT eliminando timestamps y ruido de formato.
 * @param {string} text 
 * @returns {string}
 */
export function cleanTranscript(text) {
    const timestampLinePattern = /^(?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{3}(?:\s+.*)?$/i;
    const speakerPrefixPattern = /^\s*(?:\[[^\]]+\]|SPEAKER[_\-\s]?\d{1,3}|[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ.'-]{1,30}(?:\s+[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ.'-]{1,30}){0,2})\s*:\s*/;

    const normalized = text
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

    const lines = normalized.split('\n');
    const cleanedLines = [];
    let skipMetadataBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed) {
            skipMetadataBlock = false;
            continue;
        }

        if (/^(NOTE|STYLE|REGION)\b/i.test(trimmed)) {
            skipMetadataBlock = true;
            continue;
        }

        if (skipMetadataBlock) continue;
        if (/^WEBVTT\b/i.test(trimmed)) continue;
        if (/^\d+$/.test(trimmed)) continue; // índice típico de SRT
        if (timestampLinePattern.test(trimmed)) continue;

        const withoutTags = trimmed
            .replace(/<v [^>]+>/gi, '')
            .replace(/<\/v>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const withoutSpeaker = withoutTags.replace(speakerPrefixPattern, '').trim();
        if (!withoutSpeaker) continue;

        cleanedLines.push(withoutSpeaker);
    }

    return cleanedLines.join('\n');
}

/**
 * Extrae secciones temporales y hit-points desde una transcripción VTT/TXT.
 * Para VTT usa timestamps reales; para TXT genera secciones por párrafo.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename
 * @returns {{sections: Array<object>, markers: Array<object>}}
 */
export function extractTranscriptTimeline(buffer, mimeType = '', filename = '') {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const rawText = buffer.toString('utf-8');
    const isVtt = mimeType === 'text/vtt' || ext === 'vtt';

    if (isVtt) {
        const cueRegex = /(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})([^\n]*\n)((?:.+(?:\n|$))+?)(?=\n\d{2}:\d{2}:\d{2}\.\d{3}\s+-->|$)/g;
        const sections = [];
        let match;
        let index = 0;

        while ((match = cueRegex.exec(rawText)) !== null) {
            const start = timestampToSeconds(match[1]);
            const end = timestampToSeconds(match[2]);
            const text = cleanText(
                (match[4] || '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\n+/g, ' ')
            );

            if (!text) continue;

            sections.push({
                id: `sec-${String(index + 1).padStart(3, '0')}`,
                startSecond: start,
                endSecond: end,
                timestampLabel: formatSeconds(start),
                text,
            });
            index += 1;
        }

        const markers = sections
            .filter((section, idx) => idx % 6 === 0)
            .slice(0, 12)
            .map((section, idx) => ({
                id: `mk-${String(idx + 1).padStart(3, '0')}`,
                sectionId: section.id,
                startSecond: section.startSecond,
                endSecond: section.endSecond,
                iconType: idx % 2 === 0 ? 'question' : 'assignment',
                label: section.text.slice(0, 72),
                source: 'auto',
            }));

        return { sections, markers };
    }

    const paragraphSections = cleanText(rawText)
        .split(/\n\n+/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
        .slice(0, 40)
        .map((text, idx) => ({
            id: `sec-${String(idx + 1).padStart(3, '0')}`,
            startSecond: idx * 60,
            endSecond: idx * 60 + 59,
            timestampLabel: `Bloque ${idx + 1}`,
            text,
        }));

    const markers = paragraphSections
        .filter((section, idx) => idx % 4 === 0)
        .slice(0, 10)
        .map((section, idx) => ({
            id: `mk-${String(idx + 1).padStart(3, '0')}`,
            sectionId: section.id,
            startSecond: section.startSecond,
            endSecond: section.endSecond,
            iconType: idx % 2 === 0 ? 'question' : 'assignment',
            label: section.text.slice(0, 72),
            source: 'auto',
        }));

    return { sections: paragraphSections, markers };
}

function timestampToSeconds(value) {
    const [hh, mm, ssMs] = value.split(':');
    const [ss, ms] = ssMs.split('.');
    return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

function formatSeconds(seconds) {
    const whole = Math.floor(seconds);
    const hh = String(Math.floor(whole / 3600)).padStart(2, '0');
    const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
    const ss = String(whole % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

// ─── Helpers privados ────────────────────────────────────────────

/**
 * Limpia ruido común de texto y normaliza espaciado.
 * @param {string} text 
 * @returns {string}
 */
export function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/\u00AD/g, '')           // eliminar soft hyphens (comunes en PDF)
        .replace(/\u2010/g, '-')          // normalizar guiones
        .replace(/\r\n/g, '\n')           // normalizar line breaks
        .replace(/\t/g, ' ')              // tabs a espacios
        .replace(/ {2,}/g, ' ')          // múltiples espacios
        .replace(/\n{3,}/g, '\n\n')      // máximo 2 line breaks seguidos
        .trim();
}

function extractPptxText(buffer) {
    try {
        const zip = new AdmZip(buffer);
        const slideEntries = zip
            .getEntries()
            .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
            .sort((a, b) => extractSlideNumber(a.entryName) - extractSlideNumber(b.entryName));

        const texts = slideEntries.map((entry, index) => {
            const xml = entry.getData().toString('utf-8');
            // Extraer texto de tags <a:t> (texto de párrafos en OOXML)
            const matches = [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)];
            const slideText = cleanText(matches.map(m => decodeXmlEntities(m[1])).join(' ').trim());
            const slideTag = `[Diapositiva ${index + 1}]`;
            // Mantener separación por diapositiva incluso si no hay texto.
            return slideText ? `${slideTag}\n${slideText}` : slideTag;
        });

        return cleanText(texts.join('\n\n'));
    } catch (err) {
        throw new CategorizedError(`Error parseando PPTX: ${err.message}`, {
            errorCategory: ErrorCategory.PARSING,
            code: err?.code || 'PPTX_PARSE_ERROR',
            status: 400,
            cause: err,
        });
    }
}

/**
 * Extrae un mapping de { slideNumber: titleText } desde un buffer PPTX.
 * Detecta placeholders de título (type="title" o type="ctrTitle") en cada diapositiva.
 * Solo extrae texto del shape que contiene el placeholder de título, ignorando body text.
 * @param {Buffer} buffer - Buffer del archivo PPTX
 * @returns {object} - Mapa { slideNumber: titleText }
 */
export function extractPptxSlideTitles(buffer) {
    try {
        const zip = new AdmZip(buffer);
        const slideEntries = zip
            .getEntries()
            .filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/))
            .sort((a, b) => extractSlideNumber(a.entryName) - extractSlideNumber(b.entryName));

        const titleMap = {};
        slideEntries.forEach((entry, index) => {
            const xml = entry.getData().toString('utf-8');
            const slideNumber = index + 1;

            // Split into individual shapes (<p:sp ...>...</p:sp>)
            const shapeRegex = /<p:sp\b[^>]*>[\s\S]*?<\/p:sp>/gi;
            const shapes = [...xml.matchAll(shapeRegex)].map(m => m[0]);

            for (const shape of shapes) {
                const phRegex = /<p:ph\b([^>]*)>/i;
                const phMatch = shape.match(phRegex);
                if (!phMatch) continue;
                const phAttrs = phMatch[1];
                const phTypeMatch = phAttrs.match(/\btype=(?:"([^"]*)"|'([^']*)')/i);
                const phType = phTypeMatch?.[1] || phTypeMatch?.[2];
                const isTitle = !phType || phType === 'title' || phType === 'ctrTitle';
                if (!isTitle) continue;

                // Extract <a:t> text from the title shape only
                const aTextMatches = [...shape.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)];
                const titleText = aTextMatches
                    .map(m => decodeXmlEntities(m[1]))
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (titleText) {
                    titleMap[slideNumber] = titleText.slice(0, 256);
                }
                break; // Only one title per slide
            }
        });

        return titleMap;
    } catch (err) {
        throw new CategorizedError(`Error extrayendo titulos de PPTX: ${err.message}`, {
            errorCategory: ErrorCategory.PARSING,
            code: err?.code || 'PPTX_TITLE_EXTRACT_ERROR',
            status: 400,
            cause: err,
        });
    }
}

function extractSlideNumber(entryName = '') {
    const match = String(entryName).match(/slide(\d+)\.xml$/);
    return Number.parseInt(match?.[1] || '0', 10);
}

function decodeXmlEntities(text = '') {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'");
}
