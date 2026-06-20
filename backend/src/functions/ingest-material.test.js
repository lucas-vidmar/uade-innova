import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

const materialId = 'test-material-id';

const contextMock = {
    log: {
        warn: mock.fn()
    }
};

beforeEach(() => {
    contextMock.log.warn.mock.resetCalls();
});

const { validateFileType } = await import('./ingest-material.js');

function makeBuffer(...bytes) {
    return Buffer.from(bytes);
}

function textBuffer(text) {
    return Buffer.from(text, 'utf-8');
}

describe('validateFileType — transcript', () => {

    describe('extension allowlist', () => {

        it('allows .txt extension', () => {
            const buf = textBuffer('Hello, world!');
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), true);
        });

        it('allows .vtt extension', () => {
            const buf = textBuffer('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n');
            assert.strictEqual(validateFileType(buf, 'transcript', 'captions.vtt', materialId, contextMock), true);
        });

        it('rejects .pdf labeled as transcript', () => {
            const buf = textBuffer('some text');
            assert.strictEqual(validateFileType(buf, 'transcript', 'doc.pdf', materialId, contextMock), false);
        });

        it('rejects .exe labeled as transcript', () => {
            const buf = textBuffer('some text');
            assert.strictEqual(validateFileType(buf, 'transcript', 'installer.exe', materialId, contextMock), false);
        });

        it('rejects no-extension file', () => {
            const buf = textBuffer('some text');
            assert.strictEqual(validateFileType(buf, 'transcript', 'README', materialId, contextMock), false);
        });

    });

    describe('UTF-8 content validation', () => {

        it('passes plain ASCII text', () => {
            const buf = textBuffer('Hello, this is a valid transcript file with ASCII content.');
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), true);
        });

        it('passes UTF-8 text with accented characters', () => {
            const buf = textBuffer('Contenido con caracteres acentuados: áéíóúñ');
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), true);
        });

        it('rejects NUL bytes in content', () => {
            const buf = Buffer.concat([textBuffer('text before'), makeBuffer(0x00), textBuffer('text after')]);
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), false);
        });

        it('rejects content with excessive control characters', () => {
            const buf = Buffer.alloc(200, 0x01);
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), false);
        });

        it('allows content with few control chars (under 1% threshold)', () => {
            const buf = Buffer.alloc(1000, 0x41);
            buf[1] = 0x01;
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), true);
        });

        it('rejects invalid UTF-8 (overlong encoding 0xC0 0xAF)', () => {
            const buf = Buffer.concat([textBuffer('abc '), makeBuffer(0xC0, 0xAF)]);
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), false);
        });

        it('rejects truncated multi-byte UTF-8 sequence', () => {
            const buf = Buffer.from('abc \xE2\x82', 'latin1');
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), false);
        });

    });

    describe('BOM handling', () => {

        it('accepts UTF-8 BOM (EF BB BF) and validates rest', () => {
            const bom = makeBuffer(0xEF, 0xBB, 0xBF);
            const content = textBuffer('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nSubtítulo con acentos\n');
            assert.strictEqual(validateFileType(Buffer.concat([bom, content]), 'transcript', 'captions.vtt', materialId, contextMock), true);
        });

        it('rejects UTF-16 LE BOM (FF FE)', () => {
            const buf = Buffer.concat([makeBuffer(0xFF, 0xFE), textBuffer('hello')]);
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), false);
        });

        it('rejects UTF-16 BE BOM (FE FF)', () => {
            const buf = Buffer.concat([makeBuffer(0xFE, 0xFF), textBuffer('hello')]);
            assert.strictEqual(validateFileType(buf, 'transcript', 'notes.txt', materialId, contextMock), false);
        });

    });

    describe('binary file rejection', () => {

        it('rejects EXE file (MZ header)', () => {
            const buf = Buffer.concat([makeBuffer(0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00), Buffer.alloc(100, 0x00)]);
            assert.strictEqual(validateFileType(buf, 'transcript', 'malware.exe', materialId, contextMock), false);
        });

        it('rejects PNG header disguised as .txt', () => {
            const buf = Buffer.concat([makeBuffer(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A), Buffer.alloc(200, 0x00)]);
            assert.strictEqual(validateFileType(buf, 'transcript', 'image.txt', materialId, contextMock), false);
        });

    });

    describe('edge cases', () => {

        it('rejects empty buffer (length < 4)', () => {
            assert.strictEqual(validateFileType(Buffer.alloc(0), 'transcript', 'empty.txt', materialId, contextMock), false);
        });

        it('rejects buffer with length exactly 3', () => {
            assert.strictEqual(validateFileType(Buffer.from('abc'), 'transcript', 'short.txt', materialId, contextMock), false);
        });

        it('accepts buffer with length exactly 4 of printable chars', () => {
            assert.strictEqual(validateFileType(Buffer.from('test'), 'transcript', 'short.txt', materialId, contextMock), true);
        });

        it('rejects null fileName', () => {
            const buf = textBuffer('some text');
            assert.strictEqual(validateFileType(buf, 'transcript', null, materialId, contextMock), false);
        });

        it('rejects empty fileName string', () => {
            const buf = textBuffer('some text');
            assert.strictEqual(validateFileType(buf, 'transcript', '', materialId, contextMock), false);
        });

        it('handles non-buffer input gracefully', () => {
            assert.strictEqual(validateFileType(null, 'transcript', 'notes.txt', materialId, contextMock), false);
            assert.strictEqual(validateFileType(undefined, 'transcript', 'notes.txt', materialId, contextMock), false);
            assert.strictEqual(validateFileType('string', 'transcript', 'notes.txt', materialId, contextMock), false);
        });

    });

});
