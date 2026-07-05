/* ============================================================
   Student Search Results — Full-text search across materials,
   classes, tasks, and chat history
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svgIcon(name) {
    const icons = {
        search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        material: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        class: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        task: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        empty: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    };
    return icons[name] || icons.search;
}

const CATEGORY_CONFIG = {
    material: { label: 'Materiales de clase', color: 'var(--color-primary)' },
    class: { label: 'Clases', color: 'var(--color-success)' },
    task: { label: 'Tareas', color: 'var(--color-warning)' },
    chat: { label: 'Historial de chats', color: 'var(--color-secondary)' },
};

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
    for (const category of CATEGORY_ORDER) {
        groups[category] = [];
    }
    for (const r of results) {
        const cat = inferCategory(r);
        if (groups[cat]) {
            groups[cat].push(r);
        }
    }
    return groups;
}

function renderCategorySection(category, items) {
    if (!items || items.length === 0) return '';
    const config = CATEGORY_CONFIG[category];
    return `
    <section class="search-category-section">
      <div class="search-category-header">
        <span class="search-category-dot" style="background:${config.color}"></span>
        <h2 class="search-category-title">${config.label}</h2>
        <span class="search-category-count">${items.length}</span>
      </div>
      <div class="search-category-results">
        ${items.map(item => renderResultCard(category, item)).join('')}
      </div>
    </section>
  `;
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

function renderResultCard(category, item) {
    const icon = svgIcon(category);
    const scorePct = Math.round((item.score || 0) * 100);
    const title = resultTitle(item, category);
    const url = resultUrl(item, category);
    const snippet = (item.snippet || '').slice(0, category === 'material' ? 300 : 200);

    switch (category) {
        case 'material':
            return `
        <a href="${escapeHtml(url)}" class="search-result-card" data-category="material">
          <div class="search-result-icon search-icon-material">${svgIcon('material')}</div>
          <div class="search-result-body">
            <div class="search-result-title-row">
              <span class="search-result-title">${escapeHtml(title)}</span>
              <span class="search-result-type">${item.materialType || ''}</span>
            </div>
            <p class="search-result-snippet">${escapeHtml(snippet)}</p>
            <div class="search-result-meta">
              <span>${item.sourceFilename || ''}</span>
              <span class="search-result-score">${scorePct}% relevancia</span>
            </div>
          </div>
        </a>`;
        case 'class':
            return `
        <a href="${escapeHtml(url)}" class="search-result-card" data-category="class">
          <div class="search-result-icon search-icon-class">${svgIcon('class')}</div>
          <div class="search-result-body">
            <div class="search-result-title-row">
              <span class="search-result-title">${escapeHtml(title)}</span>
            </div>
            <p class="search-result-snippet">${escapeHtml(snippet)}</p>
            <div class="search-result-meta">
              <span>${scorePct}% relevancia</span>
            </div>
          </div>
        </a>`;
        case 'task':
            return `
        <a href="${escapeHtml(url)}" class="search-result-card" data-category="task">
          <div class="search-result-icon search-icon-task">${svgIcon('task')}</div>
          <div class="search-result-body">
            <div class="search-result-title-row">
              <span class="search-result-title">${escapeHtml(title)}</span>
            </div>
            <p class="search-result-snippet">${escapeHtml(snippet)}</p>
            <div class="search-result-meta">
              <span>${scorePct}% relevancia</span>
            </div>
          </div>
        </a>`;
        case 'chat':
            return `
        <a href="${escapeHtml(url)}" class="search-result-card" data-category="chat">
          <div class="search-result-icon search-icon-chat">${svgIcon('chat')}</div>
          <div class="search-result-body">
            <div class="search-result-title-row">
              <span class="search-result-title">${escapeHtml(title)}</span>
            </div>
            <p class="search-result-snippet">${escapeHtml(snippet)}</p>
            <div class="search-result-meta">
              <span>${scorePct}% relevancia</span>
            </div>
          </div>
        </a>`;
        default:
            return '';
    }
}

export async function renderStudentSearchResults(container) {
    const hash = window.location.hash || '';
    const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
    const initialQuery = params.get('q') || '';

    renderHeader('Búsqueda');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando...</div>`;

    const user = auth.getUser();
    const activeSubjectId = auth.getActiveSubjectId();
    let query = initialQuery;

    function getQueryParam() {
        const h = window.location.hash || '';
        const p = new URLSearchParams(h.includes('?') ? h.split('?')[1] : '');
        return p.get('q') || '';
    }

    async function performSearch(searchQuery) {
        if (!searchQuery.trim()) {
            container.innerHTML = renderEmptyState('Escribí algo para buscar');
            return;
        }

        container.innerHTML = `
        <div class="search-page">
          <div class="search-page-header">
            <div class="search-bar-wrapper">
              <div class="search-bar-icon">${svgIcon('search')}</div>
              <input class="search-bar-input" id="search-page-input" type="text"
                placeholder="Buscar en ${escapeHtml(auth.getActiveSubjectName?.() || 'la materia')}..."
                value="${escapeHtml(searchQuery)}" autofocus />
              <button class="search-bar-clear" id="search-clear-btn" ${!searchQuery ? 'style="display:none"' : ''}>
                ${svgIcon('close')}
              </button>
            </div>
            <p class="search-page-subtitle">Resultados para <strong>${escapeHtml(searchQuery)}</strong></p>
          </div>
          <div class="search-page-loading">
            <div class="animate-pulse" style="text-align:center;padding:40px;color:var(--color-text-muted)">Buscando...</div>
          </div>
        </div>`;

        const loadingEl = container.querySelector('.search-page-loading');
        const clearBtn = container.querySelector('#search-clear-btn');
        const pageInput = container.querySelector('#search-page-input');

        pageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = pageInput.value.trim();
                if (val) {
                    window.location.hash = `#/student/search?q=${encodeURIComponent(val)}`;
                }
            }
        });

        pageInput?.addEventListener('input', () => {
            const val = pageInput.value.trim();
            if (clearBtn) {
                clearBtn.style.display = val ? 'flex' : 'none';
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
            const grouped = groupResults(results);
            const total = results.length;

            if (total === 0) {
                if (loadingEl) {
                    loadingEl.outerHTML = renderEmptyState(
                        `No encontramos resultados para "${escapeHtml(searchQuery)}"`,
                        'Probá con otros términos o revisá que la materia tenga materiales cargados.'
                    );
                }
                return;
            }

            const sectionsHtml = CATEGORY_ORDER
                .map(cat => renderCategorySection(cat, grouped[cat]))
                .filter(Boolean)
                .join('');

            if (loadingEl) {
                loadingEl.outerHTML = `
              <div class="search-page-results">
                <div class="search-page-summary">${total} resultado${total !== 1 ? 's' : ''}</div>
                ${sectionsHtml}
              </div>
            `;
            }
        } catch (err) {
            console.error('[SearchResults] Error:', err);
            if (loadingEl) {
                loadingEl.outerHTML = `
              <div class="search-page-error">
                <div class="empty-state-icon" aria-hidden="true">⚠️</div>
                <h3>Error al buscar</h3>
                <p style="color:var(--color-text-secondary)">No se pudieron cargar los resultados. Intentalo de nuevo.</p>
                <button class="btn btn-secondary" onclick="window.location.reload()">Reintentar</button>
              </div>
            `;
            }
        }
    }

    function renderEmptyState(message, detail) {
        return `
      <div class="search-page">
        <div class="search-page-header">
          <div class="search-bar-wrapper">
            <div class="search-bar-icon">${svgIcon('search')}</div>
            <input class="search-bar-input" id="search-page-input" type="text"
              placeholder="Buscar en ${escapeHtml(auth.getActiveSubjectName?.() || 'la materia')}..."
              value="${escapeHtml(query)}" autofocus />
            <button class="search-bar-clear" id="search-clear-btn" ${!query ? 'style="display:none"' : ''}>
              ${svgIcon('close')}
            </button>
          </div>
        </div>
        <div class="search-page-empty">
          <div class="empty-state-icon" style="opacity:0.4">${svgIcon('empty')}</div>
          <h3>${escapeHtml(message)}</h3>
          ${detail ? `<p style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">${escapeHtml(detail)}</p>` : ''}
        </div>
      </div>`;
    }

    window.addEventListener('hashchange', () => {
        const newQuery = getQueryParam();
        if (newQuery !== query) {
            query = newQuery;
            performSearch(query);
        }
    });

    performSearch(query);
}
