import { api } from '../services/api.js';
import { toast } from './Toast.js';
import { marked } from 'marked';
import TurndownService from 'turndown';

const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
});

export function createSummaryReviewModal(classId, className, onSaved) {
    if (document.querySelector('.modal-overlay')) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    modal.innerHTML = `
        <div class="modal-content" style="max-width:min(95vw,1400px); width:95%; max-height:90vh; display:flex; flex-direction:column;">
            <div class="modal-header">
                <h3 class="modal-title">Revisar Resumen IA: ${className}</h3>
                <button class="btn-close">&times;</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom:1.25rem; color:var(--color-text-secondary); font-size:0.875rem;">
                    Este resumen fue generado automáticamente. Podés editarlo antes de publicarlo para los alumnos.
                </p>
                <div class="loading-summary" style="padding:40px; text-align:center;">Cargando activos...</div>
                <div id="editor-container" style="display:none">
                    <div class="editor-wrapper">
                        <span class="section-label">📝 Resumen Detallado</span>
                        <div class="editor-toolbar">
                            <button data-cmd="bold" title="Negrita (Ctrl+B)" tabindex="-1"><b>B</b></button>
                            <button data-cmd="italic" title="Cursiva (Ctrl+I)" tabindex="-1"><i>I</i></button>
                            <span class="sep"></span>
                            <button data-cmd="h2" title="Título" tabindex="-1" style="width:auto;padding:0 8px;font-weight:700;font-size:0.9rem">H2</button>
                            <button data-cmd="h3" title="Subtítulo" tabindex="-1" style="width:auto;padding:0 8px;font-weight:600;font-size:0.85rem">H3</button>
                            <span class="sep"></span>
                            <button data-cmd="insertUnorderedList" title="Lista con viñetas" tabindex="-1" style="width:auto;padding:0 8px">&#8226;</button>
                            <button data-cmd="insertOrderedList" title="Lista numerada" tabindex="-1" style="width:auto;padding:0 8px">1.</button>
                            <span class="sep"></span>
                            <button data-cmd="source" title="Ver / editar código fuente" tabindex="-1" style="width:auto;padding:0 8px;font-family:var(--font-mono);font-size:0.8rem">&lt;/&gt;</button>
                        </div>
                        <div id="summary-editor" class="editor-content" contenteditable="true"></div>
                        <textarea id="summary-source" class="form-input" style="display:none;height:250px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:15px;border-radius:0 0 var(--radius-md) var(--radius-md);border-top:none;"></textarea>
                    </div>

                    <div class="editor-wrapper">
                        <span class="section-label">🗺️ Mapa Conceptual</span>
                        <textarea id="map-editor" class="form-input" style="height:130px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:12px 15px;border-radius:var(--radius-md);margin-bottom:6px;" placeholder="graph TD..."></textarea>
                        <div class="map-preview" id="map-preview"><span class="preview-placeholder">Vista previa del diagrama</span></div>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="justify-content:flex-end">
                <button class="btn btn-secondary" id="btn-save-draft">Guardar Borrador</button>
                <button class="btn btn-primary" id="btn-approve-summary">Aprobar y Publicar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const summaryEditor = modal.querySelector('#summary-editor');
    const summarySource = modal.querySelector('#summary-source');
    const mapEditor = modal.querySelector('#map-editor');
    const mapPreview = modal.querySelector('#map-preview');
    const editorContainer = modal.querySelector('#editor-container');
    const loading = modal.querySelector('.loading-summary');
    const btnApprove = modal.querySelector('#btn-approve-summary');
    const btnSaveDraft = modal.querySelector('#btn-save-draft');

    let showSource = false;

    const toolbarBtns = modal.querySelectorAll('.editor-toolbar button[data-cmd]');
    toolbarBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const cmd = btn.getAttribute('data-cmd');
            if (cmd === 'source') {
                toggleSource();
                return;
            }
            if (showSource) return;
            summaryEditor.focus();
            document.execCommand(cmd, false, null);
        });
    });

    summaryEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
        }
    });

    function getSummaryValue() {
        if (showSource) {
            return summarySource.value;
        }
        const html = summaryEditor.innerHTML;
        const markdown = turndown.turndown(html);
        return markdown || '';
    }

    function setSummaryValue(markdown) {
        if (!markdown) {
            summaryEditor.innerHTML = '';
            summarySource.value = '';
            return;
        }
        const html = marked.parse(markdown, { async: false });
        summaryEditor.innerHTML = html;
        summarySource.value = markdown;
    }

    function toggleSource() {
        showSource = !showSource;
        if (showSource) {
            summarySource.value = getSummaryValue();
            summaryEditor.style.display = 'none';
            summarySource.style.display = 'block';
            toolbarBtns.forEach(b => {
                if (b.getAttribute('data-cmd') === 'source') b.classList.add('active');
            });
        } else {
            setSummaryValue(summarySource.value);
            summaryEditor.style.display = 'block';
            summarySource.style.display = 'none';
            toolbarBtns.forEach(b => {
                if (b.getAttribute('data-cmd') === 'source') b.classList.remove('active');
            });
        }
    }

    function renderMap() {
        const code = mapEditor.value.trim();
        mapPreview.innerHTML = '';
        if (!code) {
            mapPreview.innerHTML = '<span class="preview-placeholder">Vista previa del diagrama</span>';
            return;
        }
        const pre = document.createElement('pre');
        pre.className = 'mermaid';
        pre.textContent = code;
        mapPreview.appendChild(pre);
        try {
            if (typeof mermaid !== 'undefined') {
                mermaid.run({ nodes: [pre] }).catch((e) => {
                    mapPreview.innerHTML = `<span class="preview-error">No se pudo generar la vista previa del diagrama.</span>`;
                });
            }
        } catch (e) {
            mapPreview.innerHTML = `<span class="preview-error">No se pudo generar la vista previa del diagrama.</span>`;
        }
    }

    let renderTimer;
    mapEditor.addEventListener('input', () => {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderMap, 500);
    });

    Promise.all([
        api.getClassSummary(classId),
        api.getClassMap(classId)
    ]).then(([summaryData, mapData]) => {
        loading.style.display = 'none';
        editorContainer.style.display = 'block';

        if (summaryData && summaryData.summary) {
            const md = typeof summaryData.summary === 'object' ? summaryData.summary.content : summaryData.summary;
            setSummaryValue(md);
        } else {
            setSummaryValue('');
        }

        if (mapData && mapData.mapCode) {
            mapEditor.value = mapData.mapCode;
            renderMap();
        } else {
            mapEditor.value = '';
        }
    }).catch(err => {
        console.error('Error loading class assets:', err);
        toast('error', 'Error', 'No se pudieron cargar los activos de la clase.');
        modal.remove();
    });

    const close = () => {
        modal.remove();
    };
    modal.querySelector('.btn-close').onclick = close;

    const save = async (validated) => {
        try {
            btnApprove.disabled = true;
            btnSaveDraft.disabled = true;

            await Promise.all([
                api.saveClassSummary(classId, { 
                    summary: getSummaryValue(), 
                    validated 
                }),
                api.saveClassMap ? api.saveClassMap(classId, { mapCode: mapEditor.value }) : Promise.resolve()
            ]);
            toast('success', validated ? 'Publicado' : 'Guardado', validated ? 'El resumen ya es visible para los alumnos.' : 'Cambios guardados como borrador.');
            onSaved(validated);
            close();
        } catch (e) {
            toast('error', 'Error', 'No se pudo guardar el resumen.');
        } finally {
            btnApprove.disabled = false;
            btnSaveDraft.disabled = false;
        }
    };

    btnApprove.onclick = () => save(true);
    btnSaveDraft.onclick = () => save(false);
}
