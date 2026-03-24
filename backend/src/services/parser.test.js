import { test } from 'node:test';
import assert from 'node:assert';
import { chunkText, cleanTranscript, cleanText, extractTranscriptTimeline } from './parser.js';
import { getEncoding } from 'js-tiktoken';

const encoder = getEncoding('cl100k_base');

test('cleanTranscript removes VTT timestamps and headers', () => {
    const vtt = `WEBVTT
NOTE: This is a note

1
00:00:00.000 --> 00:00:02.000
Hola a todos.

2
00:00:02.000 --> 00:00:05.000
Bienvenidos a la clase.
`;
    const cleaned = cleanTranscript(vtt);
    assert.ok(!cleaned.includes('WEBVTT'));
    assert.ok(!cleaned.includes('00:00:00.000'));
    assert.ok(cleaned.includes('Hola a todos.'));
    assert.ok(cleaned.includes('Bienvenidos a la clase.'));
});

test('chunkText creates exact token-sized chunks with overlap', () => {
    const text = Array(50).fill('word').join(' ');
    const tokens = encoder.encode(text);
    const maxTokens = 20;
    const overlapTokens = 5;
    const chunks = chunkText(text, maxTokens, overlapTokens);
    const firstChunkTokens = encoder.encode(chunks[0]);
    assert.ok(firstChunkTokens.length <= maxTokens, `First chunk too large: ${firstChunkTokens.length}`);
    let totalChunkTokens = 0;
    chunks.forEach(c => totalChunkTokens += encoder.encode(c).length);
    assert.ok(totalChunkTokens > tokens.length, 'Total tokens should increase with overlap');
    const allText = chunks.join(' ');
    assert.ok(allText.includes('word'), 'Content preserved');
});

test('chunkText returns single chunk if shorter than maxTokens', () => {
    const text = "Short text";
    const chunks = chunkText(text, 100, 10);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], text);
});

test('chunkText handles empty input', () => {
    assert.deepStrictEqual(chunkText(''), []);
    assert.deepStrictEqual(chunkText(null), []);
});

test('cleanText handles PDF artifacts', () => {
    // US #29: verify soft hyphen and page marker normalization
    const textWithArtifacts = 'Texto\u00ADbloqueado con guion\u2010largo y   espacios.\n\n[Página 1]\nContenido';
    const cleaned = cleanText(textWithArtifacts);
    assert.ok(cleaned.includes('Textobloqueado'), 'Soft hyphen should be removed');
    assert.ok(cleaned.includes('guion-largo'), 'Hyphen should be normalized');
    assert.ok(!cleaned.includes('   '), 'Multiple spaces should be collapsed');
    assert.ok(cleaned.includes('[Página 1]'), 'Page markers should be preserved');
});

test('extractTranscriptTimeline should generate sections and markers from VTT', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:05.000
Bienvenidos a la clase de arquitectura.

00:00:05.000 --> 00:00:10.000
Hoy veremos patrones y decisiones.

00:00:10.000 --> 00:00:15.000
Pregunta: cuando usar microservicios.

00:00:15.000 --> 00:00:20.000
Tarea: leer clean architecture capitulo 1.

00:00:20.000 --> 00:00:25.000
Cierre de la clase.

00:00:25.000 --> 00:00:30.000
Proximos pasos y entregables.
`;

    const result = extractTranscriptTimeline(Buffer.from(vtt, 'utf-8'), 'text/vtt', 'clase.vtt');
    assert.ok(result.sections.length >= 6, 'Should parse VTT cue sections');
    assert.ok(result.markers.length >= 1, 'Should create timeline markers');
    assert.ok(result.sections[0].timestampLabel.includes('00:00:'), 'Should include timestamp label');
});
