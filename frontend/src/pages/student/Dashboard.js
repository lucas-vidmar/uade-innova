/* ============================================================
   Student Dashboard — Main landing page
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

export async function renderStudentDashboard(container) {
  renderHeader('Inicio');
  container.innerHTML = `<div class="page-loading animate-pulse" style="padding:40px;text-align:center;color:var(--color-text-secondary)">Cargando dashboard...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  // Fetch mock classes and tasks
  const [classes, tasks] = await Promise.all([
    api.getClasses(activeSubjectId),
    api.getTasks(user.id),
  ]);

  // Lógica para mockear las tareas a mano ya que nuestro backend todavía devuelve todas las materias del alumno
  const subjectTasks = tasks.filter(t => t.subjectId === activeSubjectId);
  const pendingTasks = subjectTasks.filter(t => t.status === 'pending').slice(0, 3);
  const completedTasks = subjectTasks.filter(t => t.status === 'completed');
  const avgGrade = completedTasks.reduce((a, t) => a + (t.grade || 0), 0) / (completedTasks.length || 1);

  const activeSubjectName = user.subjects?.find(s => s.id === activeSubjectId)?.name || 'Materia Desconocida';

  container.innerHTML = `
    <!-- Hero -->
    <div class="student-hero">
      <div>
        <h1 class="student-hero-title">¡Hola, <span class="gradient-text">${user.name.split(' ')[0]}</span>! 👋</h1>
        <p class="student-hero-sub">${activeSubjectName}</p>
      </div>
      <div class="student-hero-stats">
        <div class="hero-stat">
          <div class="hero-stat-value">${classes.filter(c => c.summaryReady).length}</div>
          <div class="hero-stat-label">Clases disponibles</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-value">${pendingTasks.length}</div>
          <div class="hero-stat-label">Tareas pendientes</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-value">${avgGrade.toFixed(1)}</div>
          <div class="hero-stat-label">Promedio actual</div>
        </div>
      </div>
    </div>

    <!-- Quick actions -->
    <div class="quick-actions">
      <a href="#/student/chat" class="quick-action-card">
        <span class="quick-action-icon">💬</span>
        <span class="quick-action-label">Consultar con IA</span>
        <span class="quick-action-arrow">→</span>
      </a>
      <a href="#/student/tasks" class="quick-action-card">
        <span class="quick-action-icon">📋</span>
        <span class="quick-action-label">Ver mis tareas</span>
        <span class="quick-action-arrow">→</span>
      </a>
      <a href="#/student/calendar" class="quick-action-card">
        <span class="quick-action-icon">📅</span>
        <span class="quick-action-label">Calendario</span>
        <span class="quick-action-arrow">→</span>
      </a>
    </div>

    <!-- Main grid -->
    <div class="dashboard-grid">
      <!-- Upcoming tasks -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">📋 Tareas Próximas</span>
          <a href="#/student/tasks" class="btn btn-ghost btn-sm">Ver todas</a>
        </div>
        ${pendingTasks.length === 0 ? `<div class="empty-state" style="padding:32px"><span class="empty-state-icon">🎉</span><p>¡No tenés tareas pendientes!</p></div>` :
      pendingTasks.map(t => {
        const daysUntil = Math.ceil((new Date(t.dueDate) - new Date()) / 86400000);
        const urgency = daysUntil <= 3 ? 'error' : daysUntil <= 7 ? 'warning' : 'success';
        return `
              <div class="task-item">
                <div class="task-item-info">
                  <div class="task-item-title">${t.title}</div>
                  <div class="task-item-meta">Vence el ${new Date(t.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · Peso: ${t.weight}%</div>
                </div>
                <span class="badge badge-${urgency}">${daysUntil <= 0 ? '¡Hoy!' : `${daysUntil}d`}</span>
              </div>
            `;
      }).join('')
    }
      </div>

      <!-- Subject progress -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">📚 Progreso de la Materia</span>
        </div>
        <div class="subject-progress">
          ${classes.slice(0, 5).map(c => `
            <div class="class-progress-row">
              <div class="class-progress-info">
                <div class="class-progress-title">${c.title.split('—')[1]?.trim() || c.title}</div>
                <div class="class-progress-date">${c.date ? new Date(c.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : 'Sin fecha'}</div>
              </div>
                ${c.summaryReady 
                  ? `<a href="#/student/class/${c.id}" class="badge badge-success" style="text-decoration:none">✅ Listo</a>` 
                  : (c.materials && c.materials.length > 0) 
                    ? '<span class="badge badge-warning">⚙️ Procesando</span>' 
                    : '<span class="badge badge-neutral">⏳ Sin material</span>'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}
