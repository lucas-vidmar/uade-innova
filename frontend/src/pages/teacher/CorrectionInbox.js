import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';
import { apiErrorFeedback } from '../../services/error-feedback.js';

function statusBadge(status) {
  const map = {
    pending: '<span class="badge badge-error">Pendiente</span>',
    reviewed: '<span class="badge badge-warning">Revisado</span>',
    resolved: '<span class="badge badge-success">Resuelto</span>',
    verified: '<span class="badge badge-primary">Verificado</span>',
  };
  return map[status] || `<span class="badge badge-neutral">${escapeHtml(status)}</span>`;
}

function statusLabel(status) {
  const map = { pending: 'Pendiente', reviewed: 'Revisado', resolved: 'Resuelto', verified: 'Verificado' };
  return map[status] || status;
}

const STATUS_ORDER = { pending: 0, reviewed: 1, resolved: 2, verified: 3 };

// UJ-40 (paso 3): la bandeja conserva el orden de convergencia que ya calcula
// `GET /api/corrections-pending` — estado, luego el grupo con más coincidencias
// y, dentro del grupo, el caso más viejo primero — para que quien enseña vea
// primero el problema más marcado y más antiguo. Antes la pantalla reordenaba
// por estado y fecha descendente y descartaba ese orden: el grupo más marcado y
// más viejo no quedaba arriba si había marcas sueltas más nuevas.
function compareCorrections(a, b) {
  const aOrder = STATUS_ORDER[a.status] ?? 99;
  const bOrder = STATUS_ORDER[b.status] ?? 99;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const aCount = a.coincidences || 1;
  const bCount = b.coincidences || 1;
  if (aCount !== bCount) return bCount - aCount;
  return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
}

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
  let loadError = false;
  let hardDenial = null;
  try {
    [classes = [], corrections = []] = await Promise.all([
      api.getClasses(activeSubjectId),
      api.getCorrectionsPending(activeSubjectId, undefined, 'all'),
    ]);
  } catch (err) {
    console.error('[CorrectionInbox] Failed to load corrections:', err);
    // A hard auth/config denial is NOT a partial-data situation: surface the
    // specific actionable message instead of a misleading "incomplete" banner.
    const feedback = apiErrorFeedback(err, {
      ENROLLMENT_INACTIVE: 'Tu identidad no figura como docente activo de esta materia. Contactá a administración o verificá tu inscripción.',
      FORBIDDEN: 'Se requiere rol Docente o Director para ver estos reportes.',
      ACCESS_DENIED: 'Tu cuenta no está habilitada en la plataforma. Contactá a administración.',
      auth: 'Tu cuenta no tiene permisos para ver los reportes de esta materia.',
    });
    if (feedback.kind === 'auth') {
      hardDenial = feedback;
    } else {
      toast('error', 'Error cargando correcciones', 'No se pudieron cargar los reportes. Intentá de nuevo.');
      loadError = true;
    }
    try {
      classes = await api.getClasses(activeSubjectId);
    } catch (classErr) {
      console.error('[CorrectionInbox] Failed to load classes:', classErr);
    }
  }

  corrections.sort(compareCorrections);

  const classMap = {};
  for (const c of classes) {
    classMap[c.id] = c.title;
  }

  let selectedClassId = '';

  let updatingIds = new Set();

  async function handleStatusChange(correctionId, newStatus) {
    if (updatingIds.has(correctionId)) return;
    updatingIds.add(correctionId);

    const btns = container.querySelectorAll(`[data-correction-id="${escapeHtml(correctionId)}"]`);
    btns.forEach(b => b.disabled = true);

    try {
      const result = await api.updateCorrectionStatus(activeSubjectId, correctionId, newStatus);
      if (result.success) {
        const idx = corrections.findIndex(c => c.correctionId === correctionId);
        if (idx !== -1) {
          corrections[idx].status = newStatus;
        }
        corrections.sort(compareCorrections);
        const msg = newStatus === 'reviewed' ? 'marcada como revisada' : 'marcada como resuelta';
        toast('success', 'Estado actualizado', `La corrección fue ${msg}.`);
        render();
      }
    } catch (err) {
      toast('error', 'Error', err.message || 'No se pudo actualizar el estado.');
      btns.forEach(b => b.disabled = false);
    } finally {
      updatingIds.delete(correctionId);
    }
  }

  function renderList(classId) {
    const filtered = classId
      ? corrections.filter(c => c.classId === classId)
      : corrections;

    const listEl = container.querySelector('#corrections-list');
    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-state" style="padding:24px">No hay reportes para esta clase.</div>';
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const date = c.createdAt ? (() => {
        const d = new Date(c.createdAt);
        return isNaN(d.getTime()) ? '---' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      })() : '---';
      const classTitle = classMap[c.classId] || c.classId || 'Sin clase';
      const answerExcerpt = (c.originalAnswer || '').slice(0, 240);
      // #350: verified is an intermediate state (note published, awaiting
      // close). It must stay actionable towards Resuelto, like pending.
      const isActionable = c.status === 'pending' || c.status === 'reviewed' || c.status === 'verified';

      return `
        <div class="class-list-item" style="align-items:flex-start">
          <div class="class-list-date" style="min-width:40px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-warning)">
              <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/>
              <path d="M12 9v4"/><path d="M12 17h.01"/>
            </svg>
          </div>
          <div class="class-list-info">
            <div class="class-list-title"><strong>${escapeHtml(c.question || 'Consulta sin título')}</strong>${c.coincidences > 1 ? ` <span class="badge badge-warning" title="Reportes del mismo material o respuesta">${c.coincidences} coincidencias</span>` : ''}</div>
            <div class="class-list-topics">${escapeHtml(answerExcerpt)}${(c.originalAnswer || '').length > 240 ? '...' : ''}</div>
            <div class="class-list-files">
              Reportado ${date} · ${escapeHtml(classTitle)} · ${escapeHtml(c.studentId || 'Anónimo')}
              ${c.type === 'negative-rating' ? ' · <span class="badge badge-neutral" title="Señal del pulgar abajo del chat, agrupada con los reportes del mismo punto">Valoración negativa</span>' : ''}
              ${c.issueDetail ? `· "${escapeHtml(c.issueDetail)}"` : ''}
            </div>
          </div>
          <div class="class-list-actions" style="gap:var(--space-2)">
            ${statusBadge(c.status)}
            <div style="display:flex;gap:var(--space-2);margin-top:var(--space-2)">
              ${c.status === 'pending' ? `
                <button class="btn btn-secondary btn-sm btn-mark-reviewed" data-correction-id="${escapeHtml(c.correctionId)}">Revisado</button>
              ` : ''}
              ${isActionable ? `
                <button class="btn btn-secondary btn-sm btn-mark-resolved" data-correction-id="${escapeHtml(c.correctionId)}">Resuelto</button>
              ` : ''}
              ${c.status === 'pending' ? `
                <a href="#/teacher/correction/${escapeHtml(c.correctionId)}" class="btn btn-primary btn-sm">Corregir</a>
              ` : `
                <a href="#/teacher/correction/${escapeHtml(c.correctionId)}" class="btn btn-ghost btn-sm">Ver detalle</a>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function render() {
    if (hardDenial) {
      container.innerHTML = `
        <div class="section-title"><h2>Reportes de Calidad IA</h2><div class="line"></div></div>
        <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
          <div class="empty-state-icon" aria-hidden="true">⚠️</div>
          <h2 class="h3">${escapeHtml(hardDenial.title)}</h2>
          <p style="color:var(--color-text-secondary)">${escapeHtml(hardDenial.message || 'No se pudieron cargar los reportes.')}</p>
          ${hardDenial.hint ? `<p style="color:var(--color-warning);font-weight:600;margin-top:var(--space-2)">${escapeHtml(hardDenial.hint)}</p>` : ''}
          <button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar">Reintentar</button>
        </div>
      `;
      return;
    }

    const totalPending = corrections.filter(c => c.status === 'pending').length;
    const totalReviewed = corrections.filter(c => c.status === 'reviewed').length;
    const totalResolved = corrections.filter(c => c.status === 'resolved' || c.status === 'verified').length;

    const classOptions = [
      '<option value="">Todas las clases</option>',
      ...classes.map(c => {
        const count = corrections.filter(x => x.classId === c.id).length;
        const label = count > 0 ? `${escapeHtml(c.title)} (${count})` : escapeHtml(c.title);
        return `<option value="${escapeHtml(c.id)}"${c.id === selectedClassId ? ' selected' : ''}>${label}</option>`;
      }),
    ].join('');

    container.innerHTML = `
      <div class="section-title"><h2>Reportes de Calidad IA</h2><div class="line"></div></div>

      ${loadError ? '<div style="padding:var(--space-3);margin-bottom:var(--space-4);background:var(--color-error-bg);border-radius:var(--radius-md);color:var(--color-error);text-align:center">Error al cargar algunos datos. Los reportes pueden estar incompletos.</div>' : ''}

      <div class="grid-3" style="margin-bottom:var(--space-6)">
        <div class="kpi-card">
          <div class="kpi-label">Pendientes</div>
          <div class="kpi-value" style="color:var(--color-error)">${totalPending}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Revisados</div>
          <div class="kpi-value" style="color:var(--color-warning)">${totalReviewed}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Resueltos</div>
          <div class="kpi-value" style="color:var(--color-success)">${totalResolved}</div>
        </div>
      </div>

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
              ? corrections.filter(c => c.classId === selectedClassId && c.status === 'pending').length
              : totalPending} pendientes
          </span>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Correcciones</span>
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

    container.querySelectorAll('.btn-mark-reviewed').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const correctionId = btn.getAttribute('data-correction-id');
        handleStatusChange(correctionId, 'reviewed');
      });
    });

    container.querySelectorAll('.btn-mark-resolved').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const correctionId = btn.getAttribute('data-correction-id');
        handleStatusChange(correctionId, 'resolved');
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
