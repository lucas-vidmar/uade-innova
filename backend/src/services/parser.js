/**
 * services/parser.js — Extracción de texto y chunking
 * Soporta: TXT, VTT, DOCX, PDF, PPTX (básico)
 */
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import AdmZip from 'adm-zip';
import { getEncoding } from 'js-tiktoken';

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

    // TXT / VTT / archivos de texto plano
    if (
        mimeType === 'text/plain' ||
        mimeType === 'text/vtt' ||
        ['txt', 'vtt', 'md'].includes(ext)
    ) {
        rawText = buffer.toString('utf-8');
        // Si es VTT, limpiamos timestamps/metadatos (US #34)
        if (mimeType === 'text/vtt' || ext === 'vtt') {
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
    // PDF
    else if (mimeType === 'application/pdf' || ext === 'pdf') {
        const result = await pdfParse(buffer);
        rawText = result.text;
    }
    // PPTX — extracción básica desde XML interno
    else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        ext === 'pptx'
    ) {
        rawText = extractPptxText(buffer);
    } else {
        throw new Error(`Tipo de archivo no soportado: ${mimeType || ext}`);
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
    return text
        // Eliminar cabecera WEBVTT y notas
        .replace(/^WEBVTT.*?\n/gi, '')
        .replace(/NOTE .*?\n/gi, '')
        // Eliminar timestamps (00:00:00.000 --> 00:00:00.000)
        .replace(/\d{2}:\d{2}:\d{2}.\d{3} --> \d{2}:\d{2}:\d{2}.\d{3}/g, '')
        // Eliminar identificadores de línea (números solos antes del timestamp)
        .replace(/^\d+$/gm, '')
        // Eliminar estilos/posicionamiento opcional (<v ...>, align:start, etc.)
        .replace(/<v [^>]+>/g, '')
        .replace(/<\/v>/g, '')
        .replace(/align:(start|middle|end)/g, '')
        .replace(/position:\d+%/g, '');
}

// ─── Helpers privados ────────────────────────────────────────────

function cleanText(text) {
    if (!text) return '';
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
