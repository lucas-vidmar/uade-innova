/* ============================================================
   RagSandbox — Teacher RAG playground to test queries before publishing
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { safeSetItem, safeGetItem } from '../../services/local-storage.js';
import { generationLabel } from '../../components/chat-generation-label.js';

const HISTORY_KEY_PREFIX = 'uade.rag-sandbox.history.';
const COMPARISON_KEY_PREFIX = 'uade.rag-sandbox.comparison.';
const MAX_HISTORY_ITEMS = 50;
const MAX_HISTORY_ANSWER_CHARS = 300;
const MAX_COMPARISON_ITEMS = 20;
const VERDICTS = [
  { id: 'mejora', label: 'Mejora' },
  { id: 'retroceso', label: 'Retroceso' },
  { id: 'empate', label: 'Empate' },
];

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

/**
 * Formato de fecha y hora alineado con el resto de la app (ver `#/teacher/corrections`,
 * `#/teacher/dashboard`): día + mes abreviado + hora con sufijo a. m./p. m.
 *
 * `toLocaleTimeString('es-AR')` a secas (lo que usaba el historial) devuelve 12 horas
 * SIN indicador en el motor del navegador: `00:00:04` y `12:00:04` salían ambos como
 * «12:00:04» y no había forma de distinguir medianoche de mediodía (#553).
 */
function formatDateTimeEsAr(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
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

/* ── UJ-49: comparación caso por caso entre el comportamiento vigente y el propuesto ──
   La comparación vive en el navegador de quien enseña (como el historial del banco):
   no se activa ninguna versión y no se escribe nada en los hilos reales. */

function getComparisonKey(subjectId) {
  return `${COMPARISON_KEY_PREFIX}${subjectId}`;
}

function loadComparison(subjectId) {
  try {
    const raw = safeGetItem(getComparisonKey(subjectId), '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveComparison(subjectId, comparison) {
  safeSetItem(getComparisonKey(subjectId), JSON.stringify(comparison.slice(-MAX_COMPARISON_ITEMS)));
}

function comparisonToMarkdown(subjectId, comparison, activeVersionId) {
  const lineas = [
    '# Comparación de comportamiento del asistente (banco de pruebas)',
    '',
    `- Materia: ${subjectId}`,
    `- Comportamiento vigente (referencia): ${activeVersionId || 'versión activa'}`,
    `- Casos comparados: ${comparison.length}`,
    '- Ninguna versión propuesta fue activada y ninguna consulta del banco se guardó en un hilo real.',
    '',
  ];
  comparison.forEach((c, i) => {
    lineas.push(`## Caso ${i + 1}: ${c.question}`);
    lineas.push('');
    lineas.push(`- Veredicto: ${c.verdict || 'sin marcar'}`);
    lineas.push('');
    lineas.push(`### Vigente (${c.vigente?.versionId || 'activa'})`);
    lineas.push('');
    lineas.push(c.vigente?.answer || '(sin respuesta)');
    lineas.push('');
    lineas.push(`### Propuesta (${c.propuesta?.versionId || 'sin versión'})`);
    lineas.push('');
    lineas.push(c.propuesta?.answer || '(sin respuesta)');
    lineas.push('');
  });
  return lineas.join('\n');
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
            <div class="sandbox-toggle-row" style="display:flex;align-items:center;gap:var(--space-3);margin-top:var(--space-3);flex-wrap:wrap">
              <label for="sandbox-version" style="font-size:var(--font-size-sm)"><strong>Comportamiento a probar</strong></label>
              <select id="sandbox-version" class="input" style="max-width:420px">
                <option value="">Cargando versiones…</option>
              </select>
            </div>
            <label class="sandbox-toggle-row" style="display:flex;align-items:center;gap:var(--space-3);margin-top:var(--space-2)">
              <input type="checkbox" id="sandbox-compare" style="width:16px;height:16px" />
              <span style="font-size:var(--font-size-sm)">
                <strong>Comparar con la vigente</strong>
                <span style="color:var(--color-text-secondary)">— corre el mismo caso contra la versión vigente y contra la propuesta, y las enfrenta caso por caso. La propuesta no se activa ni llega a ningún hilo real.</span>
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

        <div class="card mb-6" id="section-sandbox-comparison">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
            <span class="card-title">Comparación vigente vs propuesta</span>
            <span style="display:flex;gap:var(--space-2)">
              <button class="btn btn-secondary btn-sm" id="sandbox-comparison-export">Exportar comparación</button>
              <button class="btn btn-secondary btn-sm" id="sandbox-comparison-clear">Limpiar</button>
            </span>
          </div>
          <div class="p-4">
            <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-bottom:var(--space-3)">
              Cada caso enfrenta la respuesta del comportamiento vigente con la de la versión propuesta. Marcá mejora, retroceso o empate.
              La versión propuesta nunca se activa y estas consultas no quedan en el historial del backend: ningún hilo real las recibe.
            </div>
            <div id="sandbox-comparison-list">
              <div class="p-4 text-center text-xs text-text-muted italic">Todavía no comparaste ningún caso.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const history = loadHistory(activeSubjectId);
  const comparison = loadComparison(activeSubjectId);

  let selectedClassIds = [];
  let isLoading = false;
  let availableVersions = [];
  let activeVersionId = null;

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
          <div style="font-size:var(--font-size-xs);color:var(--color-text-muted)">${formatDateTimeEsAr(entry.timestamp)}</div>
          <div style="font-size:var(--font-size-sm);font-weight:600">${escapeHtml(entry.question)}</div>
          <div style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">${escapeHtml(entry.answer || '').slice(0, 120)}${(entry.answer || '').length > 120 ? '…' : ''}</div>
        </div>
      `)
      .join('');
  };

  const renderVersions = () => {
    const select = container.querySelector('#sandbox-version');
    if (!select) return;
    if (availableVersions.length === 0) {
      select.innerHTML = `<option value="">No se pudieron cargar las versiones</option>`;
      return;
    }
    const activa = availableVersions.find(v => v.isActive);
    const propuestas = availableVersions.filter(v => !v.isActive);
    const opciones = [
      `<option value="">Vigente${activa ? ` (${escapeHtml(activa.versionId)})` : ''}</option>`,
      ...propuestas.map(v => `<option value="${escapeHtml(v.versionId)}">Propuesta: ${escapeHtml(v.versionId)}${v.description ? ` — ${escapeHtml(v.description)}` : ''}</option>`),
    ];
    select.innerHTML = opciones.join('');
  };

  const renderComparison = () => {
    const listEl = container.querySelector('#sandbox-comparison-list');
    if (!listEl) return;
    if (comparison.length === 0) {
      listEl.innerHTML = `<div class="p-4 text-center text-xs text-text-muted italic">Todavía no comparaste ningún caso.</div>`;
      return;
    }
    listEl.innerHTML = comparison.map((c, index) => `
      <div class="card mb-3" style="border:1px solid var(--color-border)" data-comparison-index="${index}">
        <div class="p-3" style="border-bottom:1px solid var(--color-border)">
          <div style="font-size:var(--font-size-xs);color:var(--color-text-muted)">${formatDateTimeEsAr(c.timestamp)} · caso ${index + 1}</div>
          <div style="font-weight:600">${escapeHtml(c.question)}</div>
        </div>
        <div class="dashboard-layout-grid" style="padding:var(--space-3);gap:var(--space-3)">
          <div>
            <div style="font-size:var(--font-size-xs);font-weight:600;margin-bottom:var(--space-1)">Vigente (${escapeHtml(c.vigente?.versionId || 'activa')})</div>
            <div style="font-size:var(--font-size-sm);white-space:pre-wrap">${escapeHtml(c.vigente?.answer || '(sin respuesta)')}</div>
          </div>
          <div>
            <div style="font-size:var(--font-size-xs);font-weight:600;margin-bottom:var(--space-1)">Propuesta (${escapeHtml(c.propuesta?.versionId || 'sin versión')})</div>
            <div style="font-size:var(--font-size-sm);white-space:pre-wrap">${escapeHtml(c.propuesta?.answer || '(sin respuesta)')}</div>
          </div>
        </div>
        <div class="p-3" style="border-top:1px solid var(--color-border);display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary)">Veredicto:</span>
          ${VERDICTS.map(v => `<button class="btn btn-sm ${c.verdict === v.id ? 'btn-primary' : 'btn-secondary'}" data-verdict="${v.id}">${v.label}</button>`).join('')}
          <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-left:auto">${c.verdict ? `marcado: ${escapeHtml(c.verdict)}` : 'sin marcar'}</span>
        </div>
      </div>
    `).join('');
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

  const renderAnswerBubble = (parentEl = null) => {
    const preview = parentEl || container.querySelector('#sandbox-preview');
    const msgId = 'sandbox-msg-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-msg chat-msg-assistant';
    wrapper.id = `msg-${msgId}`;
    wrapper.dataset.messageId = msgId;
    wrapper.__sources = [];
    wrapper.innerHTML = `
      <div class="chat-msg-body">
        <div class="chat-bubble chat-bubble-assistant" id="bubble-${msgId}">
          <span class="chat-typing-dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>
        </div>
        <div class="chat-msg-footer">
          <div class="model-name-indicator" style="font-size:11px;color:var(--color-text-muted);margin-top:6px"></div>
          <div class="prompt-version-indicator" style="font-size:11px;color:var(--color-text-muted)"></div>
          <div class="chat-sources" id="sources-${msgId}"></div>
        </div>
      </div>
    `;
    preview.appendChild(wrapper);
    return { wrapper, bubble: wrapper.querySelector(`#bubble-${msgId}`), sourcesEl: wrapper.querySelector(`#sources-${msgId}`) };
  };

  /**
   * Corre UNA consulta del banco contra la versión pedida (o la vigente si no se
   * pide ninguna) y devuelve la respuesta junto con la versión que la gobernó.
   * `promptVersion` sólo viaja en modo banco: la versión propuesta se usa sin
   * activarla (UJ-49 paso 4).
   */
  const runStream = async ({ question, simulateStudent, promptVersion = null, wrapper, bubble, sourcesEl, preview }) => {
    let fullAnswer = '';
    let governedBy = promptVersion || activeVersionId || null;
    await api.ragQueryStream({
      question,
      classIds: selectedClassIds,
      subjectId: activeSubjectId,
      sandbox: true,
      simulateStudent,
      promptVersion,
    }, (type, data) => {
      if (type === 'metadata') {
        // #408: acá se comparan versiones del prompt sobre la misma evidencia;
        // la declaración dice modelo, temperatura y tope, no sólo el modelo.
        const declaracion = generationLabel(data.generation || (data.model ? { model: data.model } : null));
        if (declaracion) {
          const modelEl = wrapper.querySelector('.model-name-indicator');
          if (modelEl) modelEl.textContent = declaracion;
        }
        if (data.promptVersion) {
          governedBy = data.promptVersion;
          const versionEl = wrapper.querySelector('.prompt-version-indicator');
          if (versionEl) versionEl.textContent = `Prompt: ${data.promptVersion}`;
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
        if (preview) preview.scrollTop = preview.scrollHeight;
      } else if (type === 'done') {
        fullAnswer = data.answer || fullAnswer;
        bubble.innerHTML = renderMarkdown(fullAnswer);
      }
    });
    return { answer: fullAnswer, versionId: governedBy };
  };

  const sendMessage = async () => {
    const input = container.querySelector('#sandbox-input');
    const question = input?.value?.trim();
    if (!question || isLoading || selectedClassIds.length === 0) return;

    const simulateStudent = container.querySelector('#sandbox-simulate-student')?.checked || false;
    const selectedVersion = container.querySelector('#sandbox-version')?.value || '';
    const compare = container.querySelector('#sandbox-compare')?.checked || false;

    input.value = '';
    isLoading = true;
    const sendBtn = container.querySelector('#sandbox-send');
    if (sendBtn) sendBtn.disabled = true;

    const preview = container.querySelector('#sandbox-preview');
    const emptyState = preview?.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    try {
      if (compare && selectedVersion) {
        // UJ-49 pasos 3-7: el MISMO caso contra la vigente y contra la propuesta,
        // enfrentadas lado a lado, con el veredicto que marca quien enseña.
        const bloque = document.createElement('div');
        bloque.className = 'card mb-3';
        bloque.style.border = '1px solid var(--color-border)';
        bloque.innerHTML = `
          <div class="p-3" style="font-weight:600">${escapeHtml(question)}</div>
          <div class="dashboard-layout-grid" style="padding:var(--space-3);gap:var(--space-3)">
            <div><div style="font-size:var(--font-size-xs);font-weight:600;margin-bottom:var(--space-1)">Vigente</div><div data-role="vigente"></div></div>
            <div><div style="font-size:var(--font-size-xs);font-weight:600;margin-bottom:var(--space-1)">Propuesta (${escapeHtml(selectedVersion)})</div><div data-role="propuesta"></div></div>
          </div>`;
        preview.appendChild(bloque);

        const vigenteBubble = renderAnswerBubble(bloque.querySelector('[data-role="vigente"]'));
        const rVigente = await runStream({ question, simulateStudent, promptVersion: null, preview, ...vigenteBubble });
        const propuestaBubble = renderAnswerBubble(bloque.querySelector('[data-role="propuesta"]'));
        const rPropuesta = await runStream({ question, simulateStudent, promptVersion: selectedVersion, preview, ...propuestaBubble });

        comparison.push({
          question,
          timestamp: new Date().toISOString(),
          simulateStudent,
          vigente: { versionId: rVigente.versionId || activeVersionId, answer: rVigente.answer },
          propuesta: { versionId: rPropuesta.versionId || selectedVersion, answer: rPropuesta.answer },
          verdict: null,
        });
        saveComparison(activeSubjectId, comparison);
        renderComparison();
      } else {
        const { wrapper, bubble, sourcesEl } = renderAnswerBubble();
        const resultado = await runStream({ question, simulateStudent, promptVersion: selectedVersion || null, wrapper, bubble, sourcesEl, preview });
        history.push({ question, answer: resultado.answer, timestamp: new Date().toISOString(), promptVersion: resultado.versionId || null });
        saveHistory(activeSubjectId, history);
        renderHistory();
      }
    } catch (err) {
      const message = err?.message?.includes('ENROLLMENT_REQUIRED') || err?.status === 403
        ? 'No estás matriculado en esta materia.'
        : `Error de conexión con el servicio de IA.`;
      const lastBubble = preview?.querySelector('.chat-bubble-assistant:last-of-type');
      if (lastBubble) lastBubble.innerHTML = `⚠️ ${escapeHtml(message)}`;
    } finally {
      isLoading = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  };

  renderHistory();
  renderComparison();

  try {
    const classes = await api.getClasses(activeSubjectId);
    renderChips(classes || []);
  } catch (err) {
    container.querySelector('#sandbox-chips').innerHTML = `<span class="text-muted">No se pudieron cargar las clases.</span>`;
  }

  // UJ-49 paso 2: quién enseña necesita saber QUÉ versiones puede enfrentar y cuál rige.
  try {
    const disponibles = await api.getAvailablePromptVersions('rag-master');
    availableVersions = disponibles?.versions || [];
    activeVersionId = disponibles?.activeVersion || (availableVersions.find(v => v.isActive)?.versionId) || null;
    renderVersions();
  } catch (err) {
    const select = container.querySelector('#sandbox-version');
    if (select) select.innerHTML = `<option value="">No se pudieron cargar las versiones</option>`;
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

  // UJ-49 pasos 6-7: el veredicto (mejora / retroceso / empate) lo marca quien enseña.
  container.querySelector('#sandbox-comparison-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-verdict]');
    if (!btn) return;
    const card = btn.closest('[data-comparison-index]');
    const index = parseInt(card?.dataset.comparisonIndex, 10);
    const entry = comparison[index];
    if (!entry) return;
    entry.verdict = entry.verdict === btn.dataset.verdict ? null : btn.dataset.verdict;
    saveComparison(activeSubjectId, comparison);
    renderComparison();
  });

  container.querySelector('#sandbox-comparison-clear')?.addEventListener('click', () => {
    comparison.length = 0;
    safeSetItem(getComparisonKey(activeSubjectId), JSON.stringify([]));
    renderComparison();
  });

  // UJ-49 pasos 9-10: la comparación queda legible para alguien que no participó.
  container.querySelector('#sandbox-comparison-export')?.addEventListener('click', () => {
    if (comparison.length === 0) return;
    const markdown = comparisonToMarkdown(activeSubjectId, comparison, activeVersionId);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comparacion-comportamiento-${activeSubjectId}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const versionSelect = container.querySelector('#sandbox-version');
  const compareToggle = container.querySelector('#sandbox-compare');
  versionSelect?.addEventListener('change', () => {
    // Sin versión propuesta elegida no hay nada que enfrentar: la vigente es la referencia.
    if (!versionSelect.value && compareToggle) compareToggle.checked = false;
  });
  compareToggle?.addEventListener('change', () => {
    if (!compareToggle.checked || !versionSelect) return;
    if (!versionSelect.value) {
      const primeraPropuesta = availableVersions.find(v => !v.isActive);
      if (primeraPropuesta) versionSelect.value = primeraPropuesta.versionId;
      else compareToggle.checked = false;
    }
  });
}
