/* ============================================================
   Student Tasks — Priority task list + grades
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderStudentTasks(container) {
    renderHeader('Tareas & Notas');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando tareas...</div>`;

    const user = auth.getUser();
    const activeSubjectId = auth.getActiveSubjectId();
    let tasks;
    let deadlines;
    try {
      // fix #352: strict reads. A failed read must be reported, never rendered
      // as "¡No tenés tareas pendientes!".
      const [tasksData, deadlinesData] = await Promise.all([
        api.getTasks(user.id, { strict: true }),
        api.getDeadlines(activeSubjectId, { strict: true }),
      ]);
      tasks = Array.isArray(tasksData) ? tasksData : [];
      deadlines = Array.isArray(deadlinesData) ? deadlinesData : [];
    } catch (err) {
      renderLoadError(container, err, () => renderStudentTasks(container));
      return;
    }
    const classes = await api.getClasses(activeSubjectId).catch(() => []);

    const deadlineItems = (deadlines || [])
        .filter(d => d.subjectId === activeSubjectId && d.status !== 'completed')
        .map(d => ({
            id: d.id,
            title: d.title,
            description: d.description || '',
            subjectId: d.subjectId,
            type: 'deadline',
            // El peso de una entrega ya viene en la misma escala porcentual
            // (0–100) que usa el resto de la app —el docente lo carga como
            // "Peso / Porcentaje" y el dashboard lo muestra sin escalar—, así
            // que multiplicarlo por 100 acá lo mostraba como 1000%. Se usa el
            // valor tal cual (UJ-34).
            weight: d.weight || 0,
            dueDate: d.dueDate,
            status: 'pending',
            classIds: Array.isArray(d.classIds) && d.classIds.length > 0 ? d.classIds : (d.classId ? [d.classId] : []),
        }));
    // #355 (UJ-33): la prioridad deja de ser un orden oculto. Se conserva el
    // puntaje que ya ordenaba la lista (proximidad del vencimiento + peso) y se
    // calcula una sola vez, junto con los datos que la pantalla necesita para
    // explicarlo: el criterio aplicado, el puesto de cada entrega y el motivo
    // de ese puesto (compuesto con el peso y la fecha que ya existen).
    const allItems = [...tasks, ...deadlineItems];
    const pending = allItems
        .filter(t => t.status === 'pending')
        .map((item, index) => ({ item, index, priority: describePriority(item) }))
        .sort((a, b) => (b.priority.score - a.priority.score) || (a.index - b.index))
        .map((entry, index) => ({ ...entry.item, priority: { ...entry.priority, rank: index + 1 } }));
    const priorityCriteria = buildPriorityCriteria(pending);

    const completed = tasks
        .filter(t => t.status === 'completed')
        .sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate));
    const totalWeight = completed.reduce((a, t) => a + t.weight, 0);
    const weightedAvg = completed.length > 0
        ? completed.reduce((a, t) => a + (t.grade || 0) * t.weight, 0) / totalWeight
        : null;

    container.innerHTML = `
    <style>
      .task-row-hover:hover .dispute-btn { display: inline-flex !important; }
      .task-row-hover:hover .consult-ai-btn { opacity: 1 !important; }
    </style>
    <!-- KPIs -->
    <div class="grid-3" style="margin-bottom:var(--space-8)">
      <div class="kpi-card">
        <div class="kpi-label">Tareas pendientes</div>
        <div class="kpi-value">${pending.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Completadas</div>
        <div class="kpi-value" style="color:var(--color-success)">${completed.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Promedio ponderado</div>
        <div class="kpi-value" style="color:var(--color-primary-light)">${weightedAvg !== null ? weightedAvg.toFixed(1) : '—'}</div>
      </div>
    </div>

    <!-- Pending -->
    <div class="section-title"><h2>⏳ Pendientes</h2><div class="line"></div></div>
    ${pending.length === 0 ? `<div class="card" style="margin-bottom:var(--space-5)"><div class="empty-state" style="padding:32px"><span class="empty-state-icon">🎉</span><p>¡No tenés tareas pendientes!</p></div></div>` : `
    <div class="card" style="margin-bottom:var(--space-8)">
      <p id="priority-criteria" style="margin:0;padding:var(--space-4) var(--space-4) 0;font-size:13px;color:var(--color-text-secondary);line-height:1.5;">🎯 ${escapeHtml(priorityCriteria)}</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
                <th>Puesto</th>
                <th>Tarea</th>
                <th>Peso</th>
                <th>Vencimiento</th>
                <th>Urgencia</th>
                <th>Por qué este puesto</th>
                <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${pending.map(t => buildPendingRow(t, classes)).join('')}
          </tbody>
        </table>
      </div>
    </div>`}

    <!-- Completed -->
    <div class="section-title"><h2>✅ Completadas</h2><div class="line"></div></div>
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tarea</th>
              <th>Peso</th>
              <th>Nota</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${completed.map(t => buildCompletedRow(t, classes)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  bindDisputeEvents(container);
  bindConsultAIEvents(container);
  bindTaskDetailEvents(container, [...pending, ...completed], classes);
}

function renderLoadError(container, err, onRetry) {
  // fix #352: an unreadable list is not an empty list. Say so, and offer to retry.
  const message = err && err.message ? String(err.message) : 'No pudimos cargar tus entregas.';
  container.innerHTML = `
    <div class="card">
      <div class="empty-state" style="padding:32px">
        <span class="empty-state-icon">⚠️</span>
        <p>${escapeHtml(message)}</p>
        <p style="font-size:13px;color:var(--color-text-muted);max-width:520px;margin:0 auto;">
          No mostramos la lista porque no pudimos leerla: puede que tengas entregas que no estás viendo.
        </p>
        <button class="btn btn-primary" id="tasks-retry">Reintentar</button>
      </div>
    </div>`;
  const btn = container.querySelector('#tasks-retry');
  if (btn) {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Reintentando...';
      onRetry();
    });
  }
}

// #355 (UJ-33): criterio de orden explícito.
// La prioridad de una entrega combina, como antes, su peso con la cercanía de
// su vencimiento: `proximidad = 10 / (días que faltan + 1)` + `peso / 5`. Una
// entrega sin fecha de vencimiento válida no puede aportar cercanía, así que se
// ordena sólo por peso; cuando eso pasa, la pantalla lo declara.
const MS_PER_DAY = 86400000;

function describePriority(t) {
  const weight = Number.isFinite(Number(t?.weight)) ? Number(t.weight) : 0;
  const due = t?.dueDate ? new Date(t.dueDate) : null;
  const hasDueDate = !!due && !Number.isNaN(due.getTime());
  const daysUntil = hasDueDate ? Math.ceil((due - new Date()) / MS_PER_DAY) : null;
  const proximity = hasDueDate ? 10 / (Math.max(0, daysUntil) + 1) : 0;
  return {
    score: proximity + weight / 5,
    weight,
    hasDueDate,
    daysUntil,
    isOverdue: hasDueDate && daysUntil < 0,
    motive: buildPriorityMotive({ weight, hasDueDate, daysUntil }),
  };
}

function buildPriorityMotive({ weight, hasDueDate, daysUntil }) {
  const parts = ['pesa ' + weight + '%'];
  if (!hasDueDate) {
    parts.push('no tiene fecha de vencimiento, así que se ordena sólo por peso');
  } else if (daysUntil < 0) {
    const days = Math.abs(daysUntil);
    parts.push('venció hace ' + days + (days === 1 ? ' día' : ' días'));
  } else if (daysUntil === 0) {
    parts.push('vence hoy');
  } else {
    parts.push('vence en ' + daysUntil + (daysUntil === 1 ? ' día' : ' días'));
  }
  return parts.join(' y ');
}

function buildPriorityCriteria(items) {
  const base = 'Criterio de orden: prioridad = peso de la entrega + cercanía de su vencimiento. '
    + 'El puesto 1 es la entrega más prioritaria.';
  const sinFecha = (items || []).filter(t => t.priority && t.priority.hasDueDate === false).length;
  if (sinFecha === 0) return base;
  return base + ' ' + sinFecha + (sinFecha === 1 ? ' entrega no tiene' : ' entregas no tienen')
    + ' fecha de vencimiento: se ordena' + (sinFecha === 1 ? '' : 'n') + ' sólo por peso.';
}

function buildRelatedClassesHtml(t, classes) {
  const related = (classes || []).filter(c => (t.classIds || []).includes(c.id));
  if (related.length === 0) return '';
  const links = related.map(c => '<a href="#/student/class/' + c.id + '" style="color:var(--color-primary-light);text-decoration:none;">📄 ' + (c.title || c.id) + '</a>');
  return '<div style="margin-top:4px;font-size:11px;color:var(--color-text-muted);">' + links.join(' · ') + '</div>';
}

function buildPendingRow(t, classes) {
  const priority = t.priority || {};
  const daysUntil = priority.hasDueDate ? priority.daysUntil : null;
  const urgency = !priority.hasDueDate ? { label: '⚪ Sin fecha', badge: 'badge-neutral' }
      : priority.isOverdue ? { label: '🔴 Vencida', badge: 'badge-error' }
          : daysUntil <= 3 ? { label: '🔴 Alta', badge: 'badge-error' }
              : daysUntil <= 7 ? { label: '🟡 Media', badge: 'badge-warning' }
                  : { label: '🔵 Normal', badge: 'badge-info' };
  const weightLabel = t.weight >= 20 ? 'badge-primary' : 'badge-neutral';
  const relatedHtml = buildRelatedClassesHtml(t, classes);
  const dueLabel = priority.hasDueDate
    ? new Date(t.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
    : 'Sin fecha';
  const detailBtn = (t.classIds || []).length > 0
    ? '<button class="btn btn-ghost btn-sm task-detail-btn" data-task-id="' + escapeHtml(t.id) + '" title="Ver detalle y materiales relacionados" style="font-size:11px;color:var(--color-primary-light);margin-top:4px;padding:2px 8px;">Ver detalle</button>'
    : '';
  return '<tr><td class="priority-rank-cell"><strong>' + (priority.rank || '—') + '</strong></td><td><strong>' + t.title + '</strong>' + relatedHtml + detailBtn + '</td><td><span class="badge ' + weightLabel + '">' + t.weight + '%</span></td><td>' + dueLabel + '</td><td><span class="badge ' + urgency.badge + '">' + urgency.label + '</span></td><td class="priority-motive-cell" style="font-size:13px;color:var(--color-text-secondary)">' + escapeHtml(priority.motive || '') + '</td><td><span class="badge badge-warning">⏳ Pendiente</span></td></tr>';
}

function buildCompletedRow(t, classes) {
  const relatedHtml = buildRelatedClassesHtml(t, classes);
  const detailBtn = (t.classIds || []).length > 0
    ? '<button class="btn btn-ghost btn-sm task-detail-btn" data-task-id="' + escapeHtml(t.id) + '" title="Ver detalle y materiales relacionados" style="font-size:11px;color:var(--color-primary-light);margin-top:4px;padding:2px 8px;">Ver detalle</button>'
    : '';
  const gradeColor = (t.grade || 0) >= 6 ? 'var(--color-success)' : 'var(--color-error)';
  const consultAiBtn = t.grade !== null
    ? '<button class="btn btn-ghost btn-sm consult-ai-btn" data-ai-task-title="' + escapeHtml(t.title) + '" style="margin-left:8px;font-size:12px;color:var(--color-primary-light);" title="Consultar con IA">🤖 Consultar con IA</button>'
    : '';
  const disputeBtn = t.grade !== null
    ? '<button class="btn btn-ghost btn-sm dispute-btn" data-task-id="' + t.id + '" data-task-title="' + escapeHtml(t.title) + '" data-grade="' + t.grade + '" style="margin-left:8px;font-size:12px;color:var(--color-warning);display:none;" title="Disputar nota">Disputar nota</button>'
    : '';
  const statusBadge = t.status === 'disputed'
    ? '<span class="badge badge-warning">🟡 En disputa</span>'
    : '<span class="badge badge-success">✅ Aprobado</span>';
  return '<tr class="task-row-hover"><td>' + t.title + relatedHtml + detailBtn + '</td><td><span class="badge badge-neutral">' + t.weight + '%</span></td><td><strong style="color:' + gradeColor + '">' + (t.grade !== null ? t.grade.toFixed(1) : '—') + '</strong>' + consultAiBtn + disputeBtn + '</td><td>' + statusBadge + '</td></tr>';
}

function bindDisputeEvents(container) {
  container.querySelectorAll('.dispute-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.taskId;
      const taskTitle = btn.dataset.taskTitle;
      const currentGrade = btn.dataset.grade;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-content" style="max-width:500px;width:92%;">
          <div class="modal-header">
            <h3 class="h4" style="margin:0;">Disputar nota</h3>
            <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom:12px;">
              <strong>Tarea:</strong> ${taskTitle}<br>
              <strong>Nota actual:</strong> ${currentGrade}
            </div>
            <div>
              <label class="form-label" for="dispute-reason" style="font-weight:600;">Explicá por qué creés que la nota debería revisarse</label>
              <textarea id="dispute-reason" class="form-input" style="min-height:100px;resize:vertical;" placeholder="Ej: el ejercicio 3 está correcto según lo que vimos en clase..."></textarea>
              <p id="dispute-error" style="display:none;margin-top:6px;color:var(--color-error);font-size:13px;"></p>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost dialog-cancel">Cancelar</button>
            <button type="button" class="btn btn-primary dialog-confirm" id="dispute-submit-btn" disabled>Enviar disputa</button>
          </div>
        </div>
      `;

      const textarea = overlay.querySelector('#dispute-reason');
      const errorEl = overlay.querySelector('#dispute-error');
      const submitBtn = overlay.querySelector('#dispute-submit-btn');

      const cleanup = () => overlay.remove();

      textarea.addEventListener('input', () => {
        submitBtn.disabled = (textarea.value || '').trim().length < 20;
        errorEl.style.display = 'none';
      });

      overlay.querySelector('.dialog-close')?.addEventListener('click', cleanup);
      overlay.querySelector('.dialog-cancel')?.addEventListener('click', cleanup);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(); });
      // Fix #346: same route-leak cleanup as the detail modal.
      window.addEventListener('hashchange', cleanup, { once: true });

      submitBtn.addEventListener('click', async () => {
        const val = (textarea.value || '').trim();
        if (val.length < 20) {
          errorEl.textContent = 'Debe tener al menos 20 caracteres.';
          errorEl.style.display = 'block';
          textarea.focus();
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';
        try {
          await api.submitGradeDispute({
            taskId,
            reason: val,
            taskTitle,
            studentName: auth.getUser().name,
            subjectId: auth.getActiveSubjectId(),
            originalGrade: currentGrade,
          });
          cleanup();
          const { toast } = await import('../../components/Toast.js');
          toast('success', 'Disputa enviada', 'El docente recibió una notificación para revisar la nota.');
          btn.closest('tr').querySelector('.badge').textContent = '🟡 En disputa';
          btn.closest('tr').querySelector('.badge').className = 'badge badge-warning';
          btn.style.display = 'none';
        } catch (err) {
          const { toast } = await import('../../components/Toast.js');
          toast('error', 'Error', err?.message || 'No se pudo enviar la disputa.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar disputa';
        }
      });

      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') cleanup();
      });

      document.body.appendChild(overlay);
      setTimeout(() => textarea.focus(), 100);
    });
  });
}

function bindConsultAIEvents(container) {
  container.querySelectorAll('.consult-ai-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskTitle = btn.dataset.aiTaskTitle;
      const preset = `Hola, tengo una consulta sobre la correccion y criterios de evaluacion de ${taskTitle}`;
      window.location.hash = `#/student/dashboard?preset=${encodeURIComponent(preset)}`;
    });
  });
}

function bindTaskDetailEvents(container, tasks, classes) {
  const taskLookup = {};
  (tasks || []).forEach(t => { taskLookup[t.id] = t; });
  container.querySelectorAll('.task-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const task = taskLookup[btn.dataset.taskId];
      if (!task) return;
      showTaskDetailModal(task, classes);
    });
  });
}

function showTaskDetailModal(task, classes) {
  const related = (classes || []).filter(c => (task.classIds || []).includes(c.id));
  const statusLabel = task.status === 'completed'
    ? (task.grade !== null ? '✅ Aprobado · ' + task.grade.toFixed(1) : '✅ Completada')
    : '⏳ Pendiente';
  const dueLabel = task.dueDate
    ? new Date(task.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
    : '—';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:520px;width:92%;">
      <div class="modal-header">
        <h3 class="h4" style="margin:0;">${escapeHtml(task.title)}</h3>
        <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-3);">
        ${task.description ? `<div style="font-size:14px;color:var(--color-text-secondary);line-height:1.5;">${escapeHtml(task.description)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
          <span class="badge badge-neutral">Vence ${dueLabel}</span>
          <span class="badge badge-neutral">Peso ${task.weight}%</span>
          <span class="badge badge-${task.status === 'completed' ? 'success' : 'warning'}">${statusLabel}</span>
        </div>
        <div style="margin-top:var(--space-2);padding-top:var(--space-4);border-top:1px solid var(--color-border);">
          <div style="font-weight:600;margin-bottom:var(--space-3);">📚 Materiales relacionados</div>
          ${related.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:var(--space-2);">
              ${related.map(c => `
                <a href="#/student/class/${encodeURIComponent(c.id)}" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--radius-sm);background:var(--color-surface-2);text-decoration:none;color:var(--color-text-primary);font-size:14px;font-weight:500;">
                  <span>📄</span> ${escapeHtml(c.title || c.id)}
                </a>
              `).join('')}
            </div>
            <div style="margin-top:var(--space-3);font-size:12px;color:var(--color-text-muted);">Cada clase incluye sus materiales de referencia.</div>
          ` : '<div style="font-size:13px;color:var(--color-text-muted);">Esta tarea no tiene clases vinculadas.</div>'}
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost dialog-close">Cerrar</button>
      </div>
    </div>
  `;

  const cleanup = () => overlay.remove();
  overlay.querySelectorAll('.dialog-close').forEach(el => el.addEventListener('click', cleanup));
  overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') cleanup(); });
  // Fix #346: the "Ver detalle" modal leaked across routes (it mounts on
  // document.body, outside the page container that the router replaces).
  window.addEventListener('hashchange', cleanup, { once: true });
  document.body.appendChild(overlay);
}
