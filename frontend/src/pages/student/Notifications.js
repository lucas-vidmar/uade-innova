import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { toast } from '../../components/Toast.js';
import { renderHeader } from '../../components/Header.js';

const FILTER_TABS = [
  { id: 'all', label: 'Todos' },
  { id: 'grade', label: 'Nota' },
  { id: 'summary', label: 'Resumen' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'material', label: 'Material' },
  { id: 'teacher-reminder', label: 'Recordatorio' },
];

const PAGE_SIZE = 25;

export async function renderStudentNotifications(container) {
  renderHeader('Historial de Notificaciones');
  container.innerHTML = '<div class="card"><div class="empty-state" style="padding:40px"><div class="animate-pulse">Cargando notificaciones...</div></div></div>';

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = '<div class="card"><div class="empty-state" style="padding:40px"><span class="empty-state-icon">🔔</span><p>Seleccioná una materia para ver sus notificaciones.</p></div></div>';
    return;
  }

  let allNotifications = [];
  let displayedNotifications = [];
  let activeFilter = 'all';
  let searchQuery = '';
  let isLoadingMore = false;
  let hasMore = true;
  // #379: si la lectura falla (p. ej. timeout de red), la página sigue en pie y lo dice.
  let loadError = false;

  async function loadPage(skip) {
    const items = await api.getNotifications({
      userId: user.id,
      subjectId: activeSubjectId,
      limit: PAGE_SIZE,
      skip,
    });
    return Array.isArray(items) ? items : [];
  }

  async function loadInitial() {
    try {
      const items = await loadPage(0);
      allNotifications = items;
      hasMore = items.length >= PAGE_SIZE;
      loadError = false;
    } catch (err) {
      console.error('[Notifications] Failed to load notifications:', err);
      loadError = true;
      allNotifications = [];
      hasMore = false;
    }
    applyFilters();
  }

  function applyFilters() {
    let filtered = [...allNotifications];

    if (activeFilter !== 'all') {
      filtered = filtered.filter((n) => n.type === activeFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((n) =>
        n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q)
      );
    }

    displayedNotifications = filtered;
    render();
  }

  function render() {
    const unreadCount = allNotifications.filter((n) => n.unread).length;
    const prevActiveId = document.activeElement ? document.activeElement.id : null;
    const prevWasSearch = prevActiveId === 'notif-search';
    const prevSelStart = prevWasSearch ? document.activeElement.selectionStart : null;
    const prevSelEnd = prevWasSearch ? document.activeElement.selectionEnd : null;

    container.innerHTML = `
      <div class="notifications-page">
        <div class="notifications-header">
          <div class="notifications-header-left">
            <h2 class="section-title" style="margin:0">Historial de Notificaciones</h2>
            <span class="notifications-count">${loadError ? 'No se pudo leer el total' : `${allNotifications.length} totales · ${unreadCount} sin leer`}</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="notif-mark-all-read" ${unreadCount === 0 ? 'disabled' : ''}>
            Marcar todas leídas
          </button>
        </div>

        <div class="notifications-toolbar">
          <div class="notifications-filter-pills">
            ${FILTER_TABS.map((tab) => `
              <button class="notif-pill ${activeFilter === tab.id ? 'active' : ''}" data-filter="${tab.id}">${tab.label}</button>
            `).join('')}
          </div>
          <div class="notifications-search-wrap">
            <svg class="notif-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" class="notif-search-input" id="notif-search" placeholder="Buscar notificaciones..." value="${escapeHtml(searchQuery)}">
          </div>
        </div>

        <div class="notifications-list" id="notifications-list">
          ${renderNotificationItems()}
        </div>

        ${hasMore ? `
          <div class="notifications-load-more">
            <button class="btn btn-secondary" id="notif-load-more" ${isLoadingMore ? 'disabled' : ''}>
              ${isLoadingMore ? 'Cargando...' : 'Cargar más'}
            </button>
          </div>
        ` : ''}
      </div>
    `;

    attachEvents();

    if (prevWasSearch) {
      const restored = document.getElementById('notif-search');
      if (restored) {
        restored.focus();
        try {
          const len = restored.value.length;
          const s = prevSelStart != null ? prevSelStart : len;
          const e = prevSelEnd != null ? prevSelEnd : len;
          restored.setSelectionRange(s, e);
        } catch {}
      }
    }
  }

  function renderNotificationItems() {
    if (loadError) {
      return `<div class="card"><div class="empty-state" style="padding:32px">
        <span class="empty-state-icon" aria-hidden="true">⚠️</span>
        <p style="font-weight:600">No se pudieron cargar los avisos</p>
        <p style="color:var(--color-text-secondary);font-size:13px">La conexión tardó más de lo esperado. Revisá tu conexión e intentá de nuevo.</p>
        <button class="btn btn-secondary" id="notif-retry-btn" style="margin-top:12px">Reintentar</button>
      </div></div>`;
    }
    if (displayedNotifications.length === 0) {
      if (searchQuery.trim()) {
        return '<div class="card"><div class="empty-state" style="padding:32px"><p>No se encontraron notificaciones con ese texto.</p></div></div>';
      }
      if (activeFilter !== 'all') {
        return '<div class="card"><div class="empty-state" style="padding:32px"><p>No hay notificaciones de este tipo.</p></div></div>';
      }
      return '<div class="card"><div class="empty-state" style="padding:32px"><span class="empty-state-icon">🔔</span><p>No hay notificaciones para esta materia.</p></div></div>';
    }

    return displayedNotifications.map((item) => {
      const icon = item.type === 'grade' ? '📝' : item.type === 'summary' ? '📘' : item.type === 'deadline' ? '⏰' : item.type === 'teacher-reminder' ? '👨‍🏫' : '📂';
      const typeLabel = item.type === 'grade' ? 'Nota' : item.type === 'summary' ? 'Resumen' : item.type === 'deadline' ? 'Deadline' : item.type === 'teacher-reminder' ? 'Recordatorio' : 'Material';
      return `
        <div class="notif-item ${item.unread ? 'unread' : ''}" data-notification-id="${item.id}" data-target-hash="${item.targetHash || '#/student/dashboard'}">
          <div class="notif-item-icon">${icon}</div>
          <div class="notif-item-body">
            <div class="notif-item-top">
              <span class="notif-type-label">${typeLabel}</span>
              <span class="notif-time">${formatDate(item.createdAt)}</span>
            </div>
            <div class="notif-title">${escapeHtml(item.title)}</div>
            <div class="notif-message">${escapeHtml(item.message)}</div>
          </div>
          <div class="notif-item-actions">
            ${item.unread ? `
              <button class="notif-mark-read-btn" data-notification-action="mark-read" title="Marcar como leída">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </button>
            ` : `
              <span class="notif-read-badge">Leída</span>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  function attachEvents() {
    document.querySelectorAll('.notif-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    const searchInput = document.getElementById('notif-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        applyFilters();
      });
    }

    const retryBtn = document.getElementById('notif-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Reintentando...';
        await loadInitial();
      });
    }

    const markAllBtn = document.getElementById('notif-mark-all-read');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async () => {
        const unreadIds = allNotifications.filter((n) => n.unread).map((n) => n.id);
        if (unreadIds.length === 0) return;

        const before = [...allNotifications];
        allNotifications = allNotifications.map((n) => ({ ...n, unread: false }));
        applyFilters();

        try {
          await api.markNotificationsRead({ notificationIds: unreadIds, userId: user.id, subjectId: activeSubjectId });
          toast('success', 'Notificaciones actualizadas', 'Se marcaron todas como leídas.');
        } catch (err) {
          allNotifications = before;
          applyFilters();
          toast('error', 'No se pudo actualizar', err?.message || 'Intentá nuevamente en unos segundos.');
        }
      });
    }

    const listEl = document.getElementById('notifications-list');
    if (listEl) {
      listEl.addEventListener('click', async (e) => {
        const markBtn = e.target.closest('[data-notification-action="mark-read"]');
        if (markBtn) {
          const itemEl = markBtn.closest('[data-notification-id]');
          if (!itemEl) return;
          const id = itemEl.dataset.notificationId;

          const before = [...allNotifications];
          allNotifications = allNotifications.map((n) => (n.id === id ? { ...n, unread: false } : n));
          applyFilters();

          try {
            await api.markNotificationRead({ notificationId: id, userId: user.id, subjectId: activeSubjectId });
            toast('success', 'Notificación leída', 'Se marcó como leída.');
          } catch (err) {
            allNotifications = before;
            applyFilters();
            toast('error', 'No se pudo actualizar', err?.message || 'Intentá nuevamente en unos segundos.');
          }
          return;
        }

        const itemEl = e.target.closest('[data-notification-id]');
        if (itemEl) {
          const id = itemEl.dataset.notificationId;
          const targetHash = itemEl.dataset.targetHash;

          allNotifications = allNotifications.map((n) => (n.id === id ? { ...n, unread: false } : n));
          applyFilters();
          try {
            await api.markNotificationRead({ notificationId: id, userId: user.id, subjectId: activeSubjectId });
          } catch { }

          if (targetHash) window.location.hash = targetHash;
        }
      });
    }

    const loadMoreBtn = document.getElementById('notif-load-more');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        isLoadingMore = true;
        render();

        const newItems = await loadPage(allNotifications.length);
        if (newItems.length === 0) {
          hasMore = false;
          isLoadingMore = false;
          render();
          return;
        }

        allNotifications = [...allNotifications, ...newItems];
        hasMore = newItems.length >= PAGE_SIZE;
        isLoadingMore = false;
        applyFilters();
      });
    }
  }

  await loadInitial();
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  if (diffHours < 48) return 'ayer';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
