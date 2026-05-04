/* ============================================================
   Student Dashboard — Main landing page
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { renderBottomNav } from '../../components/BottomNav.js';
import { createChatWidget } from '../../components/ChatWidget.js';
import { toast } from '../../components/Toast.js';

function renderSearchResult(result, classesById) {
  const materialIcon = {
    transcript: icon('document'),
    bibliography: icon('book'),
    presentation: icon('presentation'),
    notes: icon('notes'),
  }[result.materialType] || icon('document');
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

function icon(name) {
  const icons = {
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
    chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
    tasks: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11h11"/><path d="M9 16h11"/><path d="M9 6h11"/><path d="M4 6h.01"/><path d="M4 11h.01"/><path d="M4 16h.01"/></svg>',
    calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    deadline: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
    activity: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
    document: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    presentation: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    notes: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h16v18H4z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  };

  return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.document}</span>`;
}

function parseHashQuery() {
  const hash = window.location.hash || '';
  const query = hash.split('?')[1] || '';
  return new URLSearchParams(query);
}

export async function renderStudentDashboard(container) {
  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  // 1. Initial Shell Render (Instant)
  const activeSubjectName = user.subjects?.find(s => s.id === activeSubjectId)?.name || 'Materia';
  
  container.innerHTML = `
    <div class="dashboard-wrapper animate-in bg-bg min-h-screen">
      <div class="container py-8">
        
        <!-- Welcome & Search Section -->
        <div class="dashboard-layout-grid mb-2 items-center" style="padding-bottom: 0;">
          <div class="search-container w-full" style="max-width: 100%;">
            <div class="search-icon-wrapper">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"></path></svg>
            </div>
            <input 
              class="search-input" 
              placeholder="Buscar en ${activeSubjectName}..." 
              type="text"
              id="global-search-header"
            />
          </div>

          <div class="metrics-container grid grid-cols-3 gap-2 w-full" id="dashboard-metrics-container">
            <div class="bg-transparent p-2 flex flex-col items-center justify-center animate-pulse">
              <span class="h-8 w-8 bg-surface-2 rounded mb-2"></span>
              <span class="h-3 w-16 bg-surface-2 rounded"></span>
            </div>
            <div class="bg-transparent p-2 flex flex-col items-center justify-center animate-pulse">
              <span class="h-8 w-8 bg-surface-2 rounded mb-2"></span>
              <span class="h-3 w-16 bg-surface-2 rounded"></span>
            </div>
            <div class="bg-transparent p-2 flex flex-col items-center justify-center animate-pulse">
              <span class="h-8 w-8 bg-surface-2 rounded mb-2"></span>
              <span class="h-3 w-16 bg-surface-2 rounded"></span>
            </div>
          </div>
        </div>

        <div class="dashboard-layout-grid">
          <!-- Left Column: Chat Container -->
          <section class="h-full" id="chat-widget-mount">
            <div class="flex items-center justify-center h-[500px] border border-border bg-surface-2 rounded-2xl text-text-muted italic animate-pulse">
              Iniciando asistente IA...
            </div>
          </section>

          <!-- Right Column: Sidebar -->
          <aside class="flex flex-col gap-6">
            <!-- Tareas Proximas -->
            <div class="sidebar-section" id="section-tasks">
              <div class="sidebar-section-header">
                <div class="sidebar-section-title">
                  <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
                  <span>Tareas próximas</span>
                </div>
                <a href="#/student/tasks" class="sidebar-section-link">Ver todas</a>
              </div>
              <div class="p-4 text-center text-xs text-text-muted italic animate-pulse">Cargando tareas...</div>
            </div>

            <!-- Clases de la materia -->
            <div class="sidebar-section" id="section-classes">
              <div class="sidebar-section-header">
                <div class="sidebar-section-title">
                  <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
                  <span>Clases de la materia</span>
                </div>
              </div>
              <div class="p-4 text-center text-xs text-text-muted italic animate-pulse">Cargando clases...</div>
            </div>

            <!-- Chats recientes -->
            <div class="sidebar-section" id="section-history">
              <div class="sidebar-section-header">
                <div class="sidebar-section-title">
                  <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
                  <span>Chats recientes</span>
                </div>
              </div>
              <div class="p-4 text-center text-xs text-text-muted italic animate-pulse">Cargando historial...</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `;

  renderHeader(document.getElementById('app-header'), 'Inicio', false);

  const buildSessionSummaries = (history = []) => {
    const sessions = new Map();

    history.forEach((item, index) => {
      const sessionKey = item.sessionId || item.id || `legacy-${index}`;
      if (!sessionKey) return;
      const timestamp = new Date(item.timestamp || item.createdAt || 0).getTime();
      const question = String(item.question || '').trim();

      if (!sessions.has(sessionKey)) {
        sessions.set(sessionKey, {
          sessionId: sessionKey,
          title: question || 'Chat sin título',
          lastAt: timestamp || 0,
          count: 1,
        });
        return;
      }

      const current = sessions.get(sessionKey);
      const nextLastAt = Math.max(current.lastAt, timestamp || 0);
      sessions.set(sessionKey, {
        ...current,
        title: question || current.title,
        lastAt: nextLastAt,
        count: current.count + 1,
      });
    });

    return Array.from(sessions.values()).sort((a, b) => b.lastAt - a.lastAt);
  };

  const HISTORY_PAGE_SIZE = 5;
  let historyPage = 0;
  let sessionSummariesCache = [];

  const renderHistoryList = () => {
    const visibleCount = Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, sessionSummariesCache.length);
    const visibleItems = sessionSummariesCache.slice(0, visibleCount);
    if (visibleItems.length === 0) {
      return '<li class="p-6 flex flex-row items-center justify-center gap-2 text-center text-text-muted bg-surface-2 rounded-xl mt-2 border border-dashed border-border"><span class="opacity-50">' + icon('chat') + '</span><span class="text-xs italic">Sin actividad reciente</span></li>';
    }
    return visibleItems.map(c => `
      <li class="sidebar-list-item cursor-pointer hover:bg-surface-2 transition-colors" data-chat-session-id="${escapeHtml(c.sessionId)}">
        <div class="chat-history-row">
          <span class="chat-history-title">${escapeHtml(c.title)}</span>
          <span class="chat-history-date">${new Date(c.lastAt || Date.now()).toLocaleDateString()}</span>
        </div>
      </li>
    `).join('');
  };

  const updateHistorySidebar = (history) => {
    const sectionHistory = document.getElementById('section-history');
    if (!sectionHistory) return;
    sessionSummariesCache = buildSessionSummaries(history);
    historyPage = 0;
    sectionHistory.innerHTML = `
      <div class="sidebar-section-header">
        <div class="sidebar-section-title">
          <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
          <span>Chats recientes</span>
        </div>
      </div>
      <div class="chat-history-scroll" id="chat-history-scroll">
        <ul class="sidebar-list">
          ${renderHistoryList()}
        </ul>
      </div>
    `;

    const bindHistoryClicks = () => {
      sectionHistory.querySelectorAll('[data-chat-session-id]').forEach(item => {
        item.addEventListener('click', () => {
          const sessionId = item.dataset.chatSessionId;
          if (!sessionId) return;
          window.location.hash = `#/student/dashboard?sessionId=${encodeURIComponent(sessionId)}`;
        });
      });
    };

    const historyScroll = sectionHistory.querySelector('#chat-history-scroll');
    if (historyScroll) {
      historyScroll.onscroll = () => {
        const nearBottom = historyScroll.scrollTop + historyScroll.clientHeight >= historyScroll.scrollHeight - 20;
        if (!nearBottom) return;
        if ((historyPage + 1) * HISTORY_PAGE_SIZE >= sessionSummariesCache.length) return;
        historyPage += 1;
        const list = historyScroll.querySelector('.sidebar-list');
        if (list) {
          list.innerHTML = renderHistoryList();
          bindHistoryClicks();
        }
      };
    }

    bindHistoryClicks();
  };

  const loadChatSession = async (sessionId) => {
    if (!sessionId) return;
    const [classes, history] = await Promise.all([
      api.getClasses(activeSubjectId),
      api.getChatHistory(activeSubjectId),
    ]);

    const sessionMessages = (history || [])
      .filter(item => (item.sessionId || item.id) === sessionId)
      .sort((a, b) => new Date(a.timestamp || a.createdAt || 0) - new Date(b.timestamp || b.createdAt || 0));

    const chatMount = document.getElementById('chat-widget-mount');
    if (!chatMount) return;

    chatMount.innerHTML = '';
    const chatWidget = createChatWidget({
      classes: classes || [],
      subjectId: activeSubjectId,
      sessionId,
      initialMessages: sessionMessages.map(c => ([
        { role: 'user', content: c.question },
        { role: 'assistant', content: c.answer || '', sources: c.sources || [], id: c.id }
      ])).flat(),
      onNewChat: handleNewChat,
      onMessageSent: handleMessageSent,
    });
    chatMount.appendChild(chatWidget);
    updateHistorySidebar(history);
  };

  const handleNewChat = async () => {
    const history = await api.getChatHistory(activeSubjectId);
    updateHistorySidebar(history);
  };

  const handleMessageSent = async () => {
    const history = await api.getChatHistory(activeSubjectId);
    updateHistorySidebar(history);
  };

  // 2. Start fetches in parallel
  const fetchClassesTask = api.getClasses(activeSubjectId);
  const fetchTasksTask = api.getTasks(user.id);
  const fetchHistoryTask = api.getChatHistory(activeSubjectId);

  // 3. Update Tasks & Metrics (Depends on tasks)
  fetchTasksTask.then(tasks => {
    const sectionTasks = document.getElementById('section-tasks');
    if (!sectionTasks) return;

    const subjectTasks = (tasks || []).filter(t => t.subjectId === activeSubjectId);
    const pendingTasks = subjectTasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => (new Date(a.dueDate) - new Date(b.dueDate)))
      .slice(0, 3);
    
    const completedTasks = subjectTasks.filter(t => t.status === 'completed');
    const avgGrade = completedTasks.length > 0 
      ? completedTasks.reduce((a, t) => a + (Number(t.grade) || 0), 0) / completedTasks.length
      : 0;
    const riskValue = avgGrade < 4 && completedTasks.length > 0 ? 1 : 0;

    // Update Tasks List
    sectionTasks.innerHTML = `
      <div class="sidebar-section-header">
        <div class="sidebar-section-title">
          <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
          <span>Tareas próximas</span>
        </div>
        <a href="#/student/tasks" class="sidebar-section-link">Ver todas</a>
      </div>
      <div class="p-0">
        <ul class="sidebar-list">
          ${pendingTasks.length > 0 ? pendingTasks.map(t => `
            <li class="sidebar-list-item">
              <p class="sidebar-item-title">${escapeHtml(t.title)}</p>
              <div class="sidebar-item-meta">
                 <span>${new Date(t.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</span>
                <span class="font-bold text-error">Próximo</span>
              </div>
            </li>
          `).join('') : '<li class="p-6 flex flex-row items-center justify-center gap-2 text-center text-text-muted bg-surface-2 rounded-xl mt-2 border border-dashed border-border"><span class="opacity-50">' + icon('tasks') + '</span><span class="text-xs italic">Sin tareas pendientes</span></li>'}
        </ul>
      </div>
    `;

    // Update Metrics
    const metricsContainer = document.getElementById('dashboard-metrics-container');
    if (metricsContainer) {
      metricsContainer.innerHTML = `
        <div class="bg-transparent p-2 flex flex-col items-center justify-center transition-all">
          <span class="text-3xl font-extrabold text-primary">${avgGrade > 0 ? avgGrade.toFixed(1) : '-'}</span>
          <span class="text-[10px] uppercase font-bold text-text-muted mt-1 tracking-wider text-center">Promedio</span>
        </div>
        <div class="bg-transparent p-2 flex flex-col items-center justify-center transition-all">
          <span class="text-3xl font-extrabold ${riskValue > 0 ? 'text-error' : 'text-text-muted'}">${riskValue}</span>
          <span class="text-[10px] uppercase font-bold text-text-muted mt-1 tracking-wider text-center">Riesgo Académico</span>
        </div>
        <div class="bg-transparent p-2 flex flex-col items-center justify-center transition-all">
          <span class="text-3xl font-extrabold text-success">92%</span>
          <span class="text-[10px] uppercase font-bold text-text-muted mt-1 tracking-wider text-center">Asistencia</span>
        </div>
      `;
    }
  });

  // 4. Update Classes
  fetchClassesTask.then(classes => {
    const sectionClasses = document.getElementById('section-classes');
    if (!sectionClasses) return;

    sectionClasses.innerHTML = `
      <div class="sidebar-section-header">
        <div class="sidebar-section-title">
          <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
          <span>Clases de la materia</span>
        </div>
      </div>
      <div class="p-0">
        <ul class="sidebar-list">
          ${(classes || []).slice(0, 3).map(c => `
            <li class="sidebar-list-item cursor-pointer hover:bg-surface-2 transition-colors" onclick="location.hash='#/student/class/${c.id}'">
              <div class="flex justify-between items-start">
                <p class="sidebar-item-title">${escapeHtml(c.title).split('—')[1] || c.title}</p>
                ${c.summaryReady ? '<span class="status-badge success">Visto</span>' : ''}
              </div>
              <p class="text-[10px] text-text-muted mt-1 leading-tight">${c.topics ? c.topics.join(', ') : 'Sin temas'}</p>
            </li>
          `).join('')}
          ${classes?.length === 0 ? '<li class="p-6 flex flex-row items-center justify-center gap-2 text-center text-text-muted bg-surface-2 rounded-xl mt-2 border border-dashed border-border"><span class="opacity-50">' + icon('calendar') + '</span><span class="text-xs italic">No hay clases programadas</span></li>' : ''}
        </ul>
      </div>
    `;
  });

  // 5. Update Chat Widget
  Promise.all([fetchClassesTask, fetchHistoryTask]).then(([classes, history]) => {
    const chatMount = document.getElementById('chat-widget-mount');
    if (!chatMount) return;

    chatMount.innerHTML = ''; // Clear placeholder
    const hashQuery = parseHashQuery();
    const selectedSessionId = hashQuery.get('sessionId');

    const sessionSummaries = buildSessionSummaries(history || []);
    const latestSessionId = sessionSummaries[0]?.sessionId || null;

    const seedSessionId = selectedSessionId || latestSessionId;
    const seedMessages = seedSessionId
      ? (history || []).filter(item => (item.sessionId || item.id) === seedSessionId)
      : (history || []).slice(-5);

    const chatWidget = createChatWidget({
      classes: classes || [],
      subjectId: activeSubjectId,
      sessionId: seedSessionId || null,
      initialMessages: seedMessages.map(c => ([
        { role: 'user', content: c.question },
        { role: 'assistant', content: c.answer || '', sources: c.sources || [], id: c.id }
      ])).flat(),
      onNewChat: handleNewChat,
      onMessageSent: handleMessageSent,
    });
    chatMount.appendChild(chatWidget);
    updateHistorySidebar(history);
    if (selectedSessionId) {
      window.history.replaceState(null, '', '#/student/dashboard');
    }
  });

  renderBottomNav();
}
