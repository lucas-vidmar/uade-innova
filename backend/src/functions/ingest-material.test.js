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

const { validateFileType, acceptedFormatsLabel, mergeClassIdsField } = await import('./ingest-material.js');

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

// ── #385: la validación debe aceptar exactamente los formatos que la zona de
// carga del frontend anuncia (FileUpload.js, TYPE_CONFIG) y el mensaje de error
// debe listar esa misma lista. ────────────────────────────────────────────────
describe('validateFileType — formatos anunciados por la zona de carga (#385)', () => {

    const zipBuffer = () => Buffer.concat([makeBuffer(0x50, 0x4B, 0x03, 0x04), Buffer.alloc(120, 0x01)]);
    const pdfBuffer = () => Buffer.concat([Buffer.from('%PDF-1.7', 'utf-8'), Buffer.alloc(120, 0x01)]);

    it('transcript acepta TXT, VTT, SRT, DOCX y PDF', () => {
        assert.strictEqual(validateFileType(textBuffer('texto plano'), 'transcript', 'clase.txt', materialId, contextMock), true);
        assert.strictEqual(validateFileType(textBuffer('WEBVTT\n00:00:01.000 --> 00:00:02.000\nHola'), 'transcript', 'clase.vtt', materialId, contextMock), true);
        assert.strictEqual(validateFileType(textBuffer('1\n00:00:01,000 --> 00:00:02,000\nHola'), 'transcript', 'clase.srt', materialId, contextMock), true);
        assert.strictEqual(validateFileType(zipBuffer(), 'transcript', 'clase.docx', materialId, contextMock), true);
        assert.strictEqual(validateFileType(pdfBuffer(), 'transcript', 'clase.pdf', materialId, contextMock), true);
    });

    it('transcript sigue rechazando lo que no anunció', () => {
        assert.strictEqual(validateFileType(zipBuffer(), 'transcript', 'slides.pptx', materialId, contextMock), false);
        assert.strictEqual(validateFileType(textBuffer('x'.repeat(50)), 'transcript', 'installer.exe', materialId, contextMock), false);
        assert.strictEqual(validateFileType(textBuffer('x'.repeat(50)), 'transcript', 'README', materialId, contextMock), false);
        // Un .pdf con contenido de texto plano no es un PDF
        assert.strictEqual(validateFileType(textBuffer('solo texto'), 'transcript', 'falso.pdf', materialId, contextMock), false);
    });

    it('notes acepta DOCX, PDF y TXT', () => {
        assert.strictEqual(validateFileType(zipBuffer(), 'notes', 'apuntes.docx', materialId, contextMock), true);
        assert.strictEqual(validateFileType(pdfBuffer(), 'notes', 'apuntes.pdf', materialId, contextMock), true);
        assert.strictEqual(validateFileType(textBuffer('apuntes en texto'), 'notes', 'apuntes.txt', materialId, contextMock), true);
        assert.strictEqual(validateFileType(zipBuffer(), 'notes', 'apuntes.pptx', materialId, contextMock), false);
    });

    it('bibliography acepta PDF, DOCX y TXT', () => {
        assert.strictEqual(validateFileType(pdfBuffer(), 'bibliography', 'libro.pdf', materialId, contextMock), true);
        assert.strictEqual(validateFileType(zipBuffer(), 'bibliography', 'libro.docx', materialId, contextMock), true);
        assert.strictEqual(validateFileType(textBuffer('referencias'), 'bibliography', 'libro.txt', materialId, contextMock), true);
        assert.strictEqual(validateFileType(zipBuffer(), 'bibliography', 'libro.pptx', materialId, contextMock), false);
    });

    it('presentation acepta sólo PPTX y PDF', () => {
        assert.strictEqual(validateFileType(zipBuffer(), 'presentation', 'slides.pptx', materialId, contextMock), true);
        assert.strictEqual(validateFileType(pdfBuffer(), 'presentation', 'slides.pdf', materialId, contextMock), true);
        assert.strictEqual(validateFileType(textBuffer('apuntes'), 'presentation', 'slides.txt', materialId, contextMock), false);
        assert.strictEqual(validateFileType(zipBuffer(), 'presentation', 'notas.docx', materialId, contextMock), false);
    });

    it('la etiqueta de formatos aceptados coincide con lo que la validación acepta', () => {
        assert.strictEqual(acceptedFormatsLabel('transcript'), 'TXT, VTT, SRT, DOCX o PDF');
        assert.strictEqual(acceptedFormatsLabel('notes'), 'DOCX, PDF o TXT');
        assert.strictEqual(acceptedFormatsLabel('bibliography'), 'PDF, DOCX o TXT');
        assert.strictEqual(acceptedFormatsLabel('presentation'), 'PPTX o PDF');
        // Cada extensión nombrada en la etiqueta debe estar aceptada para ese tipo.
        const porTipo = {
            transcript: ['.txt', '.vtt', '.srt', '.docx', '.pdf'],
            notes: ['.docx', '.pdf', '.txt'],
            bibliography: ['.pdf', '.docx', '.txt'],
            presentation: ['.pptx', '.pdf'],
        };
        const etiquetaANombre = { TXT: 'txt', VTT: 'vtt', SRT: 'srt', DOCX: 'docx', PDF: 'pdf', PPTX: 'pptx' };
        for (const [tipo, exts] of Object.entries(porTipo)) {
            const nombradas = acceptedFormatsLabel(tipo)
                .replace(/ o /g, ', ')
                .split(', ')
                .map((n) => '.' + etiquetaANombre[n]);
            assert.deepStrictEqual(nombradas.sort(), [...exts].sort(), `la etiqueta de ${tipo} debe listar exactamente los formatos aceptados`);
        }
    });

});

// #578: un campo `classIds` enviado como arreglo JSON (`["class-01"]`) se
// separaba por comas y quedaba como un único id con corchetes. El material se
// guardaba con `["[\"class-01\"]"]` y después no matcheaba ninguna clase.
describe('mergeClassIdsField — classIds del multipart (#578)', () => {
    it('aplana un campo enviado como arreglo JSON', () => {
        assert.deepStrictEqual(mergeClassIdsField(undefined, '["class-01"]'), ['class-01']);
    });

    it('acepta lista separada por comas', () => {
        assert.deepStrictEqual(mergeClassIdsField(undefined, 'class-01, class-02'), ['class-01', 'class-02']);
    });

    it('acumula campos repetidos sin anidar ni duplicar', () => {
        const primero = mergeClassIdsField(undefined, '["class-01"]');
        assert.deepStrictEqual(mergeClassIdsField(primero, 'class-02'), ['class-01', 'class-02']);
        assert.deepStrictEqual(mergeClassIdsField(primero, '["class-01"]'), ['class-01']);
    });
});
