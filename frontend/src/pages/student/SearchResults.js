import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function iconSearch() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'; }
function iconClose() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'; }
function iconAll() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 22a10 10 0 0 0 10-10"/><path d="M2 12a10 10 0 0 1 10-10"/><path d="M2 12a10 10 0 0 0 10 10"/></svg>'; }
function iconChat() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'; }
function iconDescription() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'; }
function iconTask() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'; }
function iconMore() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>'; }
function iconCalendar() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'; }
function iconFolder() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'; }
function iconArrowRight() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'; }
function iconPriority() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'; }

const CATEGORY_CONFIG = {
    material: { label: 'Materiales de clase', icon: 'description', tabIcon: iconDescription },
    class: { label: 'Clases', icon: 'calendar', tabIcon: iconCalendar },
    task: { label: 'Tareas', icon: 'task', tabIcon: iconTask },
    chat: { label: 'Historial de chats', icon: 'chat', tabIcon: iconChat },
};

const TABS = [
    { id: 'all', label: 'Todo', icon: iconAll },
    { id: 'chat', label: 'Chats', icon: iconChat },
    { id: 'material', label: 'Materiales de clase', icon: iconDescription },
    { id: 'task', label: 'Tareas', icon: iconTask },
    { id: 'class', label: 'Clases', icon: iconCalendar },
];

const CATEGORY_ORDER = ['material', 'class', 'task', 'chat'];

function inferCategory(r) {
    if (r.category) return r.category;
    if (r.materialId) return 'material';
    if (r.classId) return 'class';
    if (r.taskId) return 'task';
    if (r.sessionId) return 'chat';
    return 'material';
}

function groupResults(results) {
    const groups = {};
    for (const cat of CATEGORY_ORDER) groups[cat] = [];
    for (const r of results) {
        const cat = inferCategory(r);
        if (groups[cat]) groups[cat].push(r);
    }
    return groups;
}

function resultTitle(item, category) {
    if (item.title) return item.title;
    if (item.sourceFilename) return item.sourceFilename;
    if (category === 'class' && item.classId) return `Clase ${item.classId}`;
    return 'Sin título';
}

function resultUrl(item, category) {
    if (item.url) return item.url;
    if (category === 'material' && item.classIds?.length) return `#/student/class/${item.classIds[0]}`;
    if (category === 'class' && item.classId) return `#/student/class/${item.classId}`;
    if (category === 'task') return '#/student/tasks';
    return '#/student/dashboard';
}

function iconByCategory(cat) {
    const map = { material: iconDescription, class: iconFolder, task: iconTask, chat: iconChat };
    return (map[cat] || iconDescription)();
}

function relevanceBadge(scorePct) {
    const high = scorePct >= 60;
    const cls = high ? 'sr-badge-high' : 'sr-badge-low';
    return `<span class="sr-relevance-badge ${cls}">${scorePct}% RELEVANCIA</span>`;
}

function materialIconClass(materialType) {
    if (!materialType) return 'sr-icon-box-blue';
    switch (materialType) {
        case 'transcript': return 'sr-icon-box-blue';
        case 'presentation': return 'sr-icon-box-orange';
        case 'notes': return 'sr-icon-box-green';
        case 'bibliography': return 'sr-icon-box-red';
        default: return 'sr-icon-box-blue';
    }
}

function renderResultCard(category, item) {
    const scorePct = Math.round((item.score || 0) * 100);
    const title = resultTitle(item, category);
    const url = resultUrl(item, category);
    const snippet = (item.snippet || '').slice(0, category === 'material' ? 300 : 200);
    const iconHtml = iconByCategory(category);
    const badge = relevanceBadge(scorePct);
    const materialType = item.materialType || '';

    if (category === 'task') {
        return `
        <a href="${escapeHtml(url)}" class="sr-task-card" data-category="task">
          <div class="sr-task-header">
            <div class="sr-task-icon-box">${iconPriority()}</div>
            <div class="sr-task-info">
              <h4 class="sr-task-title">${escapeHtml(title)}</h4>
              <p class="sr-task-snippet">${escapeHtml(snippet)}</p>
            </div>
            <span class="sr-task-arrow">${iconArrowRight()}</span>
          </div>
          <div class="sr-task-progress">
            <div class="sr-progress-track"><div class="sr-progress-fill" style="width:${Math.min(scorePct, 100)}%"></div></div>
            <span class="sr-progress-label">${scorePct}% completado</span>
          </div>
        </a>`;
    }

    const iconBoxClass = category === 'material' ? materialIconClass(materialType)
        : category === 'class' ? 'sr-icon-box-green'
        : category === 'chat' ? 'sr-icon-box-purple'
        : 'sr-icon-box-orange';

    return `
    <a href="${escapeHtml(url)}" class="sr-card" data-category="${category}">
      <div class="${iconBoxClass}">${iconHtml}</div>
      <div class="sr-card-body">
        <div class="sr-card-top">
          <h3 class="sr-card-title">${escapeHtml(title)}</h3>
          ${badge}
        </div>
        <p class="sr-card-snippet${materialType === 'transcript' || materialType === 'bibliography' ? ' sr-snippet-italic' : ''}">${escapeHtml(snippet)}</p>
        <div class="sr-card-meta">
          <span class="sr-meta-tag">${iconCalendar()} ${item.lectureDate || item.date || ''}</span>
          <span class="sr-meta-tag">${iconFolder()} ${item.categoryLabel || materialType || category}</span>
        </div>
      </div>
    </a>`;
}

function renderTabs(activeTab, totals) {
    return `<div class="sr-tabs" role="tablist">${TABS.map(tab => {
        const count = tab.id === 'all'
            ? Object.values(totals).reduce((a, b) => a + b, 0)
            : (totals[tab.id] || 0);
        if (count === 0 && tab.id !== 'all') return '';
        const activeClass = tab.id === activeTab ? 'sr-tab-active' : '';
        return `<button class="sr-tab ${activeClass}" data-tab="${tab.id}" role="tab">${tab.icon()} ${tab.label} <span class="sr-tab-count">${count}</span></button>`;
    }).filter(Boolean).join('')}</div>`;
}

function renderSearchHeader(searchQuery, activeSubjectName) {
    return `
    <div class="search-page-header">
      <h1 class="sr-page-title">Resultados de búsqueda</h1>
      <div class="sr-search-bar">
        <div class="sr-search-icon">${iconSearch()}</div>
        <input class="sr-search-input" id="search-page-input" type="text"
          placeholder="Buscar materiales, tareas o chats..."
          value="${escapeHtml(searchQuery)}" autofocus />
        <div class="sr-search-actions">
          <button class="sr-search-clear" id="search-clear-btn" ${!searchQuery ? 'style="display:none"' : ''}>
            ${iconClose()}
          </button>
          <span class="sr-search-divider"></span>
          <span class="sr-search-hint">ESC</span>
        </div>
      </div>
      <div class="sr-search-meta">
        <p class="sr-search-count" id="search-results-count">${searchQuery ? `Resultados para <strong>${escapeHtml(searchQuery)}</strong>` : '&nbsp;'}</p>
      </div>
    </div>`;
}

function renderEmptyState(searchQuery) {
    return `
    <div class="search-page">
      ${renderSearchHeader(searchQuery, auth.getActiveSubjectName?.() || 'la materia')}
      <div class="sr-empty">
        <div class="sr-empty-icon">${iconSearch()}</div>
        <h3>${searchQuery ? `No encontramos resultados para "${escapeHtml(searchQuery)}"` : 'Escribí algo para buscar'}</h3>
        <p>${searchQuery ? 'Probá con otros términos o revisá que la materia tenga materiales cargados.' : 'Usá la búsqueda para encontrar materiales, tareas y chats.'}</p>
      </div>
    </div>`;
}

export async function renderStudentSearchResults(container) {
    const hash = window.location.hash || '';
    const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
    const initialQuery = params.get('q') || '';

    renderHeader('Búsqueda');
    container.innerHTML = '<div class="sr-loading"><div class="sr-spinner"></div><p>Buscando...</p></div>';

    const user = auth.getUser();
    const activeSubjectId = auth.getActiveSubjectId();
    let query = initialQuery;
    let activeTab = 'all';
    let allGrouped = {};
    let lastQuery = '';

    function getQueryParam() {
        const h = window.location.hash || '';
        const p = new URLSearchParams(h.includes('?') ? h.split('?')[1] : '');
        return p.get('q') || '';
    }

    function tabTotals(grouped) {
        const t = {};
        for (const cat of CATEGORY_ORDER) t[cat] = (grouped[cat] || []).length;
        return t;
    }

    function renderResultsContent(grouped, tab) {
        const totals = tabTotals(grouped);
        const allCount = Object.values(totals).reduce((a, b) => a + b, 0);

        let filtered = [];
        if (tab === 'all') {
            for (const cat of CATEGORY_ORDER) {
                filtered.push(...(grouped[cat] || []).map(r => ({ ...r, _cat: cat })));
            }
        } else {
            filtered = (grouped[tab] || []).map(r => ({ ...r, _cat: tab }));
        }

        if (filtered.length === 0 && tab === 'all') {
            return renderEmptyState(query);
        }

        if (filtered.length === 0) {
            return `<div class="sr-empty"><h3>Sin resultados en esta categoría</h3><p>No hay ${CATEGORY_CONFIG[tab]?.label?.toLowerCase() || 'resultados'} que coincidan con tu búsqueda.</p></div>`;
        }

        let sectionsHtml = '';
        for (const cat of CATEGORY_ORDER) {
            const items = tab === 'all' ? (grouped[cat] || []) : (cat === tab ? filtered : []);
            if (!items.length) continue;
            sectionsHtml += `
            <section class="sr-section">
              <div class="sr-section-header">
                <h2 class="sr-section-title">${CATEGORY_CONFIG[cat]?.label || cat}</h2>
                <span class="sr-section-arrow">${iconArrowRight()}</span>
              </div>
              <div class="sr-section-list">${items.map(r => renderResultCard(cat, r)).join('')}</div>
            </section>`;
        }

        return `
        <div class="search-page-results">
          <p class="sr-summary">${allCount} resultado${allCount !== 1 ? 's' : ''} encontrados para <strong>${escapeHtml(query)}</strong></p>
          ${renderTabs(tab, totals)}
          <div class="sr-results-content">${sectionsHtml}</div>
        </div>`;
    }

    function bindTabs() {
        document.querySelectorAll('.sr-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (tab === activeTab) return;
                activeTab = tab;
                document.querySelectorAll('.sr-tab').forEach(t => t.classList.remove('sr-tab-active'));
                btn.classList.add('sr-tab-active');
                const content = document.querySelector('.sr-results-content');
                if (content) {
                    const target = renderResultsContent(allGrouped, activeTab);
                    const parent = content.parentElement;
                    const existingContent = parent.querySelector('.sr-results-content');
                    if (existingContent) existingContent.outerHTML = target;
                }
            });
        });
    }

    async function performSearch(searchQuery) {
        if (!searchQuery.trim()) {
            container.innerHTML = renderEmptyState('');
            return;
        }

        query = searchQuery;
        container.innerHTML = `
        <div class="search-page">
          ${renderSearchHeader(searchQuery, auth.getActiveSubjectName?.() || 'la materia')}
          <div class="sr-loading" id="search-loading"><p>Buscando...</p></div>
        </div>`;

        const clearBtn = container.querySelector('#search-clear-btn');
        const pageInput = container.querySelector('#search-page-input');

        pageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = pageInput.value.trim();
                if (val) window.location.hash = `#/student/search?q=${encodeURIComponent(val)}`;
            }
        });
        pageInput?.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = pageInput.value.trim() ? 'flex' : 'none';
        });
        pageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                pageInput.value = '';
                pageInput.blur();
                if (clearBtn) clearBtn.style.display = 'none';
            }
        });
        clearBtn?.addEventListener('click', () => {
            if (pageInput) {
                pageInput.value = '';
                pageInput.focus();
            }
            clearBtn.style.display = 'none';
        });

        try {
            const data = await api.globalSearch({ query: searchQuery, subjectId: activeSubjectId, userId: user?.id });
            const results = Array.isArray(data?.results) ? data.results : [];
            allGrouped = groupResults(results);
            lastQuery = searchQuery;

            const resultsHtml = renderResultsContent(allGrouped, 'all');
            const loadingEl = container.querySelector('#search-loading');
            if (loadingEl) loadingEl.outerHTML = resultsHtml;
            bindTabs();
        } catch (err) {
            console.error('[SearchResults] Error:', err);
            const loadingEl = container.querySelector('#search-loading');
            if (loadingEl) {
                loadingEl.outerHTML = `
              <div class="sr-error">
                <div class="sr-error-icon">⚠️</div>
                <h3>Error al buscar</h3>
                <p>No se pudieron cargar los resultados. Intentalo de nuevo.</p>
                <button class="btn btn-secondary" onclick="window.location.reload()">Reintentar</button>
              </div>`;
            }
        }
    }

    window.addEventListener('hashchange', () => {
        const newQuery = getQueryParam();
        if (newQuery !== query) {
            activeTab = 'all';
            performSearch(newQuery);
        }
    });

    performSearch(query);
}
