/* ============================================================
   Teacher Dashboard — Cátedra overview
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

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
  const [classes, deadlines] = await Promise.all([
    api.getClasses(activeSubjectId),
    api.getDeadlines(activeSubjectId),
  ]);

  const complete = classes.filter(c => c.summaryReady);
  const processing = classes.filter(c => !c.summaryReady && c.materials.length > 0);
  const empty = classes.filter(c => c.materials.length === 0);

  const renderDeadlineRow = (deadline, cls) => `
    <div class="class-list-item" style="align-items:flex-start">
      <div class="class-list-date">⏰</div>
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

    <div class="section-title"><h2>📚 Cronograma — ${activeSubjectName}</h2><div class="line"></div></div>
    <div class="class-list">
      ${classes.map(c => {
        const ready = c.summaryReady;
        const hasFiles = c.materials.length > 0 && !ready;
        const status = ready ? { icon: '✅', label: 'Material completo', badge: 'badge-success' }
          : hasFiles ? { icon: '⚙️', label: 'Procesando', badge: 'badge-warning' }
            : { icon: '📭', label: 'Sin material', badge: 'badge-neutral' };
        return `
          <div class="class-list-item">
            <div class="class-list-date">${new Date(c.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</div>
            <div class="class-list-info">
              <div class="class-list-title">${c.title}</div>
              <div class="class-list-topics">${c.topics.slice(0, 3).join(' · ')}</div>
              ${c.materials.length > 0 ? `<div class="class-list-files">${c.materials.length} archivo${c.materials.length !== 1 ? 's' : ''} cargado${c.materials.length !== 1 ? 's' : ''}</div>` : ''}
            </div>
            <div class="class-list-actions">
              <span class="badge ${status.badge}">${status.icon} ${status.label}</span>
              <a href="#/teacher/upload?class=${c.id}" class="btn btn-secondary btn-sm">📤 Cargar</a>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="section-title" style="margin-top:var(--space-10)"><h2>⏳ Deadlines por clase</h2><div class="line"></div></div>
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
              ${classes.map(c => `<option value="${c.id}">${c.title}</option>`).join('')}
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
        <span class="badge badge-info">${deadlines.length}</span>
      </div>
      <div class="class-list">
        ${deadlines.length > 0 ? deadlines.map(d => renderDeadlineRow(d, classes.find(c => c.id === d.classId))).join('') : '<div class="empty-state" style="padding:24px">Sin deadlines configurados.</div>'}
      </div>
    </div>
  `;

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
      const newTitle = prompt('Título del deadline', deadline.title);
      if (!newTitle) return;
      await api.saveDeadline({ ...deadline, title: newTitle });
      toast('success', 'Deadline actualizado', 'Los cambios se guardaron correctamente.');
      renderTeacherDashboard(container);
    });
  });

  if (deadlines.length > 0) {
    console.debug('[Teacher Dashboard] Deadlines cargados:', deadlines.length);
  }
}
