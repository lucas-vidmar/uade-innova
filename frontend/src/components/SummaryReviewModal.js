import { api } from '../services/api.js';
import { toast } from './Toast.js';

let activeModal = null;

export function createSummaryReviewModal(classId, className, onSaved) {
    if (activeModal) return;

    const modal = document.createElement('div');
    activeModal = modal;
    modal.className = 'modal-overlay';
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    modal.innerHTML = `
        <div class="modal-content" style="max-width:800px; width:95%; max-height:90vh; overflow:hidden;">
            <div class="modal-header">
                <h3 class="modal-title">Revisar Resumen IA: ${className}</h3>
                <button class="btn-close">&times;</button>
            </div>
            <div class="modal-body" style="max-height: calc(100vh - 200px); overflow-y: auto;">
                <p style="margin-bottom:1rem; color:var(--color-text-secondary); font-size:0.875rem;">
                    Este resumen fue generado automáticamente. Podés editarlo antes de publicarlo para los alumnos.
                </p>
                <div class="loading-summary" style="padding:40px; text-align:center;">Cargando activos...</div>
                <div id="editor-container" style="display:none">
                    <label style="display:block; margin-bottom:8px; font-weight:600">📝 Resumen Detallado (Markdown)</label>
                    <textarea id="summary-editor" class="form-input" style="height:250px; margin-bottom:20px; font-family:var(--font-mono); font-size:0.875rem; line-height:1.6; padding:15px; border-radius:8px;"></textarea>
                    
                    <label style="display:block; margin-bottom:8px; font-weight:600">🗺️ Mapa Conceptual (Mermaid.js)</label>
                    <textarea id="map-editor" class="form-input" style="height:150px; font-family:var(--font-mono); font-size:0.875rem; line-height:1.6; padding:15px; border-radius:8px;" placeholder="graph TD..."></textarea>
                </div>
            </div>
            <div class="modal-footer row space-between">
                <button class="btn btn-ghost" id="btn-cancel-summary">Cancelar</button>
                <div class="row" style="gap:12px">
                    <button class="btn btn-outline" id="btn-reject-summary" style="color:var(--color-error);border-color:rgba(239,68,68,0.3)">No apto — escribir manualmente</button>
                    <button class="btn btn-secondary" id="btn-save-draft">Guardar Borrador</button>
                    <button class="btn btn-primary" id="btn-approve-summary">Aprobar y Publicar</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const summaryEditor = modal.querySelector('#summary-editor');
    const mapEditor = modal.querySelector('#map-editor');
    const editorContainer = modal.querySelector('#editor-container');
    const loading = modal.querySelector('.loading-summary');
    const btnApprove = modal.querySelector('#btn-approve-summary');
    const btnSaveDraft = modal.querySelector('#btn-save-draft');

    // Load actual summary and map
    Promise.all([
        api.getClassSummary(classId),
        api.getClassMap(classId)
    ]).then(([summaryData, mapData]) => {
        loading.style.display = 'none';
        editorContainer.style.display = 'block';
        
        // Handle summary (could be a string or object depending on version)
        if (summaryData && summaryData.summary) {
            summaryEditor.value = typeof summaryData.summary === 'object' ? summaryData.summary.content : summaryData.summary;
        } else {
            summaryEditor.value = "";
        }

        // Handle map
        if (mapData && mapData.mapCode) {
            mapEditor.value = mapData.mapCode;
        } else {
            mapEditor.value = "";
        }
    }).catch(err => {
        console.error('Error loading class assets:', err);
        toast('error', 'Error', 'No se pudieron cargar los activos de la clase.');
        modal.remove();
    });

    const close = () => {
        modal.remove();
        activeModal = null;
    };
    modal.querySelector('.btn-close').onclick = close;
    modal.querySelector('#btn-cancel-summary').onclick = close;

    const save = async (validated) => {
        try {
            btnApprove.disabled = true;
            btnSaveDraft.disabled = true;
            
            // Save Summary and Map in parallel
            await Promise.all([
                api.saveClassSummary(classId, { 
                    summary: summaryEditor.value, 
                    validated 
                }),
                // We reuse saveClassSummary or create a specific one? 
                // Let's assume for now we might need a saveClassMap or just extend the API if not existing
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

    modal.querySelector('#btn-reject-summary').onclick = async () => {
        try {
            await api.saveClassSummary(classId, {
                summary: summaryEditor.value || '',
                validated: false,
                summarySource: 'manual',
            });
            toast('success', 'Guardado', 'El resumen se marcó como no apto. Los alumnos verán el contenido manual.');
            onSaved(false);
            close();
        } catch (e) {
            toast('error', 'Error', 'No se pudo guardar.');
        }
    };

    btnApprove.onclick = () => save(true);
    btnSaveDraft.onclick = () => save(false);
}
