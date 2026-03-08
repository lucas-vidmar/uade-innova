/* ============================================================
   Teacher Dashboard — Cátedra overview
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

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
  const classes = await api.getClasses(activeSubjectId);

  const complete = classes.filter(c => c.summaryReady);
  const processing = classes.filter(c => !c.summaryReady && c.materials.length > 0);
  const empty = classes.filter(c => c.materials.length === 0);

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
  `;
}
