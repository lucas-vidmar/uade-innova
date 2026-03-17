import { api } from '../services/api.js';
import { toast } from './Toast.js';

export function createSummaryReviewModal(classId, className, onSaved) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal-card" style="max-width:800px; width:90%">
            <div class="modal-header">
                <h3 class="modal-title">Revisar Resumen IA: ${className}</h3>
                <button class="btn-close">&times;</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom:1rem; color:var(--color-text-secondary); font-size:0.875rem;">
                    Este resumen fue generado automáticamente. Podés editarlo antes de publicarlo para los alumnos.
                </p>
                <div class="loading-summary" style="padding:40px; text-align:center;">Cargando resumen...</div>
                <textarea id="summary-editor" class="form-input" style="height:400px; display:none; font-family:var(--font-mono); font-size:0.875rem; line-height:1.6;"></textarea>
            </div>
            <div class="modal-footer row space-between">
                <button class="btn btn-ghost" id="btn-cancel-summary">Cancelar</button>
                <div class="row" style="gap:12px">
                    <button class="btn btn-secondary" id="btn-save-draft">Guardar Borrador</button>
                    <button class="btn btn-primary" id="btn-approve-summary">Aprobar y Publicar</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const editor = modal.querySelector('#summary-editor');
    const loading = modal.querySelector('.loading-summary');
    const btnApprove = modal.querySelector('#btn-approve-summary');
    const btnSaveDraft = modal.querySelector('#btn-save-draft');

    // Load actual summary
    api.getClassSummary(classId).then(data => {
        loading.style.display = 'none';
        editor.style.display = 'block';
        if (data && data.summary) {
            editor.value = data.summary;
        } else {
            editor.value = "No se encontró un resumen generado. ¿Subiste el material de la clase?";
        }
    }).catch(err => {
        toast('error', 'Error', 'No se pudo cargar el resumen.');
        modal.remove();
    });

    const close = () => modal.remove();
    modal.querySelector('.btn-close').onclick = close;
    modal.querySelector('#btn-cancel-summary').onclick = close;

    const save = async (validated) => {
        try {
            btnApprove.disabled = true;
            btnSaveDraft.disabled = true;
            await api.saveClassSummary(classId, { 
                summary: editor.value, 
                validated 
            });
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
