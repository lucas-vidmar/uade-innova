/* ============================================================
   RagSandbox — Teacher RAG playground to test queries before publishing
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { safeSetItem, safeGetItem } from '../../services/local-storage.js';

const HISTORY_KEY_PREFIX = 'uade.rag-sandbox.history.';
const MAX_HISTORY_ITEMS = 50;
const MAX_HISTORY_ANSWER_CHARS = 300;

let activeSourceModal = null;

function closeActiveSourceModal() {
  if (activeSourceModal) {
    activeSourceModal.remove();
    activeSourceModal = null;
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMarkdown(text = '') {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');
}

function deduplicateSources(sources) {
  if (!Array.isArray(sources)) return [];
  const seen = new Set();
  return sources.filter(s => {
    const key = `${s.sourceFilename || ''}:${s.chunkIndex ?? ''}:${s.classId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHistoryKey(subjectId) {
  return `${HISTORY_KEY_PREFIX}${subjectId}`;
}

function loadHistory(subjectId) {
  try {
    const raw = safeGetItem(getHistoryKey(subjectId), '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistory(subjectId, history) {
  const trimmed = history.slice(-MAX_HISTORY_ITEMS).map(entry => ({
    ...entry,
    answer: String(entry.answer || '').slice(0, MAX_HISTORY_ANSWER_CHARS),
  }));
  safeSetItem(getHistoryKey(subjectId), JSON.stringify(trimmed));
}

export async function renderTeacherRagSandbox(container) {
  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  renderHeader('RAG Sandbox');
  container.innerHTML = `
    <div class="dashboard-wrapper animate-in bg-bg min-h-screen">
      <div class="container py-8">
        <div class="card mb-6" style="border-left:4px solid var(--color-warning)">
          <div style="display:flex;gap:var(--space-3);align-items:flex-start;padding:var(--space-4)">
            <span aria-hidden="true" style="font-size:1.25rem">⚠️</span>
            <div>
              <strong>Esta consulta consume tokens del presupuesto de IA.</strong>
              <div style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">
                Usá este entorno para probar respuestas sobre tus materiales antes de publicarlos. Las consultas no quedan guardadas en el historial del backend.
              </div>
            </div>
          </div>
        </div>

        <div class="card mb-6">
          <div class="card-header">
            <span class="card-title">Configuración de la consulta</span>
          </div>
          <div class="chat-sources-bar" style="border:none;padding:var(--space-4)">
            <div class="chat-sources-top">
              <span class="chat-sources-label">Fuentes de consulta:</span>
            </div>
            <div class="chat-chips-container" id="sandbox-chips" style="margin-bottom:var(--space-3)">
              <span class="text-muted" style="font-size:var(--font-size-sm)">Cargando clases...</span>
            </div>
            <label class="sandbox-toggle-row" style="display:flex;align-items:center;gap:var(--space-3);margin-top:var(--space-2)">
              <input type="checkbox" id="sandbox-simulate-student" style="width:16px;height:16px" />
              <span style="font-size:var(--font-size-sm)">
                <strong>Simular alumno</strong>
                <span style="color:var(--color-text-secondary)">— limita el contexto a lo que un alumno matriculado en las clases seleccionadas vería (solo materiales publicados).</span>
              </span>
            </label>
          </div>
        </div>

        <div class="card mb-6">
          <div class="chat-input-area" style="border:none;padding:var(--space-4)">
            <div class="chat-input-wrapper">
              <textarea
                id="sandbox-input"
                class="chat-input"
                placeholder="Escribí una consulta para probar contra tus materiales..."
                rows="2"
              ></textarea>
              <button class="chat-send-btn" id="sandbox-send" title="Enviar consulta">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>

        <div class="dashboard-layout-grid">
          <section class="h-full flex flex-col">
            <div class="card" style="flex:1;display:flex;flex-direction:column;min-height:320px">
              <div class="card-header">
                <span class="card-title">Vista previa de respuesta</span>
              </div>
              <div class="chat-messages-area" id="sandbox-preview" style="flex:1">
                <div class="empty-state" style="padding:32px;text-align:center;color:var(--color-text-secondary)">
                  Enviá una consulta para ver la respuesta con sus fuentes.
                </div>
              </div>
            </div>
          </section>

          <aside class="flex flex-col gap-6">
            <div class="sidebar-section" id="section-sandbox-history">
              <div class="sidebar-section-header">
                <div class="sidebar-section-title">
                  <span>Historial de consultas (sesión)</span>
                </div>
                <button class="sidebar-section-link" id="sandbox-clear-history" style="background:none;border:none;cursor:pointer;font-size:var(--font-size-xs)">Limpiar</button>
              </div>
              <div class="p-3" id="sandbox-history-list">
                <div class="p-4 text-center text-xs text-text-muted italic">Sin consultas todavía.</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  `;

  const history = loadHistory(activeSubjectId);

  let selectedClassIds = [];
  let isLoading = false;

  const renderHistory = () => {
    const listEl = container.querySelector('#sandbox-history-list');
    if (!listEl) return;
    if (history.length === 0) {
      listEl.innerHTML = `<div class="p-4 text-center text-xs text-text-muted italic">Sin consultas todavía.</div>`;
      return;
    }
    listEl.innerHTML = history
      .map((entry, index) => `
        <div class="history-entry" style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);cursor:pointer" data-history-index="${index}">
          <div style="font-size:var(--font-size-xs);color:var(--color-text-muted)">${new Date(entry.timestamp).toLocaleTimeString('es-AR')}</div>
          <div style="font-size:var(--font-size-sm);font-weight:600">${escapeHtml(entry.question)}</div>
          <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">${escapeHtml(entry.answer || '').slice(0, 120)}${(entry.answer || '').length > 120 ? '…' : ''}</div>
        </div>
      `)
      .join('');
  };

  const renderChips = (classes) => {
    const chipsEl = container.querySelector('#sandbox-chips');
    if (!chipsEl) return;
    if (!classes || classes.length === 0) {
      chipsEl.innerHTML = `<span class="text-muted" style="font-size:var(--font-size-sm)">No hay clases cargadas para esta materia.</span>`;
      return;
    }
    chipsEl.innerHTML = classes.map(c => `
      <button class="source-pill ${selectedClassIds.includes(c.id) ? 'active' : ''}" data-class-id="${c.id}">
        ${escapeHtml((c.title || '').split('—')[0].trim() || 'Clase')}
      </button>
    `).join('');
    chipsEl.querySelectorAll('[data-class-id]').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.classId;
        if (selectedClassIds.includes(id)) {
          selectedClassIds = selectedClassIds.filter(x => x !== id);
        } else {
          selectedClassIds.push(id);
        }
        renderChips(classes);
      });
    });
  };

  const renderSourceCircles = (sources) => {
    const deduped = deduplicateSources(sources);
    return `
      <div class="chat-sources chat-sources-circles">
        ${deduped.map((s, i) => `
          <button class="source-circle-item" data-source-index="${i + 1}" title="${s.slideTitle ? `${escapeHtml(s.slideTitle)} (${escapeHtml(s.sourceFilename)})` : escapeHtml(s.sourceFilename)}">
            <span class="source-circle-num">${i + 1}</span>
            <span class="truncate">${escapeHtml(s.slideTitle || s.sourceFilename)}</span>
          </button>
        `).join('')}
      </div>
    `;
  };

  const renderSourceModal = (source) => {
    closeActiveSourceModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,27,44,0.7);display:flex;align-items:center;justify-content:center;z-index:1000';
    overlay.innerHTML = `
      <div class="card" style="max-width:640px;width:90%;max-height:80vh;overflow:auto;padding:var(--space-6)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4)">
          <h3 class="h4" style="margin:0">${escapeHtml(source.slideTitle || source.sourceFilename || 'Fuente')}</h3>
          <button class="btn btn-secondary btn-sm" id="source-modal-close">Cerrar</button>
        </div>
        <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:var(--space-3)">
          ${escapeHtml(source.sourceFilename || '')} · chunk ${source.chunkIndex ?? '-'} · ${escapeHtml(source.materialType || 'material')} · score ${source.score ?? '-'}
        </div>
        <p style="font-size:var(--font-size-sm);line-height:1.6;white-space:pre-wrap">${escapeHtml(source.text || '')}</p>
      </div>
    `;
    activeSourceModal = overlay;
    document.body.appendChild(overlay);
    const close = () => { closeActiveSourceModal(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#source-modal-close').addEventListener('click', close);
  };

  const bindPreviewEvents = (rootEl) => {
    rootEl?.querySelectorAll('.source-circle-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.sourceIndex, 10) - 1;
        const sources = deduplicateSources(btn.closest('[data-message-id]')?.__sources || []);
        const source = sources[index];
        if (source) renderSourceModal(source);
      });
    });
  };

  const renderAnswerBubble = (sources) => {
    const preview = container.querySelector('#sandbox-preview');
    const msgId = 'sandbox-msg-' + Date.now();
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-msg chat-msg-assistant';
    wrapper.id = `msg-${msgId}`;
    wrapper.dataset.messageId = msgId;
    wrapper.__sources = sources || [];
    wrapper.innerHTML = `
      <div class="chat-msg-body">
        <div class="chat-bubble chat-bubble-assistant" id="bubble-${msgId}">
          <span class="chat-typing-dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>
        </div>
        <div class="chat-msg-footer">
          <div class="model-name-indicator" style="font-size:11px;color:var(--color-text-muted);margin-top:6px"></div>
          <div class="chat-sources" id="sources-${msgId}"></div>
        </div>
      </div>
    `;
    preview.appendChild(wrapper);
    return { wrapper, bubble: wrapper.querySelector(`#bubble-${msgId}`), sourcesEl: wrapper.querySelector(`#sources-${msgId}`) };
  };

  const sendMessage = async () => {
    const input = container.querySelector('#sandbox-input');
    const question = input?.value?.trim();
    if (!question || isLoading || selectedClassIds.length === 0) return;

    const simulateStudent = container.querySelector('#sandbox-simulate-student')?.checked || false;

    input.value = '';
    isLoading = true;
    const sendBtn = container.querySelector('#sandbox-send');
    if (sendBtn) sendBtn.disabled = true;

    const { wrapper, bubble, sourcesEl } = renderAnswerBubble();
    const preview = container.querySelector('#sandbox-preview');
    const emptyState = preview?.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    let fullAnswer = '';
    try {
      await api.ragQueryStream({
        question,
        classIds: selectedClassIds,
        subjectId: activeSubjectId,
        sandbox: true,
        simulateStudent,
      }, (type, data) => {
        if (type === 'metadata') {
          if (data.model) {
            const modelEl = wrapper.querySelector('.model-name-indicator');
            if (modelEl) modelEl.textContent = `Powered by ${data.model}`;
          }
          const sources = data.sources || [];
          wrapper.__sources = sources;
          if (sources.length > 0) {
            sourcesEl.innerHTML = renderSourceCircles(sources);
            bindPreviewEvents(wrapper);
          }
        } else if (type === 'error') {
          bubble.innerHTML = `⚠️ ${escapeHtml(data?.error || 'Error al generar la respuesta.')}`;
        } else if (type === 'delta') {
          fullAnswer += data.content || '';
          bubble.innerHTML = renderMarkdown(fullAnswer);
          preview.scrollTop = preview.scrollHeight;
        } else if (type === 'done') {
          fullAnswer = data.answer || fullAnswer;
          bubble.innerHTML = renderMarkdown(fullAnswer);
        }
      });

      history.push({ question, answer: fullAnswer, timestamp: new Date().toISOString() });
      saveHistory(activeSubjectId, history);
      renderHistory();
    } catch (err) {
      const message = err?.message?.includes('ENROLLMENT_REQUIRED') || err?.status === 403
        ? 'No estás matriculado en esta materia.'
        : `Error de conexión con el servicio de IA.`;
      bubble.innerHTML = `⚠️ ${escapeHtml(message)}`;
    } finally {
      isLoading = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  };

  renderHistory();

  try {
    const classes = await api.getClasses(activeSubjectId);
    renderChips(classes || []);
  } catch (err) {
    container.querySelector('#sandbox-chips').innerHTML = `<span class="text-muted">No se pudieron cargar las clases.</span>`;
  }

  const input = container.querySelector('#sandbox-input');
  const sendBtn = container.querySelector('#sandbox-send');
  sendBtn?.addEventListener('click', sendMessage);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  container.querySelector('#sandbox-clear-history')?.addEventListener('click', () => {
    history.length = 0;
    safeSetItem(getHistoryKey(activeSubjectId), JSON.stringify([]));
    renderHistory();
  });

  container.querySelector('#sandbox-history-list')?.addEventListener('click', (e) => {
    const entryEl = e.target.closest('[data-history-index]');
    if (!entryEl) return;
    const index = parseInt(entryEl.dataset.historyIndex, 10);
    const entry = history[index];
    if (!entry) return;
    const inputEl = container.querySelector('#sandbox-input');
    if (inputEl) inputEl.value = entry.question || '';
    inputEl?.focus();
  });
}
