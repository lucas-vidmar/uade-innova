/* ============================================================
   Teacher Dashboard — Cátedra overview
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';
import { showPromptDialog, showConfirmDialog } from '../../components/Dialog.js';
import { OnboardingEngine, shouldAutoStartOnboarding } from '../../services/onboarding.js';
import { TEACHER_ONBOARDING_STEPS } from './OnboardingSteps.js';
import { renderSubjectWeights } from './SubjectWeights.js';

export async function renderTeacherDashboard(container) {
  renderHeader('Mis Cátedras');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando cátedras...</div>`;

  // #346: Dashboard-owned modals must not persist across routes. A single
  // hashchange teardown (re-registered per render) closes any open modal
  // overlay when the user navigates away, mirroring UploadMaterials.
  if (window.__teacherDashboardHashTeardown) {
    window.removeEventListener('hashchange', window.__teacherDashboardHashTeardown);
  }
  window.__teacherDashboardHashTeardown = () => {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
  };
  window.addEventListener('hashchange', window.__teacherDashboardHashTeardown);

  const user = auth.getUser();
  let enrolledSubjects = auth.getEnrolledSubjects();
  let activeSubjectId = auth.getActiveSubjectId();

  // #332: after a reload the in-memory subject/enrollment caches are cold and
  // getEnrolledSubjects fail-closes to []. Rehydrate once from the server
  // before the gate so a valid teacher session renders its catedra.
  if (enrolledSubjects.length === 0) {
    try {
      await auth.hydrateSession();
    } catch {
      // Fall through to the gate with whatever the caches hold.
    }
    enrolledSubjects = auth.getEnrolledSubjects();
    activeSubjectId = auth.getActiveSubjectId();
  }

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

  let classes = [], deadlines = [], corrections = [], disputes = [], closedDisputes = [], integrityAlerts = [];
  try {
    [classes = [], deadlines = [], corrections = [], disputes = [], integrityAlerts = []] = await Promise.all([
      api.getClasses(activeSubjectId),
      api.getDeadlines(activeSubjectId),
      api.getCorrectionsPending(activeSubjectId, undefined, 'all').catch(() => []),
      api.getGradeDisputes(activeSubjectId).catch(() => []),
      // #328: avisos de integridad del índice de la unidad (material que no le
      // pertenece y dejó de citarse). Si el canal falla, el tablero no se rompe.
      api.getNotifications({ userId: user.id, subjectId: activeSubjectId, type: 'integrity', limit: 5 }).catch(() => []),
    ]);
    // Full history (open + closed) so a settled dispute stays traceable: who
    // resolved it and with what written rationale (UJ-41).
    closedDisputes = (await api.getGradeDisputes(activeSubjectId, 'all').catch(() => []))
      .filter(d => d.status !== 'open');
  } catch {
    classes = classes || [];
    deadlines = deadlines || [];
  }

  const pendingCorrections = corrections.filter(c => c.status === 'pending');
  pendingCorrections.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  // #552: 'reviewed' y 'verified' son estados intermedios reales del reporte. Si
  // no cuentan como cerrados, la fila desaparece de las dos listas del tablero y
  // el reporte queda sin rastro acá (la bandeja sí lo sigue mostrando).
  const resolvedCorrections = corrections.filter(c => ['resolved', 'reviewed', 'verified'].includes(c.status));
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
        <div class="class-list-files">Vence ${formatDueDate(deadline.dueDate)} · Clase ${cls?.title || deadline.classId}</div>
      </div>
      <div class="class-list-actions">
        <span class="badge badge-primary">${deadline.notifyOnDayBefore ? '1 día antes' : 'Solo el día'}</span>
        <button class="btn btn-secondary btn-sm btn-edit-deadline" data-deadline-id="${deadline.id}">Editar</button>
        <button class="btn btn-danger btn-sm btn-delete-deadline" data-deadline-id="${deadline.id}">Eliminar</button>
      </div>
    </div>
  `;

  const integrityBanner = (integrityAlerts || []).length === 0 ? '' : `
    <div class="card" style="border-left:4px solid var(--color-warning);margin-bottom:var(--space-6);padding:var(--space-4)">
      <div class="class-list-title" style="display:flex;align-items:center;gap:var(--space-2)">
        ${icon('alert')} Índice de conocimiento — ${escapeHtml(activeSubjectName)}
      </div>
      ${(integrityAlerts || []).map(n => `
        <div style="margin-top:var(--space-3)">
          <div class="class-list-topics">${escapeHtml(n.message || n.title || '')}</div>
          <div class="class-list-files">${escapeHtml(formatNotificationDate(n.createdAt))}</div>
        </div>
      `).join('')}
      <div class="class-list-files" style="margin-top:var(--space-3)">
        Revisá los materiales de la unidad: los fragmentos cuya metadata no cierra contra el registro no se citan en las respuestas del chat hasta regularizarlos.
      </div>
    </div>
  `;

  container.innerHTML = `
    ${integrityBanner}
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

    <div class="section-title" style="margin-top:var(--space-10)"><h2>${icon('clock')} Tareas y deadlines</h2><div class="line"></div></div>
    <div style="margin-bottom:var(--space-4);display:flex;gap:var(--space-3)">
      <button class="btn btn-primary" id="create-task-btn">${icon('target')} Crear tarea</button>
    </div>
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
              <div class="class-list-topics">${escapeHtml(item.message || item.issueDetail || 'Sin detalle provisto.')}</div>
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

    <div class="section-title" style="margin-top:var(--space-10)"><h2>${icon('alert')} Disputas de nota</h2><div class="line"></div></div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Disputas pendientes de revisión</span>
        <span class="badge badge-warning">${(disputes || []).length}</span>
      </div>
      <div class="class-list" id="dashboard-disputes-list">
        ${(disputes || []).length > 0 ? disputes.map((item) => `
          <div class="class-list-item" style="align-items:flex-start" data-dispute-id="${escapeHtml(item.disputeId)}">
            <div class="class-list-date">${icon('alert')}</div>
            <div class="class-list-info">
              <div class="class-list-title">${escapeHtml(item.taskTitle || item.taskId)} — ${escapeHtml(item.studentName || item.studentId)}</div>
              <div class="class-list-topics">${escapeHtml(item.reason || 'Sin detalle provisto.')}</div>
              <div class="class-list-files">Nota actual: ${item.originalGrade != null ? item.originalGrade : '—'} · ${item.createdAt ? (() => { const d = new Date(item.createdAt); return isNaN(d.getTime()) ? '---' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); })() : '---'}</div>
            </div>
            <div class="class-list-actions" style="gap:var(--space-2)">
              <button class="btn btn-secondary btn-sm dispute-resolve-btn" data-dispute-id="${escapeHtml(item.disputeId)}">Resolver</button>
              <button class="btn btn-danger btn-sm dispute-reject-btn" data-dispute-id="${escapeHtml(item.disputeId)}">Rechazar</button>
            </div>
          </div>
        `).join('') : '<div class="empty-state" style="padding:24px">No hay disputas de nota pendientes.</div>'}
      </div>
    </div>

    ${(closedDisputes || []).length > 0 ? `
    <div class="section-title" style="margin-top:var(--space-10)"><h2>${icon('alert')} Resoluciones de disputas</h2><div class="line"></div></div>
    <div class="card">
      <div class="card-header">
        <span class="card-title">Disputas resueltas o rechazadas</span>
        <span class="badge badge-neutral">${closedDisputes.length}</span>
      </div>
      <div class="class-list" id="dashboard-closed-disputes-list">
        ${closedDisputes.map((item) => `
          <div class="class-list-item" style="align-items:flex-start" data-closed-dispute-id="${escapeHtml(item.disputeId)}">
            <div class="class-list-date">${icon('alert')}</div>
            <div class="class-list-info">
              <div class="class-list-title">${escapeHtml(item.taskTitle || item.taskId)} — ${escapeHtml(item.studentName || item.studentId)} <span class="badge ${item.status === 'resolved' ? 'badge-success' : 'badge-error'}">${item.status === 'resolved' ? 'Resuelta' : 'Rechazada'}</span></div>
              <div class="class-list-topics">${escapeHtml(item.resolutionNote || (item.status === 'resolved' ? 'Resuelta a favor (sin motivo registrado).' : 'Rechazada (sin motivo registrado).'))}</div>
              <div class="class-list-files">Nota: ${item.originalGrade != null ? item.originalGrade : '—'}${item.resolvedGrade != null ? ` → ${item.resolvedGrade}` : ''} · Resolvió: ${escapeHtml(item.resolvedBy || 'sin registro')} · ${item.resolvedAt ? (() => { const d = new Date(item.resolvedAt); return isNaN(d.getTime()) ? '---' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); })() : '---'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
    <div class="card" id="student-progress-section">
      <div style="padding:var(--space-4);text-align:center;color:var(--color-text-secondary);font-size:var(--text-sm)" class="animate-pulse">Cargando progreso de alumnos...</div>
    </div>

    <div id="weights-section"></div>
  `;

  const weightsSection = container.querySelector('#weights-section');
  renderSubjectWeights(weightsSection, activeSubjectId, activeSubjectName);

  // ─── Student Progress Section ──────────────────────────────
  (async () => {
    const progressSection = container.querySelector('#student-progress-section');
    if (!progressSection) return;
    try {
      const [classViews, enrollments, allUsers] = await Promise.all([
        api.getClassViews(activeSubjectId),
        api.getEnrollmentsBySubject(activeSubjectId).catch(() => []),
        api.getAdminUsers().catch(() => []),
      ]);

      const studentEnrollments = (enrollments || []).filter(e => e.role === 'student' && e.status === 'active');
      const validStudentIds = new Set(studentEnrollments.map(e => e.userId));
      // Only show students actually enrolled in the subject (ignore stale classViews like anonymous)
      const studentIds = [...validStudentIds].filter(Boolean);

      if (studentIds.length === 0 || classes.length === 0) {
        progressSection.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--text-sm)">No hay alumnos inscriptos o clases para mostrar progreso.</div>';
        return;
      }

      const usersById = new Map(allUsers.map(u => [u.id || u.userId, u]));
      const studentNames = {};
      for (const sid of studentIds) {
        const u = usersById.get(sid);
        studentNames[sid] = u ? (u.name ? `${u.name} ${u.surname || ''}`.trim() : u.email) : sid;
      }

      const viewsByStudent = {};
      for (const v of classViews) {
        if (!viewsByStudent[v.studentId]) viewsByStudent[v.studentId] = new Set();
        viewsByStudent[v.studentId].add(v.classId);
      }

      const sortedClasses = [...classes].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      progressSection.innerHTML = `
        <div style="overflow-x:auto;padding:var(--space-2)">
          <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm)">
            <thead>
              <tr>
                <th style="text-align:left;padding:var(--space-2) var(--space-3);border-bottom:2px solid var(--color-border);white-space:nowrap;font-weight:600;position:sticky;left:0;background:var(--color-surface);">Alumno</th>
                ${sortedClasses.map(c => `
                  <th style="text-align:center;padding:var(--space-2) var(--space-1);border-bottom:2px solid var(--color-border);white-space:nowrap;font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.title)}">${escapeHtml(c.title).split('—')[1]?.trim() || escapeHtml(c.title).slice(0, 20)}</th>
                `).join('')}
                <th style="text-align:center;padding:var(--space-2) var(--space-3);border-bottom:2px solid var(--color-border);white-space:nowrap;font-weight:600;">% Visto</th>
              </tr>
            </thead>
            <tbody>
              ${studentIds.map(sid => {
                const viewed = viewsByStudent[sid] || new Set();
                const viewedCount = sortedClasses.filter(c => c.summaryReady && viewed.has(c.id)).length;
                const availableCount = sortedClasses.filter(c => c.summaryReady).length;
                const pct = availableCount > 0 ? Math.round((viewedCount / availableCount) * 100) : 0;
                return `
                  <tr>
                    <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);font-weight:500;white-space:nowrap;position:sticky;left:0;background:var(--color-surface);">${escapeHtml(studentNames[sid] || sid)}</td>
                    ${sortedClasses.map(c => {
                      if (!c.summaryReady) return '<td style="text-align:center;padding:var(--space-2);border-bottom:1px solid var(--color-border);color:var(--color-text-muted)">—</td>';
                      const seen = viewed.has(c.id);
                      return `
                        <td style="text-align:center;padding:var(--space-2);border-bottom:1px solid var(--color-border);">
                          <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${seen ? 'var(--color-success)' : 'var(--color-surface-2)'};color:${seen ? 'white' : 'var(--color-text-muted)'};font-size:11px;line-height:18px;font-weight:700;">${seen ? '✓' : '·'}</span>
                        </td>
                      `;
                    }).join('')}
                    <td style="text-align:center;padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);font-weight:600;">${pct}%</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div style="padding:var(--space-2) var(--space-3);font-size:10px;color:var(--color-text-muted);border-top:1px solid var(--color-border);display:flex;gap:var(--space-4);align-items:center;">
          <span>👤 ${studentIds.length} alumnos</span>
          <span>📚 ${sortedClasses.length} clases</span>
          <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--color-success);"></span> Visto</span>
          <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--color-surface-2);"></span> No visto</span>
          <span style="display:flex;align-items:center;gap:4px;color:var(--color-text-muted);">— No disponible</span>
        </div>
      `;
    } catch (err) {
      console.error('[Teacher Dashboard] Error loading student progress:', err);
      progressSection.innerHTML = '<div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--text-sm)">Error al cargar progreso de alumnos.</div>';
    }
  })();

  container.querySelector('#create-task-btn')?.addEventListener('click', () => {
    showCreateTaskModal(activeSubjectId, classes, container);
  });

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
      // Custom modal (not native confirm): visible to assistive tech and to
      // automation, consistent with the class-delete flow (#335).
      const shouldDelete = await showConfirmDialog({
        title: 'Eliminar deadline',
        message: `¿Eliminar el deadline "${deadline.title}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        danger: true,
      });
      if (!shouldDelete) return;
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

  /* ── Dispute resolve / reject ──────────────────────────── */
  container.querySelectorAll('.dispute-resolve-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const disputeId = btn.getAttribute('data-dispute-id');
      const dispute = (disputes || []).find(d => d.disputeId === disputeId);
      if (!dispute) return;
      showDisputeResolveModal(activeSubjectId, dispute, container);
    });
  });
  container.querySelectorAll('.dispute-reject-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Route through the modal so every decision records a written rationale
      // (UJ-41): resolveGradeDispute now carries `reason`.
      const disputeId = btn.getAttribute('data-dispute-id');
      const dispute = (disputes || []).find(d => d.disputeId === disputeId);
      if (!dispute) return;
      showDisputeResolveModal(activeSubjectId, dispute, container);
    });
  });

  if (deadlines.length > 0) {
    console.debug('[Teacher Dashboard] Deadlines cargados:', deadlines.length);
  }

  /* ── Onboarding trigger (first login) ───────────────── */
  requestAnimationFrame(() => {
    // #375: abrir sola solo la primera vez; omitirla no la vuelve a disparar.
    if (shouldAutoStartOnboarding('teacher')) {
      const engine = new OnboardingEngine({ role: 'teacher', steps: TEACHER_ONBOARDING_STEPS });
      engine.start();
    }
  });
}

/* ── Task Creation Modal ────────────────────────────────── */
function showCreateTaskModal(subjectId, classes, container) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:540px;width:92%">
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h3 class="h4" style="margin:0">Crear tarea</h3>
        <button type="button" class="btn btn-ghost btn-sm modal-close-btn" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div class="form-group">
          <label class="form-label">Título <span class="text-error">*</span></label>
          <input class="form-input" id="task-title" placeholder="Ej: Trabajo Práctico N°3" />
        </div>
        <div class="form-group">
          <label class="form-label">Descripción</label>
          <textarea class="form-textarea" id="task-description" placeholder="Descripción de la tarea..." style="min-height:80px"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Clases vinculadas</label>
          <button type="button" class="btn btn-secondary btn-sm" id="task-link-classes-btn" aria-expanded="false" aria-controls="task-classes-container">${icon('link')} Vincular a clases</button>
          <div style="display:none;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md)" id="task-classes-container" role="group" aria-label="Seleccionar clases">
            ${(classes || []).map(c => `
              <label class="badge badge-neutral" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;padding:6px 12px;">
                <input type="checkbox" class="task-class-checkbox" value="${c.id}" />
                ${c.title || c.id}
              </label>
            `).join('')}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
          <div class="form-group">
            <label class="form-label">Peso / Porcentaje <span class="text-error">*</span></label>
            <input type="number" class="form-input" id="task-weight" min="0" max="100" value="10" placeholder="25" />
          </div>
          <div class="form-group">
            <label class="form-label">Fecha de entrega <span class="text-error">*</span></label>
            <input type="date" class="form-input" id="task-duedate" />
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost modal-close-btn">Cancelar</button>
        <button type="button" class="btn btn-primary" id="task-save-btn">Crear tarea</button>
      </div>
    </div>
  `;

  const cleanup = () => overlay.remove();
  overlay.querySelectorAll('.modal-close-btn').forEach(btn => btn.addEventListener('click', cleanup));
  overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(); });

  /* ── 'Vincular a clases' toggle: reveals the class multi-select ── */
  const linkClassesBtn = overlay.querySelector('#task-link-classes-btn');
  const classesContainer = overlay.querySelector('#task-classes-container');
  if (linkClassesBtn && classesContainer) {
    const toggleClasses = () => {
      const visible = classesContainer.style.display !== 'flex';
      classesContainer.style.display = visible ? 'flex' : 'none';
      linkClassesBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
      linkClassesBtn.innerHTML = visible
        ? `${icon('link')} Ocultar clases`
        : `${icon('link')} Vincular a clases`;
      if (visible) {
        const firstCheckbox = classesContainer.querySelector('.task-class-checkbox');
        if (firstCheckbox) firstCheckbox.focus();
      }
    };
    linkClassesBtn.addEventListener('click', toggleClasses);
  }

  overlay.querySelector('#task-save-btn')?.addEventListener('click', async () => {
    const title = overlay.querySelector('#task-title').value.trim();
    const description = overlay.querySelector('#task-description').value.trim();
    const weight = parseInt(overlay.querySelector('#task-weight').value, 10);
    const dueDate = overlay.querySelector('#task-duedate').value;
    const selectedClasses = [...overlay.querySelectorAll('.task-class-checkbox:checked')].map(cb => cb.value);

    if (!title || !dueDate || !weight) {
      const { toast } = await import('../../components/Toast.js');
      toast('error', 'Campos requeridos', 'Completá título, peso y fecha de entrega.');
      return;
    }

    if (selectedClasses.length === 0) {
      const { toast } = await import('../../components/Toast.js');
      toast('error', 'Campos requeridos', 'Seleccioná al menos una clase vinculada.');
      if (linkClassesBtn && classesContainer && classesContainer.style.display !== 'flex') {
        linkClassesBtn.click();
      }
      return;
    }

    overlay.querySelector('#task-save-btn').disabled = true;
    overlay.querySelector('#task-save-btn').textContent = 'Creando...';

    try {
      await api.saveDeadline({
        title,
        description,
        subjectId,
        classIds: selectedClasses,
        classId: selectedClasses[0],
        dueDate,
        weight,
        notifyOnDayBefore: true,
        notifyOnDayOf: true,
        status: 'pending',
      });
      const { toast } = await import('../../components/Toast.js');
      toast('success', 'Tarea creada', 'La tarea fue creada y aparecerá en las tareas de los alumnos.');
      cleanup();
      renderTeacherDashboard(container);
    } catch (err) {
      const { toast } = await import('../../components/Toast.js');
      toast('error', 'Error', err.message || 'No se pudo crear la tarea.');
      overlay.querySelector('#task-save-btn').disabled = false;
      overlay.querySelector('#task-save-btn').textContent = 'Crear tarea';
    }
  });

  document.body.appendChild(overlay);
}

/* ── Deadline Edit Modal ────────────────────────────────── */
function showDeadlineEditModal(deadline, classes, subjectId, container) {
  const linkedClassIds = (deadline.classIds || [deadline.classId]).filter(Boolean);
  const linkedCount = classes.filter(c => linkedClassIds.includes(c.id)).length;
  const linkBtnLabel = linkedCount > 0
    ? `Vincular a clases (${linkedCount} vinculada${linkedCount === 1 ? '' : 's'})`
    : 'Vincular a clases';

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
          <label class="form-label">Clases vinculadas</label>
          <button type="button" class="btn btn-secondary btn-sm" id="edit-link-classes-btn" aria-expanded="false" aria-controls="edit-deadline-classes">${icon('link')} ${linkBtnLabel}</button>
          <div style="display:none;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-3);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md)" id="edit-deadline-classes" role="group" aria-label="Seleccionar clases">
            ${(classes || []).map(c => `
              <label class="badge badge-neutral" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;padding:6px 12px;">
                <input type="checkbox" class="edit-deadline-class-checkbox" value="${c.id}" ${linkedClassIds.includes(c.id) ? 'checked' : ''} />
                ${c.title || c.id}
              </label>
            `).join('')}
          </div>
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
          <label class="form-label">Motivo del cambio (opcional)</label>
          <textarea class="form-textarea" id="edit-deadline-reason" style="min-height:60px" placeholder="Por qué se mueve la fecha. Queda en el aviso que reciben los alumnos."></textarea>
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

  /* ── 'Vincular a clases' toggle: reveals the class multi-select ── */
  const editLinkBtn = overlay.querySelector('#edit-link-classes-btn');
  const editClassesContainer = overlay.querySelector('#edit-deadline-classes');
  if (editLinkBtn && editClassesContainer) {
    const toggleEditClasses = () => {
      const visible = editClassesContainer.style.display !== 'flex';
      editClassesContainer.style.display = visible ? 'flex' : 'none';
      editLinkBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
      const checkedCount = [...editClassesContainer.querySelectorAll('.edit-deadline-class-checkbox:checked')].length;
      editLinkBtn.innerHTML = visible
        ? `${icon('link')} Ocultar clases`
        : `${icon('link')} Vincular a clases${checkedCount > 0 ? ` (${checkedCount} vinculada${checkedCount === 1 ? '' : 's'})` : ''}`;
    };
    editLinkBtn.addEventListener('click', toggleEditClasses);
  }

  overlay.querySelector('#edit-deadline-save').addEventListener('click', async () => {
    const title = overlay.querySelector('#edit-deadline-title').value.trim();
    if (!title) return;
    const selectedClasses = [...overlay.querySelectorAll('.edit-deadline-class-checkbox:checked')].map(cb => cb.value);
    if (selectedClasses.length === 0) {
      toast('error', 'Campos requeridos', 'Seleccioná al menos una clase vinculada.');
      if (editLinkBtn && editClassesContainer && editClassesContainer.style.display !== 'flex') {
        editLinkBtn.click();
      }
      return;
    }
    try {
      await api.saveDeadline({
        ...deadline,
        title,
        classIds: selectedClasses,
        classId: selectedClasses[0],
        dueDate: overlay.querySelector('#edit-deadline-date').value,
        description: overlay.querySelector('#edit-deadline-description').value.trim(),
        changeReason: (overlay.querySelector('#edit-deadline-reason')?.value || '').trim(),
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

function showDisputeResolveModal(subjectId, dispute, container) {
  if (!dispute) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:520px;width:92%">
      <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <h3 class="h4" style="margin:0">Resolver disputa de nota</h3>
        <button type="button" class="btn btn-ghost btn-sm modal-close-btn" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="background:var(--color-surface-2);border-radius:var(--radius-md);padding:var(--space-4)">
          <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-1)">Tarea</div>
          <div style="font-weight:600;font-size:var(--font-size-sm)">${escapeHtml(dispute.taskTitle || dispute.taskId)}</div>
          <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:var(--space-2)">Alumno: ${escapeHtml(dispute.studentName || dispute.studentId)} · Nota actual: ${dispute.originalGrade != null ? dispute.originalGrade : '—'}</div>
          <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--color-border)">
            <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-1)">Motivo del alumno</div>
            <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);line-height:1.5">${escapeHtml(dispute.reason || 'Sin detalle provisto.')}</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Nueva nota (si se resuelve a favor)</label>
          <input type="number" class="form-input" id="dispute-new-grade" min="0" max="10" step="0.1" value="${dispute.originalGrade != null ? dispute.originalGrade : 0}" />
        </div>
        <div class="form-group">
          <label class="form-label">Motivo de la decisión (queda registrado y se notifica al alumno)</label>
          <textarea class="form-input" id="dispute-resolution-note" style="min-height:80px;resize:vertical;" placeholder="Ej: el ejercicio 3 sigue sin cumplir el criterio X del material de la Clase 1."></textarea>
          <p id="dispute-resolution-error" style="display:none;margin-top:6px;color:var(--color-error);font-size:13px;"></p>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;gap:var(--space-2);justify-content:flex-end">
        <button type="button" class="btn btn-ghost modal-close-btn">Cancelar</button>
        <button type="button" class="btn btn-danger" id="dispute-modal-reject">Rechazar</button>
        <button type="button" class="btn btn-primary" id="dispute-modal-resolve">Resolver a favor</button>
      </div>
    </div>
  `;

  const cleanup = () => overlay.remove();
  overlay.querySelectorAll('.modal-close-btn').forEach(el => el.addEventListener('click', cleanup));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  const readNote = () => {
    const note = (overlay.querySelector('#dispute-resolution-note')?.value || '').trim();
    const errorEl = overlay.querySelector('#dispute-resolution-error');
    if (note.length < 10) {
      if (errorEl) { errorEl.textContent = 'Escribí un motivo de al menos 10 caracteres.'; errorEl.style.display = 'block'; }
      overlay.querySelector('#dispute-resolution-note')?.focus();
      return null;
    }
    if (errorEl) errorEl.style.display = 'none';
    return note;
  };

  overlay.querySelector('#dispute-modal-reject').addEventListener('click', async () => {
    const reason = readNote();
    if (!reason) return;
    if (!confirm('¿Rechazar esta disputa? Se notificará al alumno.')) return;
    try {
      await api.resolveGradeDispute({ disputeId: dispute.disputeId, subjectId, decision: 'rejected', reason });
      cleanup();
      toast('success', 'Disputa rechazada', 'Se notificó al alumno el resultado.');
      renderTeacherDashboard(container);
    } catch (err) {
      toast('error', 'Error', err.message || 'No se pudo rechazar la disputa.');
    }
  });

  overlay.querySelector('#dispute-modal-resolve').addEventListener('click', async () => {
    const newGrade = Number(overlay.querySelector('#dispute-new-grade').value);
    if (Number.isNaN(newGrade) || newGrade < 0 || newGrade > 10) {
      toast('error', 'Nota inválida', 'Ingresá una nota entre 0 y 10.');
      return;
    }
    const reason = readNote();
    if (!reason) return;
    if (!confirm(`¿Resolver a favor con nota ${newGrade}? Se notificará al alumno.`)) return;
    try {
      await api.resolveGradeDispute({ disputeId: dispute.disputeId, subjectId, decision: 'resolved', newGrade, reason });
      cleanup();
      toast('success', 'Disputa resuelta', 'Se notificó al alumno el resultado.');
      renderTeacherDashboard(container);
    } catch (err) {
      toast('error', 'Error', err.message || 'No se pudo resolver la disputa.');
    }
  });

  document.body.appendChild(overlay);
}

function icon(name) {
  const icons = {
    clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
    book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    activity: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
    link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  };

  return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.clock}</span>`;
}

function formatNotificationDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a deadline dueDate without the UTC off-by-one (#335).
 * Date-only values ("2026-12-15") parsed with `new Date()` land on midnight
 * UTC and render the previous day in es-AR (UTC-3); parsing them as local
 * noon keeps the calendar day the teacher picked. Full ISO datetimes pass
 * through unchanged.
 */
export function formatDueDate(dueDate) {
  if (!dueDate) return '—';
  const raw = String(dueDate);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const parsed = new Date(dateOnly ? `${raw}T12:00:00` : raw);
  if (isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}
