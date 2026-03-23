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

  // Fetch mock data (classes, tasks, chat history)
  const [classes, tasks, chatHistory] = await Promise.all([
    api.getClasses(activeSubjectId),
    api.getTasks(user.id),
    api.getChatHistory(activeSubjectId),
  ]);

  // Priority logic for student tasks
  const calculatePriority = (t) => {
    const daysUntil = Math.max(0, Math.ceil((new Date(t.dueDate) - new Date()) / 86400000));
    const proximity = 10 / (daysUntil + 1);
    const weightFactor = t.weight / 5;
    return proximity + weightFactor;
  };

  const subjectTasks = tasks.filter(t => t.subjectId === activeSubjectId);
  const pendingTasks = subjectTasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => calculatePriority(b) - calculatePriority(a))
    .slice(0, 3);
  
  const completedTasks = subjectTasks.filter(t => t.status === 'completed');
  const avgGrade = completedTasks.length > 0 
    ? completedTasks.reduce((a, t) => a + (t.grade || 0), 0) / completedTasks.length
    : 0;

  const activeSubjectName = user.subjects?.find(s => s.id === activeSubjectId)?.name || 'Materia Desconocida';

  // Academic standing logic (more detailed for US#48)
  const standingUrgency = avgGrade >= 7 ? 'success' : avgGrade >= 4 ? 'warning' : 'error';
  const standingLabel = avgGrade >= 7 ? 'Buen desempeño' : avgGrade >= 4 ? 'En progreso' : 'Riesgo académico';

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
          <div class="hero-stat-value">
            <span class="badge badge-${standingUrgency}">${avgGrade.toFixed(1)}</span>
          </div>
          <div class="hero-stat-label">${standingLabel}</div>
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
        <div class="card-body">
          ${pendingTasks.length === 0 ? `<div class="empty-state" style="padding:24px"><span class="empty-state-icon">🎉</span><p>¡No tenés tareas pendientes!</p></div>` :
            pendingTasks.map(t => {
              const daysUntil = Math.ceil((new Date(t.dueDate) - new Date()) / 86400000);
              const urgency = daysUntil <= 3 ? 'error' : daysUntil <= 7 ? 'warning' : 'success';
              return `
                <div class="task-item">
                  <div class="task-item-info">
                    <div class="task-item-title">${t.title}</div>
                    <div class="task-item-meta">Vence el ${new Date(t.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</div>
                  </div>
                  <span class="badge badge-${urgency}">${daysUntil <= 0 ? '¡Hoy!' : `${daysUntil}d`}</span>
                </div>
              `;
            }).join('')
          }
        </div>
      </div>

      <!-- Recent Chats (New section for US#48) -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">💬 Consultas Recientes</span>
          <a href="#/student/chat" class="btn btn-ghost btn-sm">Ir al chat</a>
        </div>
        <div class="card-body">
          ${chatHistory.length === 0 ? `<div class="empty-state" style="padding:24px"><span class="empty-state-icon">🗨️</span><p>No hay consultas previas.</p></div>` :
            chatHistory.slice(0, 3).map(chat => `
              <a href="#/student/chat?id=${chat.id}" class="chat-history-item" style="text-decoration:none">
                <div class="chat-history-info">
                  <div class="chat-history-q">${chat.question.length > 60 ? chat.question.substring(0, 60) + '...' : chat.question}</div>
                  <div class="chat-history-date">${new Date(chat.timestamp).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <span class="chat-history-arrow">→</span>
              </a>
            `).join('')
          }
        </div>
      </div>

      <!-- Subject progress -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">📚 Progreso de la Materia</span>
        </div>
        <div class="card-body">
          <div class="subject-progress">
            ${classes.slice(0, 4).map(c => `
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
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}
