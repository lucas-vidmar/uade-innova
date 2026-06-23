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
    const tasksData = await api.getTasks(user.id);
    const tasks = Array.isArray(tasksData) ? tasksData : [];
    const classes = await api.getClasses(auth.getActiveSubjectId()).catch(() => []);

    // Sort logic: Score = (weight / 10) + (10 / (Math.max(1, daysUntil)))
    // Higher score = more prioritized
    const calculatePriority = (t) => {
        const daysUntil = Math.max(0, Math.ceil((new Date(t.dueDate) - new Date()) / 86400000));
        const proximity = 10 / (daysUntil + 1);
        const weightFactor = t.weight / 5;
        return proximity + weightFactor;
    };

    const pending = tasks
        .filter(t => t.status === 'pending')
        .sort((a, b) => calculatePriority(b) - calculatePriority(a));

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
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
                <th>Prioridad</th>
                <th>Tarea</th>
                <th>Peso</th>
                <th>Vencimiento</th>
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
}

function buildRelatedClassesHtml(t, classes) {
  const related = (classes || []).filter(c => (t.classIds || []).includes(c.id));
  if (related.length === 0) return '';
  const links = related.map(c => '<a href="#/student/class/' + c.id + '" style="color:var(--color-primary-light);text-decoration:none;">📄 ' + (c.title || c.id) + '</a>');
  return '<div style="margin-top:4px;font-size:11px;color:var(--color-text-muted);">' + links.join(' · ') + '</div>';
}

function buildPendingRow(t, classes) {
  const daysUntil = Math.ceil((new Date(t.dueDate) - new Date()) / 86400000);
  const urgency = daysUntil <= 3 ? { label: '🔴 Alta', badge: 'badge-error' }
      : daysUntil <= 7 ? { label: '🟡 Media', badge: 'badge-warning' }
          : { label: '🔵 Normal', badge: 'badge-info' };
  const weightLabel = t.weight >= 20 ? 'badge-primary' : 'badge-neutral';
  const relatedHtml = buildRelatedClassesHtml(t, classes);
  return '<tr><td><span class="badge ' + urgency.badge + '">' + urgency.label + '</span></td><td><strong>' + t.title + '</strong>' + relatedHtml + '</td><td><span class="badge ' + weightLabel + '">' + t.weight + '%</span></td><td>' + new Date(t.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) + '</td><td><span class="badge badge-warning">⏳ Pendiente</span></td></tr>';
}

function buildCompletedRow(t, classes) {
  const relatedHtml = buildRelatedClassesHtml(t, classes);
  const gradeColor = (t.grade || 0) >= 6 ? 'var(--color-success)' : 'var(--color-error)';
  const disputeBtn = t.grade !== null
    ? '<button class="btn btn-ghost btn-sm dispute-btn" data-task-id="' + t.id + '" data-task-title="' + escapeHtml(t.title) + '" data-grade="' + t.grade + '" style="margin-left:8px;font-size:12px;color:var(--color-warning);display:none;" title="Disputar nota">Disputar nota</button>'
    : '';
  const statusBadge = t.status === 'disputed'
    ? '<span class="badge badge-warning">🟡 En disputa</span>'
    : '<span class="badge badge-success">✅ Aprobado</span>';
  return '<tr class="task-row-hover"><td>' + t.title + relatedHtml + '</td><td><span class="badge badge-neutral">' + t.weight + '%</span></td><td><strong style="color:' + gradeColor + '">' + (t.grade !== null ? t.grade.toFixed(1) : '—') + '</strong>' + disputeBtn + '</td><td>' + statusBadge + '</td></tr>';
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
          await api.submitGradeDispute({ taskId, reason: val });
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
