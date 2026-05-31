import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

export async function renderCorrectionDetail(container) {
  renderHeader('Corregir Respuesta');
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando corrección...</div>';

  const correctionId = window.location.hash.split('/').pop()?.split('?')[0];
  if (!correctionId) {
    container.innerHTML = '<div class="empty-state">Corrección no encontrada.</div>';
    return;
  }

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = '<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>';
    return;
  }

  let correction;
  try {
    correction = await api.getCorrection(activeSubjectId, correctionId);
  } catch (err) {
    console.error('[CorrectionDetail] Failed to load correction:', err);
    container.innerHTML = '<div class="empty-state">Error cargando corrección. Intentá de nuevo.</div>';
    return;
  }

  if (!correction) {
    container.innerHTML = '<div class="empty-state">Corrección no encontrada. <a href="#/teacher/corrections">Volver a la bandeja</a></div>';
    return;
  }

  function render() {
    const date = correction.createdAt
      ? new Date(correction.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '---';

    container.innerHTML = `
      <a href="#/teacher/corrections" style="display:inline-flex;align-items:center;gap:6px;color:var(--color-text-secondary);text-decoration:none;margin-bottom:var(--space-4);font-size:14px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        Volver a la bandeja
      </a>

      <div class="section-title"><h2>Corregir Respuesta</h2><div class="line"></div></div>

      <div class="card" style="margin-bottom:var(--space-6)">
        <div class="card-header">
          <span class="card-title">Detalle del Reporte</span>
        </div>
        <div style="padding:var(--space-4);display:grid;gap:var(--space-4)">
          <div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Reportado por</div>
            <div style="color:var(--color-text-secondary)">${escapeHtml(correction.studentId || 'Anónimo')} · ${escapeHtml(date)}</div>
          </div>
          <div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Pregunta del alumno</div>
            <div style="background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md);color:var(--color-text-primary);font-weight:500">${escapeHtml(correction.question || 'Consulta sin título')}</div>
          </div>
          ${correction.issueDetail ? `
          <div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Motivo del reporte</div>
            <div style="background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md);color:var(--color-text-warning)">${escapeHtml(correction.issueDetail)}</div>
          </div>
          ` : ''}
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--space-6)">
        <div class="card-header">
          <span class="card-title">Respuesta original de la IA</span>
          <span class="badge badge-error">No verificada</span>
        </div>
        <div style="padding:var(--space-4)">
          <div style="background:var(--surface-2);padding:var(--space-4);border-radius:var(--radius-md);color:var(--color-text-secondary);font-size:14px;line-height:1.6;border:1px solid var(--border-subtle)">
            ${escapeHtml(correction.originalAnswer || 'Sin contenido')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Tu corrección</span>
        </div>
        <div style="padding:var(--space-4);display:grid;gap:var(--space-4)">
          <div>
            <label for="correction-input" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;color:var(--color-text-primary)">
              Corrección <span style="color:var(--color-error)">*</span>
            </label>
            <textarea
              id="correction-input"
              class="form-input"
              style="width:100%;min-height:120px;padding:var(--space-3);border-radius:var(--radius-md);background:var(--surface-2);color:var(--color-text-primary);border:1px solid var(--border-subtle);font-family:inherit;font-size:14px;line-height:1.6;resize:vertical"
              placeholder="Escribí la respuesta correcta aquí..."
              minlength="10"
              required
            ></textarea>
            <div id="correction-error" style="color:var(--color-error);font-size:12px;margin-top:4px;display:none"></div>
          </div>
          <div>
            <label for="explanation-input" style="display:block;font-size:14px;font-weight:600;margin-bottom:6px;color:var(--color-text-primary)">
              Explicación adicional
            </label>
            <textarea
              id="explanation-input"
              class="form-input"
              maxlength="5000"
              style="width:100%;min-height:80px;padding:var(--space-3);border-radius:var(--radius-md);background:var(--surface-2);color:var(--color-text-primary);border:1px solid var(--border-subtle);font-family:inherit;font-size:14px;line-height:1.6;resize:vertical"
              placeholder="Opcional: explicá por qué esta corrección es más precisa..."
            ></textarea>
          </div>
          <div style="display:flex;gap:var(--space-3);justify-content:flex-end;padding-top:var(--space-2)">
            <a href="#/teacher/corrections" class="btn btn-secondary" id="cancel-btn">Cancelar</a>
            <button type="button" class="btn btn-primary" id="submit-correction-btn" style="min-width:180px">
              <span id="submit-btn-text">Publicar Corrección</span>
              <span id="submit-btn-spinner" style="display:none">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                Publicando...
              </span>
            </button>
          </div>
        </div>
      </div>
    `;

    const correctionInput = container.querySelector('#correction-input');
    const explanationInput = container.querySelector('#explanation-input');
    const submitBtn = container.querySelector('#submit-correction-btn');
    const submitBtnText = container.querySelector('#submit-btn-text');
    const submitBtnSpinner = container.querySelector('#submit-btn-spinner');
    const errorEl = container.querySelector('#correction-error');

    let isSubmitting = false;

    submitBtn?.addEventListener('click', async () => {
      if (isSubmitting) return;
      isSubmitting = true;

      const correctedAnswer = correctionInput?.value?.trim();
      const explanation = explanationInput?.value?.trim() || '';

      if (!correctedAnswer || correctedAnswer.length < 10) {
        isSubmitting = false;
        if (errorEl) {
          errorEl.textContent = 'La corrección debe tener al menos 10 caracteres.';
          errorEl.style.display = 'block';
        }
        correctionInput?.focus();
        return;
      }

      if (errorEl) errorEl.style.display = 'none';
      if (submitBtnText) submitBtnText.style.display = 'none';
      if (submitBtnSpinner) submitBtnSpinner.style.display = 'inline';
      submitBtn.disabled = true;

      try {
        await api.verifyAnswer({
          correctionId,
          subjectId: activeSubjectId,
          correctedAnswer,
          explanation,
        });
        toast('success', 'Corrección publicada', 'El alumno recibirá tu respuesta verificada.');
        window.location.hash = '#/teacher/corrections';
      } catch (err) {
        console.error('[CorrectionDetail] Failed to verify answer:', err);
        toast('error', 'Error al publicar', err?.message || 'Intentá de nuevo más tarde.');
        if (submitBtnText) submitBtnText.style.display = 'inline';
        if (submitBtnSpinner) submitBtnSpinner.style.display = 'none';
        submitBtn.disabled = false;
        isSubmitting = false;
      }
    });
  }

  render();
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
