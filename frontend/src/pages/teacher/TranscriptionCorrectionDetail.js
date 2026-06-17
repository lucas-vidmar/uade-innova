import { auth } from '../../services/auth.js';
import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';
import { router } from '../../main.js';

export async function renderTranscriptionCorrectionDetail(container) {
  const subjectId = auth.getActiveSubjectId();
  const suggestionId = window.location.hash.split('/').pop();

  if (!subjectId || !suggestionId) {
    container.innerHTML = '<div class="card"><p>Faltan parámetros.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <a href="#/teacher/transcription-corrections" class="btn btn-ghost">← Volver</a>
      <h1 class="h2">Detalle de Sugerencia</h1>
    </div>
    <div class="card" id="tcd-content">
      <div class="tc-loading">Cargando...</div>
    </div>
  `;

  const contentEl = container.querySelector('#tcd-content');

  async function loadSuggestion() {
    try {
      const suggestions = await api.getTranscriptionSuggestions(subjectId, 'all');
      const suggestion = suggestions.find((s) => s.rowKey === suggestionId || s.id === suggestionId);

      if (!suggestion) {
        contentEl.innerHTML = '<div class="empty-state"><p>Sugerencia no encontrada.</p></div>';
        return;
      }

      contentEl.innerHTML = `
        <div class="tcd-detail">
          <div class="tcd-status-bar">
            <span class="tc-suggestion-badge tc-badge-${suggestion.status || 'pending'}">${statusLabel(suggestion.status)}</span>
            <span class="tcd-date">Detectado: ${formatDate(suggestion.detectedAt)}</span>
            ${suggestion.resolvedAt ? `<span class="tcd-date">Resuelto: ${formatDate(suggestion.resolvedAt)}</span>` : ''}
          </div>

          <div class="tcd-section">
            <h3>Fragmento detectado</h3>
            <div class="tcd-fragment-box">${escapeHtml(suggestion.fragment || '')}</div>
          </div>

          <div class="tcd-section">
            <h3>Corrección sugerida</h3>
            <div class="tcd-fix-box">${escapeHtml(suggestion.suggestedFix || '')}</div>
          </div>

          <div class="tcd-section">
            <h3>Término correcto</h3>
            <p>${escapeHtml(suggestion.correctTerm || '—')}</p>
          </div>

          <div class="tcd-section">
            <h3>Explicación</h3>
            <p>${escapeHtml(suggestion.explanation || 'Sin explicación disponible.')}</p>
          </div>

          <div class="tcd-section">
            <h3>Metadatos</h3>
            <div class="tcd-meta-grid">
              <div><span class="tcd-meta-label">Material ID</span><span>${escapeHtml(suggestion.materialId || '—')}</span></div>
              <div><span class="tcd-meta-label">Clase</span><span>${escapeHtml(suggestion.classId || '—')}</span></div>
              <div><span class="tcd-meta-label">PartitionKey</span><span>${escapeHtml(suggestion.partitionKey || '—')}</span></div>
            </div>
          </div>

          ${suggestion.status === 'pending' ? `
            <div class="tcd-actions">
              <button class="btn btn-primary" id="tcd-apply-btn">✓ Aplicar Corrección</button>
              <button class="btn btn-outline" id="tcd-reject-btn">✕ Rechazar Sugerencia</button>
            </div>
          ` : ''}
        </div>
      `;

      const applyBtn = contentEl.querySelector('#tcd-apply-btn');
      const rejectBtn = contentEl.querySelector('#tcd-reject-btn');

      if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
          try {
            applyBtn.disabled = true;
            applyBtn.textContent = 'Aplicando...';
            await api.applyTranscriptionCorrection(suggestionId, subjectId);
            toast('success', 'Corrección aplicada', 'La sugerencia fue marcada como aplicada.');
            loadSuggestion();
          } catch (err) {
            toast('error', 'Error', err.message);
            applyBtn.disabled = false;
            applyBtn.textContent = '✓ Aplicar Corrección';
          }
        });
      }

      if (rejectBtn) {
        rejectBtn.addEventListener('click', async () => {
          try {
            rejectBtn.disabled = true;
            rejectBtn.textContent = 'Rechazando...';
            await api.rejectTranscriptionSuggestion(suggestionId, subjectId);
            toast('success', 'Sugerencia rechazada', 'La sugerencia fue marcada como rechazada.');
            loadSuggestion();
          } catch (err) {
            toast('error', 'Error', err.message);
            rejectBtn.disabled = false;
            rejectBtn.textContent = '✕ Rechazar Sugerencia';
          }
        });
      }
    } catch (err) {
      contentEl.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`;
    }
  }

  loadSuggestion();
}

function statusLabel(status) {
  const labels = { pending: 'Pendiente', applied: 'Aplicada', rejected: 'Rechazada' };
  return labels[status] || status;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  if (typeof value !== 'string') return String(value || '');
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
