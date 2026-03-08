/**
 * services/parser.js — Extracción de texto y chunking
 * Soporta: TXT, VTT, DOCX, PDF, PPTX (básico)
 */
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import AdmZip from 'adm-zip';

// Tokens aproximados: 1 token ≈ 4 caracteres en español/inglés
const CHARS_PER_TOKEN = 4;

/**
 * Extrae texto plano de un archivo según su MIME type.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename - usado como fallback para detectar tipo
 * @returns {Promise<string>}
 */
export async function parseFile(buffer, mimeType, filename = '') {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    // TXT / VTT / archivos de texto plano
    if (
        mimeType === 'text/plain' ||
        mimeType === 'text/vtt' ||
        ['txt', 'vtt', 'md'].includes(ext)
    ) {
        return cleanText(buffer.toString('utf-8'));
    }

    // DOCX — Microsoft Word
    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === 'docx'
    ) {
        const result = await mammoth.extractRawText({ buffer });
        return cleanText(result.value);
    }

    // PDF
    if (mimeType === 'application/pdf' || ext === 'pdf') {
        const result = await pdfParse(buffer);
        return cleanText(result.text);
    }

    // PPTX — extracción básica desde XML interno
    if (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        ext === 'pptx'
    ) {
        return extractPptxText(buffer);
    }

    throw new Error(`Tipo de archivo no soportado: ${mimeType || ext}`);
}

/**
 * Divide un texto en chunks de tamaño máximo con solapamiento.
 * @param {string} text - texto completo
 * @param {number} maxTokens - tamaño máximo del chunk en tokens
 * @param {number} overlapTokens - solapamiento entre chunks en tokens
 * @returns {string[]}
 */
export function chunkText(text, maxTokens = 512, overlapTokens = 50) {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    const overlapChars = overlapTokens * CHARS_PER_TOKEN;
    const chunks = [];

    // Dividir primero por párrafos para no cortar en medio de ideas
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
        const candidate = currentChunk
            ? `${currentChunk}\n\n${paragraph}`
            : paragraph;

        if (candidate.length <= maxChars) {
            currentChunk = candidate;
        } else {
            // El chunk actual está lleno: guardarlo
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                // Solapamiento: llevar el final del chunk actual como inicio del siguiente
                const overlapText = currentChunk.slice(-overlapChars);
                currentChunk = `${overlapText}\n\n${paragraph}`;
            } else {
                // Párrafo más grande que maxChars: fragmentar por oraciones
                const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
                for (const sentence of sentences) {
                    if ((currentChunk + sentence).length <= maxChars) {
                        currentChunk += sentence;
                    } else {
                        if (currentChunk) chunks.push(currentChunk.trim());
                        currentChunk = sentence;
                    }
                }
            }
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks.filter(c => c.length > 20); // descartar chunks muy cortos
}

// ─── Helpers privados ────────────────────────────────────────────

function cleanText(text) {
    return text
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
            .sort((a, b) => a.entryName.localeCompare(b.entryName));

        const texts = slideEntries.map((entry, index) => {
            const xml = entry.getData().toString('utf-8');
            // Extraer texto de tags <a:t> (texto de párrafos en OOXML)
            const matches = [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)];
            const slideText = matches.map(m => m[1]).join(' ').trim();
            return slideText ? `[Diapositiva ${index + 1}]\n${slideText}` : null;
        });

        return cleanText(texts.filter(Boolean).join('\n\n'));
    } catch (err) {
        throw new Error(`Error parseando PPTX: ${err.message}`);
    }
}
