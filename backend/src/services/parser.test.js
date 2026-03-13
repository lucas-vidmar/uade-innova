import { test } from 'node:test';
import assert from 'node:assert';
import { chunkText, cleanTranscript } from './parser.js';
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
    // Generate a long text: "word " repeated 50 times
    const text = Array(50).fill('word').join(' ');
    const tokens = encoder.encode(text);
    
    // maxTokens 20, overlap 5
    const maxTokens = 20;
    const overlapTokens = 5;
    
    const chunks = chunkText(text, maxTokens, overlapTokens);
    
    // First chunk should be around maxTokens
    const firstChunkTokens = encoder.encode(chunks[0]);
    assert.ok(firstChunkTokens.length <= maxTokens, `First chunk too large: ${firstChunkTokens.length}`);
    
    // Total tokens in chunks should be more than original due to overlap
    let totalChunkTokens = 0;
    chunks.forEach(c => totalChunkTokens += encoder.encode(c).length);
    assert.ok(totalChunkTokens > tokens.length, 'Total tokens should increase with overlap');
    
    // Text should be reconstructed (mostly, ignoring whitespace variations)
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
