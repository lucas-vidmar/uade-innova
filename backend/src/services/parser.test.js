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

test('cleanTranscript removes SRT timestamps and speaker labels', () => {
    const srt = `1
00:00:00,000 --> 00:00:03,100
SPEAKER_00: Buen día a todos.

2
00:00:03,100 --> 00:00:05,500
[ALUMNO]: ¿Qué veremos hoy?

3
00:00:05,500 --> 00:00:08,000
PROFESOR: Arquitectura hexagonal.
`;

    const cleaned = cleanTranscript(srt);
    assert.ok(!cleaned.includes('00:00:00,000'));
    assert.ok(!cleaned.includes('SPEAKER_00:'));
    assert.ok(!cleaned.includes('[ALUMNO]:'));
    assert.ok(!cleaned.includes('PROFESOR:'));
    assert.ok(cleaned.includes('Buen día a todos.'));
    assert.ok(cleaned.includes('¿Qué veremos hoy?'));
    assert.ok(cleaned.includes('Arquitectura hexagonal.'));
});

test('cleanTranscript removes VTT metadata and inline speaker tags', () => {
    const vtt = `WEBVTT

STYLE
::cue { color: lime; }

NOTE Intro metadata

00:00:00.000 --> 00:00:02.000 align:start position:0%
<v Profesor>Hoy trabajamos sobre decisiones de diseño.</v>
`;

    const cleaned = cleanTranscript(vtt);
    assert.ok(!cleaned.includes('WEBVTT'));
    assert.ok(!cleaned.includes('STYLE'));
    assert.ok(!cleaned.includes('NOTE'));
    assert.ok(!cleaned.includes('align:start'));
    assert.ok(!cleaned.includes('position:0%'));
    assert.ok(!cleaned.includes('<v Profesor>'));
    assert.ok(cleaned.includes('Hoy trabajamos sobre decisiones de diseño.'));
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
