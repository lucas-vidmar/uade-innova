import { auth } from '../../services/auth.js';
import { api } from '../../services/api.js';
import { router } from '../../main.js';

export async function renderTranscriptionCorrections(container) {
  const subjectId = auth.getActiveSubjectId();
  if (!subjectId) {
    container.innerHTML = '<div class="card"><p>Seleccioná una materia primero.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header tc-page-header">
      <div class="tc-title-block">
        <h1 class="h2">Correcciones de Transcripción</h1>
        <p class="page-subtitle">Sugerencias de corrección generadas por IA según el glosario de la materia</p>
      </div>
      <div class="tc-filter-bar">
        <div class="tc-filter-group" role="tablist" aria-label="Filtrar por estado">
          <button class="btn btn-sm tc-filter-btn active" data-status="pending">Pendientes</button>
          <button class="btn btn-sm tc-filter-btn" data-status="applied">Aplicadas</button>
          <button class="btn btn-sm tc-filter-btn" data-status="rejected">Rechazadas</button>
          <button class="btn btn-sm tc-filter-btn" data-status="all">Todas</button>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-apply-all">Aplicar todas</button>
      </div>
    </div>
    <div class="card" id="tc-list">
      <div class="tc-loading">Cargando sugerencias...</div>
    </div>
  `;

  const listEl = container.querySelector('#tc-list');
  let currentStatus = 'pending';

  async function loadSuggestions(status) {
    currentStatus = status;
    listEl.innerHTML = '<div class="tc-loading">Cargando sugerencias...</div>';

    try {
      const suggestions = await api.getTranscriptionSuggestions(subjectId, status);
      renderList(suggestions);
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state"><p>Error al cargar sugerencias: ${err.message}</p></div>`;
    }

    container.querySelectorAll('.tc-filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
  }

  async function applyAllPending() {
    try {
      const pending = await api.getTranscriptionSuggestions(subjectId, 'pending');
      if (!pending || pending.length === 0) {
        const { toast } = await import('../../components/Toast.js');
        toast('info', 'Sin pendientes', 'No hay sugerencias pendientes para aplicar.');
        return;
      }
      const btn = container.querySelector('#btn-apply-all');
      if (btn) { btn.disabled = true; btn.textContent = 'Aplicando...'; }
      const results = await Promise.allSettled(
        pending.map(s => api.applyTranscriptionCorrection({ suggestionId: s.rowKey || s.id, subjectId }))
      );
      const applied = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      const { toast } = await import('../../components/Toast.js');
      if (applied > 0) toast('success', `Aplicadas ${applied} correcciones`, failed > 0 ? `${failed} fallaron.` : '');
      if (failed > 0 && applied === 0) toast('error', 'Error', `No se pudieron aplicar ${failed} correcciones.`);
      loadSuggestions(currentStatus);
    } catch (err) {
      const { toast } = await import('../../components/Toast.js');
      toast('error', 'Error', err.message || 'No se pudieron aplicar las correcciones.');
    }
  }

  function renderList(suggestions) {
    if (!suggestions || suggestions.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">✓</div>
          <h3>Sin sugerencias</h3>
          <p>No hay sugerencias de corrección ${currentStatus === 'all' ? '' : `en estado "${currentStatus}"`}.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="tc-suggestion-list">
        ${suggestions.map((s) => `
          <a href="#/teacher/transcription-correction/${s.rowKey}" class="tc-suggestion-card ${s.status === 'pending' ? 'tc-pending' : ''}" data-id="${s.rowKey}">
            <div class="tc-suggestion-head">
              <span class="tc-suggestion-badge tc-badge-${s.status || 'pending'}">${statusLabel(s.status)}</span>
              <span class="tc-suggestion-date">${formatDate(s.detectedAt)}</span>
            </div>
            <div class="tc-suggestion-fragment">${escapeHtml(s.fragment || '').substring(0, 120)}${(s.fragment || '').length > 120 ? '...' : ''}</div>
            <div class="tc-suggestion-fix">→ ${escapeHtml(s.suggestedFix || '').substring(0, 120)}</div>
            <div class="tc-suggestion-meta">
              <span>${s.materialId || ''}</span>
              <span>${s.classId || ''}</span>
            </div>
          </a>
        `).join('')}
      </div>
    `;
  }

  container.querySelector('#btn-apply-all')?.addEventListener('click', applyAllPending);

  container.querySelectorAll('.tc-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadSuggestions(btn.dataset.status));
  });

  loadSuggestions('pending');
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
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
