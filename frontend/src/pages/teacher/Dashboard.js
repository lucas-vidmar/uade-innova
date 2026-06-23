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
  const enrolledSubjects = auth.getEnrolledSubjects();
  const activeSubjectId = auth.getActiveSubjectId();

  const isValidSubject = activeSubjectId && enrolledSubjects.some(s => s.id === activeSubjectId);

  if (!activeSubjectId || !isValidSubject) {
    if (enrolledSubjects.length > 0) {
      auth.setActiveSubjectId(enrolledSubjects[0].id);
      renderTeacherDashboard(container);
      return;
    }
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
  pendingCorrections.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const resolvedCorrections = corrections.filter(c => c.status === 'resolved');
  resolvedCorrections.sort((a, b) => new Date(b.resolvedAt || b.createdAt || 0) - new Date(a.resolvedAt || a.createdAt || 0));
  const topAlerts = [...pendingCorrections, ...resolvedCorrections].slice(0, 5);

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
        <button class="btn btn-danger btn-sm btn-delete-deadline" data-deadline-id="${deadline.id}">Eliminar</button>
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-5)">
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">
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
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">
          <div class="form-group" style="flex:1">
            <label class="form-label">Descripción</label>
            <textarea class="form-textarea" id="deadline-description" placeholder="Entrega final del proyecto..." style="min-height:100px;flex:1"></textarea>
          </div>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
            <label class="badge badge-neutral" style="cursor:pointer;user-select:none"><input type="checkbox" id="deadline-before" checked /> Notificar 1 día antes</label>
            <label class="badge badge-neutral" style="cursor:pointer;user-select:none"><input type="checkbox" id="deadline-day" checked /> Notificar el mismo día</label>
          </div>
          <button class="btn btn-primary" id="deadline-save" style="align-self:flex-start">Guardar deadline</button>
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
              <span class="badge ${item.status === 'pending' ? 'badge-error' : 'badge-success'}">${item.status === 'pending' ? 'Pendiente' : 'Resuelto'}</span>
              ${item.status === 'pending' ? `
                <button class="btn btn-secondary btn-sm dashboard-review-alert" data-correction-id="${escapeHtml(item.correctionId)}">Revisar</button>
              ` : ''}
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

  /* ── Deadline full edit ─────────────────────────────────── */
  container.querySelectorAll('.btn-edit-deadline').forEach(btn => {
    btn.addEventListener('click', () => {
      const deadline = deadlines.find(d => d.id === btn.dataset.deadlineId);
      if (!deadline) return;
      showDeadlineEditModal(deadline, classes, activeSubjectId, container);
    });
  });

  /* ── Deadline delete ────────────────────────────────────── */
  container.querySelectorAll('.btn-delete-deadline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deadline = deadlines.find(d => d.id === btn.dataset.deadlineId);
      if (!deadline) return;
      if (!confirm(`¿Eliminar el deadline "${deadline.title}"?`)) return;
      try {
        await api.deleteDeadline(activeSubjectId, deadline.id);
        toast('success', 'Deadline eliminado', 'El deadline fue eliminado correctamente.');
        renderTeacherDashboard(container);
      } catch (err) {
        toast('error', 'Error', err.message || 'No se pudo eliminar el deadline.');
      }
    });
  });

  /* ── Quality alert review modal ─────────────────────────── */
  container.querySelectorAll('.dashboard-review-alert').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const correctionId = btn.getAttribute('data-correction-id');
      const correction = corrections.find(c => c.correctionId === correctionId);
      if (!correction) return;
      showReviewAlertModal(activeSubjectId, correction, container);
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

/* ── Deadline Edit Modal ────────────────────────────────── */
function showDeadlineEditModal(deadline, classes, subjectId, container) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:540px;width:92%">
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h3 class="h4" style="margin:0">Editar deadline</h3>
        <button type="button" class="btn btn-ghost btn-sm modal-close-btn" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label">Título</label>
          <input class="form-input" id="edit-deadline-title" value="${escapeHtml(deadline.title)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Clase</label>
          <select class="form-select" id="edit-deadline-class">
            ${(classes || []).map(c => `<option value="${c.id}" ${c.id === deadline.classId ? 'selected' : ''}>${c.title}</option>`).join('')}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
          <div class="form-group">
            <label class="form-label">Vencimiento</label>
            <input type="date" class="form-input" id="edit-deadline-date" value="${deadline.dueDate ? deadline.dueDate.slice(0, 10) : ''}" />
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);justify-content:flex-end;padding-bottom:2px">
            <label class="badge badge-neutral" style="cursor:pointer;user-select:none"><input type="checkbox" id="edit-deadline-before" ${deadline.notifyOnDayBefore !== false ? 'checked' : ''} /> Notificar 1 día antes</label>
            <label class="badge badge-neutral" style="cursor:pointer;user-select:none"><input type="checkbox" id="edit-deadline-day" ${deadline.notifyOnDayOf !== false ? 'checked' : ''} /> Notificar el mismo día</label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Descripción</label>
          <textarea class="form-textarea" id="edit-deadline-description" style="min-height:80px">${escapeHtml(deadline.description || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost modal-close-btn">Cancelar</button>
        <button type="button" class="btn btn-primary" id="edit-deadline-save">Guardar cambios</button>
      </div>
    </div>
  `;

  const cleanup = () => overlay.remove();
  overlay.querySelectorAll('.modal-close-btn').forEach(el => el.addEventListener('click', cleanup));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  overlay.querySelector('#edit-deadline-save').addEventListener('click', async () => {
    const title = overlay.querySelector('#edit-deadline-title').value.trim();
    if (!title) return;
    try {
      await api.saveDeadline({
        ...deadline,
        title,
        classId: overlay.querySelector('#edit-deadline-class').value,
        dueDate: overlay.querySelector('#edit-deadline-date').value,
        description: overlay.querySelector('#edit-deadline-description').value.trim(),
        notifyOnDayBefore: overlay.querySelector('#edit-deadline-before').checked,
        notifyOnDayOf: overlay.querySelector('#edit-deadline-day').checked,
      });
      cleanup();
      toast('success', 'Deadline actualizado', 'Los cambios se guardaron correctamente.');
      renderTeacherDashboard(container);
    } catch (err) {
      toast('error', 'Error', err.message || 'No se pudo actualizar el deadline.');
    }
  });

  document.body.appendChild(overlay);
}

/* ── Quality Alert Review Modal ─────────────────────────── */
function showReviewAlertModal(subjectId, correction, container) {
  if (!correction) return;
  let chatContextHtml = '';
  let contextLoaded = false;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:620px;width:92%">
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h3 class="h4" style="margin:0">Revisar reporte de calidad</h3>
        <button type="button" class="btn btn-ghost btn-sm modal-close-btn" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4);max-height:70vh;overflow-y:auto">
        <div style="background:var(--color-surface-2);border-radius:var(--radius-md);padding:var(--space-4)">
          <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-1)">Consulta del alumno</div>
          <div style="font-weight:600;font-size:var(--font-size-sm)">${escapeHtml(correction.question || 'Consulta sin título')}</div>
          ${correction.issueDetail ? `
            <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:var(--space-2)">${escapeHtml(correction.issueDetail)}</div>
          ` : ''}
          ${correction.originalAnswer ? `
            <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-border)">
              <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-1)">Respuesta original de la IA</div>
              <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);line-height:1.5">${escapeHtml(correction.originalAnswer)}</div>
            </div>
          ` : ''}
        </div>
        <button class="btn btn-secondary btn-sm" id="load-chat-context" style="align-self:flex-start">${icon('clock')} Cargar contexto completo del chat</button>
        <div id="chat-context-container" style="display:none"></div>
        <div class="form-group">
          <label class="form-label">Comentarios del docente</label>
          <textarea class="form-textarea" id="review-comments" placeholder="Agregá comentarios sobre esta corrección. Estos comentarios servirán como input para futuras consultas del chat..." style="min-height:100px"></textarea>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;gap:var(--space-2);justify-content:space-between">
        <button type="button" class="btn btn-ghost modal-close-btn">Cancelar</button>
        <div style="display:flex;gap:var(--space-2)">
          <button type="button" class="btn btn-secondary" id="review-mark-resolved">Resolver sin revisión</button>
          <button type="button" class="btn btn-primary" id="review-save">Guardar y resolver</button>
        </div>
      </div>
    </div>
  `;

  const cleanup = () => overlay.remove();
  overlay.querySelectorAll('.modal-close-btn').forEach(el => el.addEventListener('click', cleanup));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  overlay.querySelector('#load-chat-context').addEventListener('click', async () => {
    if (contextLoaded) return;
    const btn = overlay.querySelector('#load-chat-context');
    btn.disabled = true;
    btn.textContent = 'Cargando...';
    try {
      const context = await api.getCorrectionChatContext(subjectId, correction.correctionId);
      const containerEl = overlay.querySelector('#chat-context-container');
      if (context && context.messages && context.messages.length > 0) {
        containerEl.style.display = 'block';
        containerEl.innerHTML = `
          <div style="background:var(--color-surface-2);border-radius:var(--radius-md);padding:var(--space-4)">
            <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-3)">Conversación completa</div>
            ${context.messages.map(msg => `
              <div style="margin-bottom:var(--space-2);padding:var(--space-2);border-radius:var(--radius-sm);background:${msg.role === 'user' ? 'var(--color-surface-3)' : 'var(--color-surface)'};border-left:3px solid ${msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-success)'}">
                <div style="font-size:var(--font-size-xs);font-weight:600;color:var(--color-text-muted);margin-bottom:2px">${msg.role === 'user' ? 'Alumno' : 'Asistente'}</div>
                <div style="font-size:var(--font-size-sm);color:var(--color-text-primary);line-height:1.5">${escapeHtml(msg.content)}</div>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        containerEl.style.display = 'block';
        containerEl.innerHTML = '<div style="padding:var(--space-3);text-align:center;color:var(--color-text-muted);font-size:var(--font-size-sm)">No se encontró el contexto del chat.</div>';
      }
      contextLoaded = true;
      btn.textContent = 'Contexto cargado';
    } catch (err) {
      const containerEl = overlay.querySelector('#chat-context-container');
      containerEl.style.display = 'block';
      containerEl.innerHTML = `<div style="padding:var(--space-3);text-align:center;color:var(--color-text-muted);font-size:var(--font-size-sm)">Error al cargar contexto: ${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Reintentar';
    }
  });

  overlay.querySelector('#review-save').addEventListener('click', async () => {
    const comments = overlay.querySelector('#review-comments').value.trim();
    try {
      await api.reviewCorrection(subjectId, correction.correctionId, 'resolved', comments);
      cleanup();
      toast('success', 'Reporte resuelto', comments ? 'Corrección resuelta con comentarios.' : 'Corrección resuelta.');
      renderTeacherDashboard(container);
    } catch (err) {
      toast('error', 'Error al guardar', err.message || 'No se pudo resolver.');
    }
  });

  overlay.querySelector('#review-mark-resolved').addEventListener('click', async () => {
    if (!confirm('¿Resolver sin agregar comentarios?')) return;
    try {
      await api.updateCorrectionStatus(subjectId, correction.correctionId, 'resolved');
      cleanup();
      toast('success', 'Reporte resuelto', 'La corrección fue marcada como resuelta.');
      renderTeacherDashboard(container);
    } catch (err) {
      toast('error', 'Error al resolver', err.message || 'No se pudo actualizar el estado.');
    }
  });

  document.body.appendChild(overlay);
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
