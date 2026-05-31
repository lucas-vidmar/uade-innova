import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

export async function renderCorrectionInbox(container) {
  renderHeader('Bandeja de Correcciones');
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando correcciones...</div>';

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = '<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>';
    return;
  }

  let corrections = [];
  let classes = [];
  try {
    [classes = [], corrections = []] = await Promise.all([
      api.getClasses(activeSubjectId),
      api.getCorrectionsPending(activeSubjectId),
    ]);
  } catch (err) {
    console.error('[CorrectionInbox] Failed to load corrections:', err);
    toast('error', 'Error cargando correcciones', 'No se pudieron cargar los reportes pendientes. Intentá de nuevo.');
    try {
      classes = await api.getClasses(activeSubjectId);
    } catch (classErr) {
      console.error('[CorrectionInbox] Failed to load classes:', classErr);
    }
  }

  const classMap = {};
  for (const c of classes) {
    classMap[c.id] = c.title;
  }

  let selectedClassId = '';

  function renderList(classId) {
    const filtered = classId
      ? corrections.filter(c => c.classId === classId)
      : corrections;

    const listEl = container.querySelector('#corrections-list');
    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-state" style="padding:24px">No hay reportes pendientes para esta clase.</div>';
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const date = c.createdAt
        ? new Date(c.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '---';
      const classTitle = classMap[c.classId] || c.classId || 'Sin clase';
      const answerExcerpt = (c.originalAnswer || '').slice(0, 240);

      return `
        <div class="class-list-item" style="align-items:flex-start;cursor:pointer" data-correction-id="${escapeHtml(c.correctionId)}">
          <div class="class-list-date" style="min-width:40px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-warning)">
              <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/>
              <path d="M12 9v4"/><path d="M12 17h.01"/>
            </svg>
          </div>
          <div class="class-list-info">
            <div class="class-list-title"><strong>${escapeHtml(c.question || 'Consulta sin título')}</strong></div>
            <div class="class-list-topics">${escapeHtml(answerExcerpt)}${(c.originalAnswer || '').length > 240 ? '...' : ''}</div>
            <div class="class-list-files">
              Reportado ${date} · ${escapeHtml(classTitle)} · ${escapeHtml(c.studentId || 'Anónimo')}
              ${c.issueDetail ? `· "${escapeHtml(c.issueDetail)}"` : ''}
            </div>
          </div>
          <div class="class-list-actions">
            <span class="badge badge-error">${c.status === 'pending' ? 'Pendiente' : c.status}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function render() {
    const classOptions = [
      '<option value="">Todas las clases</option>',
      ...classes.map(c => {
        const count = corrections.filter(x => x.classId === c.id).length;
        const label = count > 0 ? `${escapeHtml(c.title)} (${count})` : escapeHtml(c.title);
        return `<option value="${escapeHtml(c.id)}"${c.id === selectedClassId ? ' selected' : ''}>${label}</option>`;
      }).join(''),
    ];

    container.innerHTML = `
      <div class="section-title"><h2>Reportes de Calidad IA</h2><div class="line"></div></div>

      <div class="card" style="margin-bottom:var(--space-6)">
        <div class="card-header">
          <span class="card-title">Filtrar por clase</span>
        </div>
        <div style="padding:var(--space-4)">
          <select class="form-select" id="class-filter" style="max-width:400px">
            ${classOptions}
          </select>
          <span class="badge badge-warning" style="margin-left:var(--space-3)">
            ${selectedClassId
              ? corrections.filter(c => c.classId === selectedClassId).length
              : corrections.length} pendientes
          </span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Correcciones Pendientes</span>
          <span class="badge badge-error">${corrections.length}</span>
        </div>
        <div class="class-list" id="corrections-list">
        </div>
      </div>
    `;

    const filter = container.querySelector('#class-filter');
    filter?.addEventListener('change', () => {
      selectedClassId = filter.value;
      render();
    });

    renderList(selectedClassId);

    // Attach click handlers to correction rows for Story 4.2 navigation
    container.querySelectorAll('#corrections-list .class-list-item[data-correction-id]').forEach(row => {
      row.addEventListener('click', () => {
        const correctionId = row.getAttribute('data-correction-id');
        // Navigate to correction detail form (Story 4.2 placeholder)
        window.location.hash = `#/teacher/correction/${correctionId}`;
      });
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
