/* ============================================================
   Student Dashboard — Main landing page
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

function renderSearchResult(result, classesById) {
  const materialIcon = { transcript: '📝', bibliography: '📚' }[result.materialType] || '📄';
  const classNames = (result.classIds || [])
    .map(classId => classesById.get(classId)?.title || classId)
    .map(label => label.split('—')[0]?.trim() || label)
    .slice(0, 2)
    .join(' · ');

  const targetClassId = (result.classIds || [])[0];
  const targetHref = targetClassId ? `#/student/class/${targetClassId}` : '#/student/chat';

  return `
    <a href="${targetHref}" class="global-search-result-item" data-search-result="true">
      <div class="global-search-result-header">
        <span class="global-search-material-pill">${materialIcon} ${result.materialType === 'bibliography' ? 'Bibliografía' : 'Transcripción'}</span>
        <span class="global-search-score">Relevancia ${(result.score * 100).toFixed(0)}%</span>
      </div>
      <div class="global-search-filename">${result.sourceFilename || 'Fuente sin nombre'}</div>
      <p class="global-search-snippet">${result.snippet || 'Sin vista previa disponible.'}</p>
      <div class="global-search-result-footer">
        <span>${classNames || 'Materia completa'}</span>
        <span class="global-search-open">Abrir →</span>
      </div>
    </a>
  `;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const [classes, tasks, chatHistory, deadlines] = await Promise.all([
    api.getClasses(activeSubjectId),
    api.getTasks(user.id),
    api.getChatHistory(activeSubjectId),
    api.getDeadlines(activeSubjectId),
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
  const classesById = new Map(classes.map(c => [c.id, c]));

  const todayIso = new Date().toISOString().slice(0, 10);
  const reminderItems = await api.getDeadlineReminders(activeSubjectId, todayIso);
  if (Array.isArray(reminderItems) && reminderItems.length > 0) {
    toast('warning', 'Deadline próximo', `Tenés ${reminderItems.length} deadline${reminderItems.length !== 1 ? 's' : ''} para hoy o mañana.`);
  }

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

    <div class="card global-search-card" id="global-search-card">
      <div class="card-header">
        <span class="card-title">🔎 Búsqueda Global de Conocimiento</span>
        <span class="badge badge-info">${activeSubjectName}</span>
      </div>
      <div class="global-search-controls">
        <input
          type="search"
          id="global-search-input"
          class="form-input"
          placeholder="Buscá conceptos en transcripciones y bibliografías (ej: Architecture)"
          autocomplete="off"
        />
        <button class="btn btn-primary" id="global-search-button">Buscar</button>
      </div>
      <div class="global-search-hint">La búsqueda usa el índice completo de la materia activa y prioriza coincidencias semánticas + keyword.</div>
      <div class="global-search-results" id="global-search-results">
        <div class="empty-state" style="padding:20px 0">
          <span class="empty-state-icon">📚</span>
          <p>Ingresá un término para explorar conocimiento en todas las clases.</p>
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

    <div class="card global-search-card" style="margin-top:0;margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">📌 Deadlines activos</span>
        <a href="#/student/calendar" class="btn btn-ghost btn-sm">Ver calendario</a>
      </div>
      <div class="class-list">
        ${deadlines.length > 0 ? deadlines.slice(0, 3).map(deadline => {
          const relatedClass = classesById.get(deadline.classId);
          return `
            <div class="class-list-item">
              <div class="class-list-date">⏰</div>
              <div class="class-list-info">
                <div class="class-list-title">${deadline.title}</div>
                <div class="class-list-topics">${deadline.description || 'Sin descripción'}</div>
                <div class="class-list-files">${relatedClass?.title || deadline.classId} · Vence ${new Date(deadline.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</div>
              </div>
              <div class="class-list-actions">
                <span class="badge ${deadline.notifyOnDayBefore ? 'badge-warning' : 'badge-neutral'}">${deadline.notifyOnDayBefore ? 'Recordatorio +1 día' : 'Recordatorio día de'}</span>
              </div>
            </div>
          `;
        }).join('') : '<div class="empty-state" style="padding:18px 0"><p>No hay deadlines configurados.</p></div>'}
      </div>
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

  const searchInput = container.querySelector('#global-search-input');
  const searchButton = container.querySelector('#global-search-button');
  const resultsContainer = container.querySelector('#global-search-results');

  const setSearchingState = (isSearching) => {
    if (!searchButton || !searchInput) return;
    searchButton.disabled = isSearching;
    searchInput.disabled = isSearching;
    searchButton.innerHTML = isSearching ? '<span class="spinner"></span>' : 'Buscar';
  };

  const runGlobalSearch = async () => {
    const query = searchInput?.value?.trim();
    if (!query || !resultsContainer) return;

    setSearchingState(true);
    resultsContainer.innerHTML = `<div class="page-loading animate-pulse" style="padding:24px;text-align:center;color:var(--color-text-secondary)">Buscando en todo el índice de la materia...</div>`;

    try {
      const searchResponse = await api.globalSearch({ query, subjectId: activeSubjectId });
      const results = Array.isArray(searchResponse.results) ? searchResponse.results : [];

      if (!results.length) {
        resultsContainer.innerHTML = `
          <div class="empty-state" style="padding:24px 0">
            <span class="empty-state-icon">🕵️</span>
            <p>No encontramos coincidencias para "${escapeHtml(query)}" en esta materia.</p>
          </div>
        `;
        return;
      }

      resultsContainer.innerHTML = `
        <div class="global-search-results-header">
          <strong>${results.length}</strong> resultados para <strong>"${escapeHtml(query)}"</strong>
        </div>
        <div class="global-search-results-grid">
          ${results.map(result => renderSearchResult(result, classesById)).join('')}
        </div>
      `;
    } catch (err) {
      resultsContainer.innerHTML = `<div class="card" style="padding:20px;text-align:center;color:var(--color-error)">${err.message || 'No se pudo realizar la búsqueda global.'}</div>`;
    } finally {
      setSearchingState(false);
    }
  };

  searchButton?.addEventListener('click', runGlobalSearch);
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runGlobalSearch();
    }
  });
}
