/* ============================================================
   Student Dashboard — Main landing page
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { renderBottomNav } from '../../components/BottomNav.js';
import { createChatWidget } from '../../components/ChatWidget.js';
import { toast } from '../../components/Toast.js';
import { OnboardingEngine, isOnboardingCompleted } from '../../services/onboarding.js';
import { STUDENT_ONBOARDING_STEPS } from './OnboardingSteps.js';

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

function icon(name, size = 14) {
  const s = size;
  const icons = {
    search: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    chat: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>`,
    tasks: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11h11"/><path d="M9 16h11"/><path d="M9 6h11"/><path d="M4 6h.01"/><path d="M4 11h.01"/><path d="M4 16h.01"/></svg>`,
    calendar: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
    deadline: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>`,
    activity: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>`,
    document: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
    book: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`,
    presentation: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
    notes: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h16v18H4z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>`,
  };

  return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.document}</span>`;
}

function parseHashQuery() {
  const hash = window.location.hash || '';
  const query = hash.split('?')[1] || '';
  return new URLSearchParams(query);
}

(function injectChatStyles() {
  if (document.getElementById('chat-hover-style')) return;
  const s = document.createElement('style');
  s.id = 'chat-hover-style';
  s.textContent = `
.sidebar-list-item:hover .chat-history-delete-btn {
  width: auto !important;
  overflow: visible !important;
  opacity: 1 !important;
  padding: 4px !important;
  margin: 0 0 0 2px !important;
}
.sidebar-list-item:hover .title-scroll-active {
  animation: titleReveal 6s ease-in-out infinite alternate;
}
@keyframes titleReveal {
  0% { transform: translateX(0); }
  100% { transform: translateX(calc(-100% + 160px)); }
}
`;
  document.head.appendChild(s);
})();

function applyTitleScroll() {
  document.querySelectorAll('.chat-history-title').forEach(el => {
    const inner = el.querySelector('.title-scroll');
    if (inner && inner.scrollWidth > el.clientWidth) {
      inner.classList.add('title-scroll-active');
    }
  });
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
        
        <!-- Inactivity Warning -->
        ${renderInactivityBanner()}

        <!-- Welcome & Search Section -->
        <div class="dashboard-layout-grid mb-8 items-center" style="padding-bottom: 0;">
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
          <section class="h-full flex flex-col" id="chat-widget-mount">
            <div class="flex items-center justify-center flex-1 border border-border bg-surface-2 rounded-2xl text-text-muted italic animate-pulse">
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
      return '<li class="flex flex-col items-center py-8 px-6 text-center"><div style="width:120px;height:120px;" class="bg-surface-2 rounded-full flex items-center justify-center mb-3 text-text-muted">' + icon('chat', 20) + '</div><p class="text-xs font-medium text-text-primary mb-1">Sin actividad reciente</p><p class="text-[10px] text-text-muted">Tus consultas en el chat aparecerán acá</p></li>';
    }
    return visibleItems.map(c => {
      const dateStr = new Date(c.lastAt || Date.now()).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
      return `
      <li class="sidebar-list-item cursor-pointer hover:bg-surface-2 transition-colors group" data-chat-session-id="${escapeHtml(c.sessionId)}">
        <div class="chat-history-row">
          <span class="chat-history-title" style="overflow:hidden;"><span class="title-scroll" style="display:inline-block;white-space:nowrap;">${escapeHtml(c.title)}</span></span>
          <div class="chat-history-actions">
            <span style="font-size:10px;font-weight:600;border-radius:999px;padding:2px 6px;flex-shrink:0;transition:margin 0.15s;color:#3b82f6;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);">${dateStr}</span>
            <button class="chat-history-delete-btn" style="width:0;overflow:hidden;opacity:0;padding:0;margin:0;border:none;transition:width 0.15s,opacity 0.15s,padding 0.15s,margin 0.15s;" data-delete-session-id="${escapeHtml(c.sessionId)}" title="Eliminar conversación">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      </li>`;
    }).join('');
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
        item.addEventListener('click', (e) => {
          if (e.target.closest('.chat-history-delete-btn')) return;
          const sessionId = item.dataset.chatSessionId;
          if (!sessionId) return;
          window.location.hash = `#/student/dashboard?sessionId=${encodeURIComponent(sessionId)}`;
        });
      });
      sectionHistory.querySelectorAll('[data-delete-session-id]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const sessionId = btn.dataset.deleteSessionId;
          if (!sessionId) return;
          try {
            await api.deleteConversation(sessionId, activeSubjectId);
            sessionSummariesCache = sessionSummariesCache.filter(s => s.sessionId !== sessionId);
            const scroll = sectionHistory.querySelector('#chat-history-scroll');
            if (scroll) {
              const list = scroll.querySelector('.sidebar-list');
              if (list) {
                list.innerHTML = renderHistoryList();
                bindHistoryClicks();
                requestAnimationFrame(applyTitleScroll);
              }
            }
          } catch (err) {
            console.error('Error deleting conversation:', err);
          }
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
          requestAnimationFrame(applyTitleScroll);
        }
      };
    }

    bindHistoryClicks();
    requestAnimationFrame(applyTitleScroll);
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
  const fetchDeadlinesTask = api.getDeadlines(activeSubjectId);
  const fetchHistoryTask = api.getChatHistory(activeSubjectId);

  // 3. Update Tasks, Deadlines & Metrics
  Promise.all([fetchTasksTask, fetchDeadlinesTask]).then(([tasks, deadlines]) => {
    const sectionTasks = document.getElementById('section-tasks');
    if (!sectionTasks) return;

    const subjectTasks = (tasks || []).filter(t => t.subjectId === activeSubjectId);
    const pendingDeadlines = (deadlines || [])
      .filter(d => d.subjectId === activeSubjectId && d.status !== 'completed')
      .map(d => ({
        id: d.id,
        title: d.title,
        dueDate: d.dueDate,
        type: 'deadline',
        weight: d.weight || 0,
        status: 'pending',
        classId: d.classId,
        description: d.description || '',
      }));
    const merged = [...subjectTasks, ...pendingDeadlines];
    const pendingItems = merged
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
          ${pendingItems.length > 0 ? pendingItems.map(t => {
            const dateStr = new Date(t.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });
            const daysUntil = Math.ceil((new Date(t.dueDate) - new Date()) / 86400000);
            const pillLabel = daysUntil <= 3 ? 'Próximo' : daysUntil <= 7 ? 'Esta semana' : 'Pendiente';
            return `
            <li class="sidebar-list-item">
              <div style="display:flex;align-items:center;gap:8px;width:100%;overflow:hidden;">
                <span style="color:var(--color-text-muted);flex-shrink:0;white-space:nowrap;font-size:10px;font-weight:600;">${dateStr}</span>
                <span class="chat-history-title" style="flex:1;overflow:hidden;"><span class="title-scroll" style="display:inline-block;white-space:nowrap;">${escapeHtml(t.title)}</span></span>
                <span style="font-size:10px;font-weight:600;border-radius:999px;padding:2px 6px;flex-shrink:0;color:#3b82f6;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);margin-left:auto;">${pillLabel}</span>
              </div>
            </li>`;
          }).join('') : '<li class="flex flex-col items-center py-8 px-6 text-center"><div style="width:120px;height:120px;" class="bg-surface-2 rounded-full flex items-center justify-center mb-3 text-text-muted">' + icon('tasks', 20) + '</div><p class="text-xs font-medium text-text-primary mb-1">Todo al día</p><p class="text-[10px] text-text-muted">No tenés tareas pendientes</p></li>'}
        </ul>
      </div>
    `;
    requestAnimationFrame(applyTitleScroll);

    // Update Metrics
    const metricsContainer = document.getElementById('dashboard-metrics-container');
    if (metricsContainer) {
      metricsContainer.innerHTML = `
        <div class="bg-transparent p-2 flex flex-col items-center justify-center transition-all min-w-[100px]">
          <span class="block text-3xl font-extrabold text-primary">${avgGrade > 0 ? avgGrade.toFixed(1) : '-'}</span>
          <span class="text-[10px] uppercase font-bold text-text-muted mt-1.5 tracking-widest text-center">Promedio</span>
        </div>
        <div class="bg-transparent p-2 flex flex-col items-center justify-center transition-all min-w-[100px]">
          <div class="flex items-center justify-center gap-1.5 mb-1.5 px-3 py-1 rounded-full" style="background: ${riskValue > 0 ? 'rgba(239,68,68,0.1)' : 'var(--color-surface-2)'}">
            <span class="w-1.5 h-1.5 rounded-full ${riskValue > 0 ? 'bg-red-500' : 'bg-text-muted'}"></span>
            <span class="text-xs font-bold ${riskValue > 0 ? 'text-error' : 'text-text-muted'}">${riskValue}</span>
          </div>
          <span class="text-[10px] uppercase font-bold text-text-muted tracking-widest text-center">Riesgo Académico</span>
        </div>
        <div class="bg-transparent p-2 flex flex-col items-center justify-center transition-all min-w-[100px]">
          <span class="block text-3xl font-extrabold text-success">92%</span>
          <span class="text-[10px] uppercase font-bold text-text-muted mt-1.5 tracking-widest text-center">Asistencia</span>
        </div>
      `;
    }
  });

  // 4. Lazy-loaded scrollable Classes
  const CLASSES_PAGE_SIZE = 8;
  let classesPage = 0;
  let classesCache = [];

  const renderClassesList = () => {
    const visibleCount = Math.min((classesPage + 1) * CLASSES_PAGE_SIZE, classesCache.length);
    const visibleItems = classesCache.slice(0, visibleCount);
    if (visibleItems.length === 0) {
      return '<li class="flex flex-col items-center py-8 px-6 text-center"><div style="width:120px;height:120px;" class="bg-surface-2 rounded-full flex items-center justify-center mb-3 text-text-muted">' + icon('calendar', 20) + '</div><p class="text-xs font-medium text-text-primary mb-1">No hay clases programadas</p><p class="text-[10px] text-text-muted">Las clases aparecerán acá cuando el docente las publique</p></li>';
    }
    return visibleItems.map(c => {
      const dateStr = c.date ? new Date(c.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) : null;
      return `
      <li class="sidebar-list-item cursor-pointer hover:bg-surface-2 transition-colors group" onclick="location.hash='#/student/class/${c.id}'">
        <div style="display:flex;align-items:center;gap:8px;width:100%;overflow:hidden;">
          ${dateStr ? `<span style="color:var(--color-text-muted);flex-shrink:0;white-space:nowrap;font-size:10px;font-weight:600;">${dateStr}</span>` : ''}
          <span class="chat-history-title" style="flex:1;overflow:hidden;"><span class="title-scroll" style="display:inline-block;white-space:nowrap;">${escapeHtml(c.title).split('—')[1] || c.title}</span></span>
          ${c.summaryReady ? '<span style="font-size:10px;font-weight:600;border-radius:999px;padding:2px 6px;flex-shrink:0;color:#3b82f6;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);margin-left:auto;">Visto</span>' : ''}
        </div>
      </li>`;
    }).join('');
  };

  const updateClassesSidebar = (classes) => {
    const sectionClasses = document.getElementById('section-classes');
    if (!sectionClasses) return;
    classesCache = (classes || [])
      .filter(c => c.date || c.title)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    classesPage = 0;

    sectionClasses.innerHTML = `
      <div class="sidebar-section-header">
        <div class="sidebar-section-title">
          <svg class="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
          <span>Clases de la materia</span>
        </div>
      </div>
      <div class="chat-history-scroll" id="classes-scroll">
        <ul class="sidebar-list">
          ${renderClassesList()}
        </ul>
      </div>
    `;

    const classesScroll = document.getElementById('classes-scroll');
    if (classesScroll) {
      classesScroll.onscroll = () => {
        const nearBottom = classesScroll.scrollTop + classesScroll.clientHeight >= classesScroll.scrollHeight - 20;
        if (!nearBottom) return;
        if ((classesPage + 1) * CLASSES_PAGE_SIZE >= classesCache.length) return;
        classesPage += 1;
        const list = classesScroll.querySelector('.sidebar-list');
        if (list) {
          list.innerHTML = renderClassesList();
          requestAnimationFrame(applyTitleScroll);
        }
      };
    }
    requestAnimationFrame(applyTitleScroll);
  };

  fetchClassesTask.then(updateClassesSidebar);

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
    requestAnimationFrame(() => {
      if (!isOnboardingCompleted('student') && auth.getAIConsentAccepted()) {
        const engine = new OnboardingEngine({ role: 'student', steps: STUDENT_ONBOARDING_STEPS });
        engine.start();
      }
    });
    updateHistorySidebar(history);
    if (selectedSessionId) {
      window.history.replaceState(null, '', '#/student/dashboard');
    }
  });

  renderBottomNav();
}

function renderInactivityBanner() {
  try {
    const lastVisit = localStorage.getItem('edu_last_visit');
    const now = Date.now();
    localStorage.setItem('edu_last_visit', String(now));
    if (!lastVisit) return '';
    const daysSince = Math.floor((now - parseInt(lastVisit, 10)) / 86400000);
    if (daysSince >= 14) {
      return '<div class="card" style="margin-bottom:var(--space-4);padding:var(--space-4);background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-md);display:flex;align-items:center;gap:var(--space-3)"><span style="font-size:20px;">🔴</span><div><strong>Hacé mucho que no ingresás.</strong> Revisá tus tareas pendientes antes de que se venzan.</div><a href="#/student/tasks" class="btn btn-sm btn-primary" style="margin-left:auto;">Ver tareas</a></div>';
    }
    if (daysSince >= 7) {
      return '<div class="card" style="margin-bottom:var(--space-4);padding:var(--space-4);background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:var(--radius-md);display:flex;align-items:center;gap:var(--space-3)"><span style="font-size:20px;">🟡</span><div><strong>No visitaste la plataforma en ' + daysSince + ' días.</strong> Revisá las novedades.</div><a href="#/student/notifications" class="btn btn-sm btn-secondary" style="margin-left:auto;">Ver novedades</a></div>';
    }
  } catch (e) {
    console.warn('[Inactivity] localStorage error:', e);
  }
  return '';
}
