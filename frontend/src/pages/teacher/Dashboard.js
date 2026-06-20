/* ============================================================
   Teacher Dashboard — Cátedra overview
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';
import { showPromptDialog } from '../../components/Dialog.js';
import { OnboardingEngine, isOnboardingCompleted } from '../../services/onboarding.js';
import { TEACHER_ONBOARDING_STEPS } from './OnboardingSteps.js';
import { renderSubjectWeights } from './SubjectWeights.js';

export async function renderTeacherDashboard(container) {
  renderHeader('Mis Cátedras');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando cátedras...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  const activeSubjectName = user.subjects?.find(s => s.id === activeSubjectId)?.name || 'Materia';

  let classes = [], deadlines = [], corrections = [];
  try {
    [classes = [], deadlines = [], corrections = []] = await Promise.all([
      api.getClasses(activeSubjectId),
      api.getDeadlines(activeSubjectId),
      api.getCorrectionsPending(activeSubjectId, undefined, 'all').catch(() => []),
    ]);
  } catch {
    classes = classes || [];
    deadlines = deadlines || [];
  }

  const pendingCorrections = corrections.filter(c => c.status === 'pending');
  const reviewedCorrections = corrections.filter(c => c.status === 'reviewed');
  pendingCorrections.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  reviewedCorrections.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const topAlerts = [...pendingCorrections, ...reviewedCorrections].slice(0, 5);

  const complete = (classes || []).filter(c => c.summaryReady);
  const processing = (classes || []).filter(c => {
    const hasMaterials = (c.materials || []).length > 0;
    const allReady = (c.materials || []).every(m => m.status === 'ready');
    return !c.summaryReady && hasMaterials;
  });
  const empty = (classes || []).filter(c => (c.materials || []).length === 0);

  const renderDeadlineRow = (deadline, cls) => `
    <div class="class-list-item" style="align-items:flex-start">
      <div class="class-list-date">${icon('clock')}</div>
      <div class="class-list-info">
        <div class="class-list-title">${deadline.title}</div>
        <div class="class-list-topics">${deadline.description || 'Sin descripción'}</div>
        <div class="class-list-files">Vence ${new Date(deadline.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · Clase ${cls?.title || deadline.classId}</div>
      </div>
      <div class="class-list-actions">
        <span class="badge badge-primary">${deadline.notifyOnDayBefore ? '1 día antes' : 'Solo el día'}</span>
        <button class="btn btn-secondary btn-sm btn-edit-deadline" data-deadline-id="${deadline.id}">Editar</button>
      </div>
    </div>
  `;

  container.innerHTML = `
    <!-- KPIs -->
    <div class="grid-3" style="margin-bottom:var(--space-8)">
      <div class="kpi-card">
        <div class="kpi-label">Clases completas</div>
        <div class="kpi-value" style="color:var(--color-success)">${complete.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Procesando</div>
        <div class="kpi-value" style="color:var(--color-warning)">${processing.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sin material</div>
        <div class="kpi-value" style="color:var(--color-text-secondary)">${empty.length}</div>
      </div>
    </div>

    <div class="section-title"><h2>${icon('book')} Cronograma — ${activeSubjectName}</h2><div class="line"></div></div>
    <div class="class-list">
      ${(classes || []).map(c => {
        const ready = c.summaryReady;
        const materials = c.materials || [];
        const anyProcessing = materials.some(m => m.status === 'processing' || m.status === 'pending');
        const status = ready ? { label: 'Listo', badge: 'badge-success' }
          : anyProcessing ? { label: 'Procesando...', badge: 'badge-warning' }
            : materials.length > 0 ? { label: 'Pendiente revisión', badge: 'badge-info' }
              : { label: 'Sin material', badge: 'badge-neutral' };
        return `
          <div class="class-list-item">
            <div class="class-list-date">${c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '---'}</div>
            <div class="class-list-info">
              <div class="class-list-title">${c.title || 'Clase sin título'}</div>
              <div class="class-list-topics">${(c.topics || []).slice(0, 3).join(' · ') || 'Sin temas'}</div>
              ${materials.length > 0 ? `<div class="class-list-files">${materials.length} archivo${materials.length !== 1 ? 's' : ''} cargado${materials.length !== 1 ? 's' : ''}</div>` : ''}
            </div>
            <div class="class-list-actions">
              <span class="badge ${status.badge}">${status.label}</span>
              <a href="#/teacher/upload?class=${c.id}" class="btn btn-secondary btn-sm">Cargar</a>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="section-title" style="margin-top:var(--space-10)"><h2>${icon('clock')} Deadlines por clase</h2><div class="line"></div></div>
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="grid-2">
        <div>
          <div class="form-group">
            <label class="form-label">Título</label>
            <input class="form-input" id="deadline-title" placeholder="Final Project" />
          </div>
          <div class="form-group">
            <label class="form-label">Clase</label>
            <select class="form-select" id="deadline-class">
              ${(classes || []).map(c => `<option value="${c.id}">${c.title}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Vencimiento</label>
            <input type="date" class="form-input" id="deadline-date" />
          </div>
        </div>
        <div>
          <div class="form-group">
            <label class="form-label">Descripción</label>
            <textarea class="form-textarea" id="deadline-description" placeholder="Entrega final del proyecto..."></textarea>
          </div>
          <div class="form-group" style="display:flex;gap:var(--space-4);flex-wrap:wrap">
            <label class="badge badge-neutral" style="cursor:pointer"><input type="checkbox" id="deadline-before" checked /> Notificar 1 día antes</label>
            <label class="badge badge-neutral" style="cursor:pointer"><input type="checkbox" id="deadline-day" checked /> Notificar el mismo día</label>
          </div>
          <button class="btn btn-primary" id="deadline-save">Guardar deadline</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Deadlines activos</span>
        <span class="badge badge-info">${(deadlines || []).length}</span>
      </div>
      <div class="class-list">
        ${(deadlines || []).length > 0 ? deadlines.map(d => renderDeadlineRow(d, (classes || []).find(c => c.id === d.classId))).join('') : '<div class="empty-state" style="padding:24px">Sin deadlines configurados.</div>'}
      </div>
    </div>

    <div class="section-title" style="margin-top:var(--space-10)"><h2>${icon('alert')} Alertas de Calidad IA</h2><div class="line"></div></div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Reportes de alumnos</span>
        <span class="badge badge-warning">${pendingCorrections.length}</span>
      </div>
      <div class="class-list" id="dashboard-alerts-list">
        ${topAlerts.length > 0 ? topAlerts.map((item) => `
          <div class="class-list-item" style="align-items:flex-start" data-correction-id="${escapeHtml(item.correctionId)}">
            <div class="class-list-date">${icon('alert')}</div>
            <div class="class-list-info">
              <div class="class-list-title">${escapeHtml(item.question || 'Consulta sin título')}</div>
              <div class="class-list-topics">${escapeHtml(item.issueDetail || 'Sin detalle provisto.')}</div>
              <div class="class-list-files">Reporte: ${item.createdAt ? (() => { const d = new Date(item.createdAt); return isNaN(d.getTime()) ? '---' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); })() : '---'}</div>
            </div>
            <div class="class-list-actions" style="gap:var(--space-2)">
              <span class="badge ${item.status === 'pending' ? 'badge-error' : 'badge-warning'}">${item.status === 'pending' ? 'Pendiente' : 'Revisado'}</span>
              ${item.status === 'pending' ? `
                <button class="btn btn-secondary btn-sm dashboard-mark-reviewed" data-correction-id="${escapeHtml(item.correctionId)}">Revisado</button>
                <button class="btn btn-secondary btn-sm dashboard-mark-resolved" data-correction-id="${escapeHtml(item.correctionId)}">Resuelto</button>
              ` : `
                <button class="btn btn-secondary btn-sm dashboard-mark-resolved" data-correction-id="${escapeHtml(item.correctionId)}">Resuelto</button>
              `}
            </div>
          </div>
        `).join('') : '<div class="empty-state" style="padding:24px">No hay reportes de calidad IA para esta materia.</div>'}
      </div>
      ${corrections.length > 5 ? `
        <div style="padding:var(--space-3);text-align:center;border-top:1px solid var(--border-subtle)">
          <a href="#/teacher/corrections" class="btn btn-secondary btn-sm">Ver todas (${corrections.length})</a>
        </div>
      ` : ''}
    </div>

    <div id="weights-section"></div>
  `;

  const weightsSection = container.querySelector('#weights-section');
  renderSubjectWeights(weightsSection, activeSubjectId, activeSubjectName);

  const saveBtn = container.querySelector('#deadline-save');
  saveBtn?.addEventListener('click', async () => {
    try {
      await api.saveDeadline({
        title: container.querySelector('#deadline-title').value.trim(),
        description: container.querySelector('#deadline-description').value.trim(),
        classId: container.querySelector('#deadline-class').value,
        subjectId: activeSubjectId,
        dueDate: container.querySelector('#deadline-date').value,
        notifyOnDayBefore: container.querySelector('#deadline-before').checked,
        notifyOnDayOf: container.querySelector('#deadline-day').checked,
      });
      toast('success', 'Deadline guardado', 'El deadline fue vinculado a la clase y se mostrará en dashboards y calendario.');
      renderTeacherDashboard(container);
    } catch (err) {
      toast('error', 'Error', err.message || 'No se pudo guardar el deadline.');
    }
  });

  container.querySelectorAll('.btn-edit-deadline').forEach(btn => {
    btn.addEventListener('click', async () => {
      const deadline = deadlines.find(d => d.id === btn.dataset.deadlineId);
      if (!deadline) return;
      const newTitle = await showPromptDialog({
        title: 'Editar deadline',
        label: 'Titulo del deadline',
        initialValue: deadline.title,
        confirmText: 'Guardar',
      });
      if (!newTitle) return;
      await api.saveDeadline({ ...deadline, title: newTitle });
      toast('success', 'Deadline actualizado', 'Los cambios se guardaron correctamente.');
      renderTeacherDashboard(container);
    });
  });

  let dashboardUpdating = false;

  container.querySelectorAll('.dashboard-mark-reviewed').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (dashboardUpdating) return;
      dashboardUpdating = true;
      btn.disabled = true;
      const correctionId = btn.getAttribute('data-correction-id');
      try {
        await api.updateCorrectionStatus(activeSubjectId, correctionId, 'reviewed');
        toast('success', 'Estado actualizado', 'La corrección fue marcada como revisada.');
        renderTeacherDashboard(container);
      } catch (err) {
        toast('error', 'Error', err.message || 'No se pudo actualizar el estado.');
        btn.disabled = false;
        dashboardUpdating = false;
      }
    });
  });

  container.querySelectorAll('.dashboard-mark-resolved').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (dashboardUpdating) return;
      dashboardUpdating = true;
      btn.disabled = true;
      const correctionId = btn.getAttribute('data-correction-id');
      try {
        await api.updateCorrectionStatus(activeSubjectId, correctionId, 'resolved');
        toast('success', 'Estado actualizado', 'La corrección fue marcada como resuelta.');
        renderTeacherDashboard(container);
      } catch (err) {
        toast('error', 'Error', err.message || 'No se pudo actualizar el estado.');
        btn.disabled = false;
        dashboardUpdating = false;
      }
    });
  });

  if (deadlines.length > 0) {
    console.debug('[Teacher Dashboard] Deadlines cargados:', deadlines.length);
  }

  /* ── Onboarding trigger (first login) ───────────────── */
  requestAnimationFrame(() => {
    if (!isOnboardingCompleted('teacher')) {
      const engine = new OnboardingEngine({ role: 'teacher', steps: TEACHER_ONBOARDING_STEPS });
      engine.start();
    }
  });
}

function icon(name) {
  const icons = {
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
    book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  };

  return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.clock}</span>`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
