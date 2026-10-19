/* ============================================================
   ChatWidget — Full RAG chat UI with streaming effect
   ============================================================ */
import { api } from '../services/api.js';
import { auth, isDevMockEnabled } from '../services/auth.js';
import { showPromptDialog } from './Dialog.js';
import { toast } from './Toast.js';
import { renderPrivacyModal } from './PrivacyModal.js';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const FOLLOW_UP_HISTORY_WINDOW_SIZE = 4;
const CLASS_SELECTION_WARN_THRESHOLD = 5;

const ICON_REPORT_ISSUE = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const ICON_REPORT_MISSING_KEYWORD = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';

const ERROR_MESSAGES = {
  RETRIEVAL_FAILURE: 'No se pudieron recuperar los materiales de referencia. Probá consultando de nuevo en unos minutos.',
  SAFETY: 'No se pudo procesar la consulta. Reformulá la pregunta e intentá de nuevo.',
  PARSING: 'Hay un problema con el formato de los materiales de la clase. El docente ya fue notificado.',
  LLM: 'El asistente no pudo generar una respuesta en este momento. Esperá unos segundos y volvé a intentar.',
  RATE_LIMIT: 'Se alcanzó el límite de consultas. Esperá unos segundos y volvé a intentar.',
  VALIDATION: 'Revisá tu consulta e intentá de nuevo. Faltan datos o el formato no es válido.',
  AUTH: 'No tenés permiso para consultar esta materia. Verificá tu inscripción o contactá a administración.',
  STORAGE: 'No se pudo acceder a los materiales. Probá de nuevo en unos minutos.',
  NOT_FOUND: 'No se encontró el recurso solicitado. Verificá las clases seleccionadas.',
  INTERNAL: 'Ocurrió un error interno. Probá de nuevo en unos minutos.',
  // #378 (UJ-29): el stream cerró sin evento terminal — la respuesta quedó a
  // medias y hay que decirlo con claridad, nunca mostrarla como si estuviera completa.
  STREAM_INTERRUPTED: 'La respuesta se interrumpió antes de completarse. Reintentá la misma pregunta.',
  // #406: el asistente dejó de responder (tope de demora) — la pantalla tiene que
  // decirlo y ofrecer reintentar en vez de quedarse esperando para siempre.
  TIMEOUT: 'El asistente está tardando más de lo esperado. Reintentá la misma pregunta en unos instantes.',
  // #406: la persona canceló la consulta desde la pantalla.
  CANCELLED: 'Cancelaste la consulta. Podés reintentarla cuando quieras.',
  UNKNOWN: 'Ocurrió un error inesperado. Por favor, intentá nuevamente.',
};

/**
 * Resuelve un mensaje accionable a partir de la categoría/código/status
 * del backend o de un error de red. Centraliza el mapping para SSE
 * `event: error` y `catch` de `ragQueryStream` (evita el fallback genérico).
 *
 * #338: el código CONSENT_REQUIRED se chequea ANTES que la categoría —
 * el backend lo etiqueta errorCategory AUTH (y rag.api.js mapea 403→AUTH),
 * así que un chequeo de categoría-primero lo enterraba bajo el copy
 * genérico de "permiso/inscripción" en vez del CTA de términos.
 */
export const CONSENT_MESSAGE = 'Debés aceptar los términos de uso antes de usar el chat.';

export function isConsentError(errOrData) {
  if (!errOrData) return false;
  const code = String(errOrData?.code || errOrData?.error?.code || '').toUpperCase();
  const msg = String(errOrData?.message || errOrData?.error?.message || errOrData?.error || '').toUpperCase();
  return code.includes('CONSENT') || msg.includes('CONSENT');
}

function resolveChatErrorMessage(errOrData) {
  if (!errOrData) return ERROR_MESSAGES.UNKNOWN;
  if (isConsentError(errOrData)) return CONSENT_MESSAGE;
  const rawCategory = errOrData?.errorCategory || errOrData?.category;
  if (rawCategory && ERROR_MESSAGES[rawCategory]) return ERROR_MESSAGES[rawCategory];

  const code = String(errOrData?.code || errOrData?.error || '').toUpperCase();
  const msg = String(errOrData?.message || errOrData?.error || '').toUpperCase();
  const combined = `${code} ${msg}`;

  if (combined.includes('ENROLLMENT')) return ERROR_MESSAGES.AUTH;
  if (combined.includes('VALIDATION') || combined.includes('MISSING_FIELDS') || combined.includes('INVALID_JSON')) return ERROR_MESSAGES.VALIDATION;
  if (combined.includes('FRONTDOOR') || combined.includes('FORBIDDEN')) return ERROR_MESSAGES.AUTH;

  const status = Number(errOrData?.status);
  if (Number.isFinite(status)) {
    if (status === 400) return ERROR_MESSAGES.VALIDATION;
    if (status === 401 || status === 403) return ERROR_MESSAGES.AUTH;
    if (status === 404) return ERROR_MESSAGES.NOT_FOUND;
    if (status === 429) return ERROR_MESSAGES.RATE_LIMIT;
    if (status >= 500) return ERROR_MESSAGES.INTERNAL;
  }

  const rawMsg = String(errOrData?.message || '');
  if (/failed to fetch|networkerror|load failed|aborted/i.test(rawMsg)) {
    return 'No se pudo conectar con el asistente. Verificá tu conexión e intentá de nuevo.';
  }

  return ERROR_MESSAGES.UNKNOWN;
}

export function createChatWidget({ classes = [], subjectId = '', sessionId = null, initialMessages = [], highlightMessageId = null, transcriptFocus: initialTranscriptFocus = null, initialClassIds = [], preset = null, onNewChat, onMessageSent, onConsentAccepted, onOpenSavedConversations }) {
  const user = auth.getUser();
  const rawEnrollment = auth.isEnrolled(subjectId);
  // En dev mock sin enrollments cacheados, permitir chat para desarrollo local;
  // en producción fail-closed === true estricto.
  const hasEnrollment = rawEnrollment === true || (isDevMockEnabled() && rawEnrollment === false && auth.getEnrolledSubjects().length === 0);
  let selectedClassIds = [...initialClassIds];
  let messages = [...initialMessages];
  let currentSessionId = sessionId || crypto.randomUUID();
  let isLoading = false;
  let cooldownUntil = 0;
  let cooldownInterval = null;
  let transcriptFocus = initialTranscriptFocus;
  // #406: una consulta en curso tiene que poder cancelarse y su demora tiene que
  // ser visible. Sin esto, un asistente que no responde deja el compositor
  // deshabilitado para siempre y la única salida es recargar la página.
  const DELAY_NOTICE_MS = (() => {
    const override = Number(window?.__uadeChatStreamTimeouts?.delayNoticeMs);
    return Number.isFinite(override) && override > 0 ? override : 15000;
  })();
  let activeController = null;
  let delayNotice = false;
  let delayNoticeTimer = null;
  let cancelRequested = false;

  const TYPING_PLACEHOLDER_HTML = '<span class="chat-typing-dots"><span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></span>';

  // #378 (UJ-29): una respuesta cortada a mitad no es una respuesta. Se marca el
  // mensaje como interrumpido, se conserva lo que sí llegó (con constancia de que
  // está incompleto) y se ofrece reintentar la misma pregunta sin reescribirla.
  const markInterrupted = (msg, fallbackCopy) => {
    const received = typeof msg.content === 'string' ? msg.content : '';
    const hasPartial = received.length > 0 && received !== TYPING_PLACEHOLDER_HTML;
    msg.streaming = false;
    msg.interrupted = true;
    // #406: una respuesta interrumpida es un fallo, no una respuesta: se reintenta,
    // no se califica.
    msg.isError = true;
    msg.content = hasPartial
      ? `${received}\n\n⚠️ La respuesta se interrumpió antes de completarse.`
      : (fallbackCopy || ERROR_MESSAGES.STREAM_INTERRUPTED);
  };

  const container = document.createElement('div');
  container.className = 'chat-container-card';
  container.style.height = '100%';

  const render = () => {
    const cooldownActive = cooldownUntil > Date.now();
    const cooldownRemaining = cooldownActive ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)) : 0;
    const chatDisabled = isLoading || selectedClassIds.length === 0 || !hasEnrollment || cooldownActive;
    container.innerHTML = `
      <!-- Class selector -->
      <div class="chat-sources-bar">
        <div class="chat-sources-top">
          <span class="chat-sources-label">Fuentes de consulta:</span>

          <div class="chat-sources-actions">
            <!-- #404 (UJ-24, UJ-25): punto de entrada a SUP-05 ("Mis Conversaciones
                 Guardadas"), la superficie que lista, abre y borra los hilos
                 guardados. Antes el modal existía pero no lo alcanzaba nadie. -->
            <button class="chat-new-btn chat-saved-btn" id="chat-saved" title="Mis Conversaciones Guardadas" aria-label="Mis Conversaciones Guardadas">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              <span>Hilos guardados</span>
            </button>

            <button class="chat-new-btn" id="chat-clear" title="Nuevo chat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>Nuevo chat</span>
            </button>
          </div>
        </div>
        <div class="chat-chips-container" id="chat-chips">
          ${(classes || []).map(c => `
            <button class="source-pill ${selectedClassIds.includes(c.id) ? 'active' : ''}" data-class-id="${c.id}">
              ${(c.title || '').split('—')[0].trim() || 'Clase'}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Class selection warning -->
      ${selectedClassIds.length > CLASS_SELECTION_WARN_THRESHOLD ? `
        <div class="selection-warning">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Seleccionaste muchas clases. La respuesta puede ser menos precisa. Deseleccioná algunas para mejorar los resultados.</span>
        </div>
      ` : ''}

      <!-- Empty class selection hint -->
      ${selectedClassIds.length === 0 ? `
        <div class="chat-empty-hint">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Seleccioná al menos una clase de las fuentes de consulta para hacer preguntas.</span>
        </div>
      ` : ''}

      <!-- Messages -->
      <div class="chat-messages-area" id="chat-messages">
        ${messages.length === 0 ? renderWelcome() : messages.map(renderMessage).join('')}
      </div>

      <!-- Input Area -->
        <div class="chat-input-area">
          <div class="chat-input-wrapper">
            <textarea
              id="chat-input"
              class="chat-input"
              placeholder="${!hasEnrollment ? 'No estás matriculado en esta materia.' : (selectedClassIds.length === 0 ? 'Seleccioná al menos una clase para chatear...' : 'Preguntá sobre los materiales de clase...')}"
              rows="1"
              ${chatDisabled ? 'disabled' : ''}
            ></textarea>
            <button
              class="chat-send-btn ${chatDisabled ? 'disabled' : ''} ${cooldownActive ? 'cooldown' : ''}"
              id="chat-send"
              ${chatDisabled ? 'disabled' : ''}
              title="${cooldownActive ? 'Límite de consultas alcanzado' : 'Enviar mensaje'}"
            >
              ${isLoading ? '<span class="spinner"></span>' : (cooldownActive ? `Esperá ${cooldownRemaining}s` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-linecap="round" stroke-linejoin="round"/></svg>`)}
            </button>
          </div>
          ${isLoading ? `
          <div class="chat-stream-status" id="chat-delay-notice" role="status" aria-live="polite">
            <span>${delayNotice ? 'El asistente está tardando más de lo esperado.' : 'El asistente está escribiendo…'}</span>
            <button type="button" class="chat-cancel-btn" id="chat-cancel" title="Cancelar la consulta en curso">Cancelar</button>
          </div>
          ` : ''}
          ${!hasEnrollment ? '<p class="chat-footer-hint text-error">No estás matriculado en esta materia. Contactá a administración.</p>' : '<p class="chat-footer-hint">La IA puede cometer errores, recordá que serás evaluado de acuerdo a la bibliografía que figura en el programa analítico.</p>'}
        </div>
      `;
    bindChatEvents();
    scrollToBottom();
    if (preset) {
      const input = container.querySelector('#chat-input');
      if (input && input.value === '') {
        input.value = preset;
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };

  const renderWelcome = () => `
    <div class="chat-welcome-container">
      <div class="mb-6 text-primary flex justify-center">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h3 class="text-2xl font-extrabold text-text-primary mb-2">¡Hola, ${user.name.split(' ')[0]}!</h3>
      <p class="text-text-secondary text-base font-medium">¿En qué puedo ayudarte hoy?</p>
    </div>
  `;

  const hasCitations = (content) => /\[\d+\]/.test(content || '');

  const isLowConfidence = (content) => {
    if (!content) return false;
    // #358/UJ-22: red de seguridad para conversaciones recargadas (el flag
    // `abstained` del backend sólo viaja en vivo). Se compara sin tildes para
    // no depender de cómo el modelo acentúa ("no encontre" vs "no encontré").
    const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const signals = [
      'no encontre informacion suficiente',
      'no tengo informacion',
      'no encontre',
      'no se encontraron materiales',
      'no hay informacion disponible',
      'no pude encontrar',
      'no esta disponible en los materiales',
    ];
    const n = norm(content);
    return signals.some(s => n.includes(s));
  };

  // #401 (UJ-23/UJ-24): el alcance con el que se preguntó cada tramo tiene que
  // quedar registrado en el hilo, no sólo en la barra de fuentes: al ampliar o
  // acotar el alcance a mitad de conversación las respuestas eran
  // indistinguibles entre sí, y al reabrir el hilo no había forma de saber con
  // qué clase se preguntó cada una.
  const scopeIdsOf = (msg) => (Array.isArray(msg?.classIds) ? msg.classIds.filter(Boolean) : []);

  const scopeLabelFor = (classIds) => {
    const ids = Array.isArray(classIds) ? classIds.filter(Boolean) : [];
    if (ids.length === 0) return '';
    const subjectClassIds = (classes || []).map(c => c.id).filter(Boolean);
    if (subjectClassIds.length > 1 && ids.length === subjectClassIds.length && subjectClassIds.every(id => ids.includes(id))) {
      return 'Toda la materia';
    }
    return ids.map(id => {
      const cls = (classes || []).find(c => c.id === id);
      const title = cls ? String(cls.title || '').split('—')[0].trim() : '';
      return title || id;
    }).join(', ');
  };

  const renderScopeBadge = (msg) => {
    const ids = scopeIdsOf(msg);
    if (ids.length === 0) return '';
    const label = scopeLabelFor(ids);
    return `
      <span class="chat-scope scope-badge" data-scope="${escapeHtml(label)}" data-scope-ids="${escapeHtml(ids.join(','))}" title="Alcance de esta respuesta: ${escapeHtml(label)}">📚 ${escapeHtml(label)}</span>
    `;
  };

  const renderMessage = (msg) => {
    if (msg.role === 'user') {
      return `
        <div class="chat-msg chat-msg-user sent animate-fade">
          <div class="chat-bubble chat-bubble-user">${escapeHtml(msg.content)}</div>
        </div>
      `;
    }
    const isStreaming = msg.streaming === true;
    // #406: un mensaje que es un error —o una respuesta que quedó a medias— no se
    // ofrece para calificar ni para reportar como si fuera una respuesta: no hay
    // nada que juzgar. Lo que sí ofrece es reintentar la misma pregunta.
    const esFallo = msg.isError === true || msg.interrupted === true;
    const contentHtml = renderMarkdown(msg.content);
    const streamingClass = isStreaming ? 'streaming' : '';
    return `
      <div class="chat-msg chat-msg-assistant received animate-fade ${streamingClass} ${msg.id === highlightMessageId ? 'highlight-msg' : ''}" id="msg-${msg.id || ''}">
        <div class="chat-msg-body flex-1 overflow-hidden">
          <div class="chat-bubble chat-bubble-assistant leading-relaxed">${contentHtml}</div>

          ${renderScopeBadge(msg)}
          
          ${msg.verified ? `
          <div class="verified-badge" style="display:flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-md);color:var(--color-success);font-size:12px;font-weight:600;">
            ✅ Respuesta verificada por el docente
          </div>
          ` : ''}

          ${msg.glossary?.found ? `
          <div class="glossary-badge" style="display:flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-md);color:var(--color-primary,#2563eb);font-size:12px;font-weight:600;">
            📖 Glosario
          </div>
          ` : ''}
          
          ${msg.model ? `<div class="model-name-indicator" style="font-size:11px;color:var(--color-text-muted,#9ca3af);margin-top:6px;padding:0 2px;margin-bottom:8px;">Powered by ${msg.model}</div>` : ''}

          <div class="chat-msg-footer mt-3 flex justify-between items-end gap-4">
            ${msg.sources?.length > 0 ? `
              <div class="chat-sources chat-sources-circles">
                ${deduplicateSources(msg.sources).map((s) => `
                  <button class="source-circle-item" data-source-index="${s.sourceIndex}" title="${s.slideTitle ? `${escapeHtml(s.slideTitle)} (${escapeHtml(s.sourceFilename)})` : escapeHtml(s.sourceFilename)}">
                    <span class="source-circle-num">${s.sourceIndex}</span>
                    <span class="truncate">${escapeHtml(s.slideTitle || s.sourceFilename)}</span>
                    ${s.materialPriority ? `<span class="source-priority source-priority-${escapeHtml(s.materialPriority)}">${s.materialPriority === 'primary' ? 'Primario' : 'Secundario'}</span>` : ''}
                  </button>
                `).join('')}
              </div>
            ` : '<span></span>'}

            <div class="chat-msg-actions">
              ${esFallo ? '' : `
              <div class="chat-feedback-btns" data-message-id="${msg.id || ''}">
                <button class="feedback-btn ${msg.feedback === 'positive' ? 'active' : ''}" data-type="positive" title="Útil" ${isStreaming ? 'disabled' : ''}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.53l-1.6 7A2 2 0 0 1 18.23 21H7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h4l.5-1c.9-1.8 1.8-3 3.5-3 1.1 0 2 1.1 2 2.5 0 1-.3 1.5-1 2.38Z"/></svg>
                </button>
                <button class="feedback-btn ${msg.feedback === 'negative' ? 'active' : ''}" data-type="negative" title="No es útil" ${isStreaming ? 'disabled' : ''}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.53l1.6-7A2 2 0 0 1 5.77 3H17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4l-.5 1c-.9 1.8-1.8 3-3.5 3-1.1 0-2-1.1-2-2.5 0-1 .3-1.5 1-2.38Z"/></svg>
                </button>
              </div>
              <button class="report-issue-btn ${msg.issueReported ? 'active' : ''}" data-message-id="${msg.id || ''}" title="Usalo si la respuesta es incorrecta o contradice lo visto en clase" aria-label="Reportar respuesta incorrecta" ${(msg.issueReported || isStreaming) ? 'disabled' : ''}>
                ${msg.issueReported ? '✅ Reportado' : `${ICON_REPORT_ISSUE}<span>Respuesta incorrecta</span>`}
              </button>
              <button class="report-missing-keyword-btn ${msg.missingKeywordReported ? 'active' : ''}" data-message-id="${msg.id || ''}" title="Usalo si esperabas encontrar un tema que no aparece en los materiales" aria-label="Reportar concepto faltante" ${(msg.missingKeywordReported || isStreaming) ? 'disabled' : ''}>
                ${msg.missingKeywordReported ? '✅ Concepto reportado' : `${ICON_REPORT_MISSING_KEYWORD}<span>Falta un concepto</span>`}
              </button>
              `}
              ${!esFallo && (msg.abstained || isLowConfidence(msg.content)) && !msg.missingInfoReported ? `
              <button class="report-missing-info-btn" data-message-id="${msg.id || ''}" title="Reportar información faltante">
                Reportar información faltante
              </button>
              ` : ''}
              ${msg.missingInfoReported ? '<span class="text-xs text-text-muted" style="margin-top:4px;display:block;">✅ Información faltante reportada</span>' : ''}
              ${msg.interrupted || msg.isError ? `
              <button class="chat-retry-btn" data-retry-message-id="${msg.id || ''}" title="Volver a hacer la misma pregunta">
                ↻ Reintentar
              </button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  };

  const renderTyping = () => `
    <div class="chat-msg chat-msg-assistant received italic flex items-center gap-2" id="typing-indicator">
      <div class="typing-dots flex gap-1">
        <span class="w-1 h-1 bg-text-muted rounded-full animate-bounce"></span>
        <span class="w-1 h-1 bg-text-muted rounded-full animate-bounce" style="animation-delay: 0.2s"></span>
        <span class="w-1 h-1 bg-text-muted rounded-full animate-bounce" style="animation-delay: 0.4s"></span>
      </div>
    </div>
  `;

  const bindChatEvents = () => {
    // Class chip toggle
    container.querySelectorAll('[data-class-id]').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.classId;
        if (selectedClassIds.includes(id)) {
          selectedClassIds = selectedClassIds.filter(c => c !== id);
        } else {
          selectedClassIds.push(id);
        }
        render();
      });
    });

    // Suggestion pills
    container.querySelectorAll('.suggestion-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = container.querySelector('#chat-input');
        if (input) { input.value = btn.dataset.suggestion; sendMessage(); }
      });
    });

    // Feedback buttons — single source of truth so a rating always writes BOTH
    // the chat-log feedback and the analytics rating (see bindFeedbackEvents).
    bindFeedbackEvents(container);

    // Report issue
    bindReportIssueEvents(container);

    // Clear
    container.querySelector('#chat-clear')?.addEventListener('click', () => {
      messages = [];
      currentSessionId = crypto.randomUUID();
      render();
      if (onNewChat) onNewChat({ newSessionId: currentSessionId });
    });

    // #404 (UJ-24, UJ-25): abre la superficie SUP-05 ("Mis Conversaciones
    // Guardadas"). El dueño de la página decide cómo montarla y qué hacer al
    // cargar un hilo; el widget sólo expone el punto de entrada.
    container.querySelector('#chat-saved')?.addEventListener('click', () => {
      if (onOpenSavedConversations) onOpenSavedConversations();
    });

    // Citation click (event delegation)
    const msgArea = container.querySelector('#chat-messages');
    if (msgArea) {
      msgArea.addEventListener('click', (e) => {
        const citationEl = e.target.closest('.citation-ref');
        if (!citationEl) return;
        const sourceIndex = parseInt(citationEl.dataset.sourceIndex, 10);
        if (!sourceIndex || Number.isNaN(sourceIndex)) return;

        const msgEl = citationEl.closest('[id^="msg-"]');
        if (!msgEl) return;
        const msgId = msgEl.id.replace('msg-', '');
        const msg = messages.find(m => m.id === msgId);
        if (!msg || !msg.sources || msg.sources.length === 0) return;

        const sources = deduplicateSources(msg.sources);
        const source = sources.find(s => s.sourceIndex === sourceIndex) || msg.sources[sourceIndex - 1];
        if (!source) return;

        showCitationModal(source);
      });
    }

    // Reintentar una respuesta interrumpida (#378): se reenvía la misma pregunta.
    container.querySelectorAll('.chat-retry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isLoading) return;
        const msg = messages.find(m => String(m.id) === String(btn.dataset.retryMessageId));
        const retryQ = (msg?.question || '').trim();
        if (!retryQ) return;
        sendMessage(retryQ);
      });
    });

    // #406: cancelar la consulta en curso. Es la salida inmediata cuando el
    // asistente no responde, sin esperar el tope de demora.
    container.querySelector('#chat-cancel')?.addEventListener('click', () => cancelStream());

    // Send
    const sendBtn = container.querySelector('#chat-send');
    const input = container.querySelector('#chat-input');
    // #378: el handler no debe recibir el evento como pregunta.
    sendBtn?.addEventListener('click', () => sendMessage());
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  };

  // #406: la persona corta la consulta en curso. El stream abortado vuelve por el
  // `catch` de `sendMessage` como cancelación declarada, con reintento disponible.
  const cancelStream = () => {
    if (!activeController) return;
    cancelRequested = true;
    activeController.abort();
  };

  const startCooldown = (retryAfterSec) => {
    const seconds = Math.max(1, Math.floor(Number(retryAfterSec) || 60));
    const nextUntil = Date.now() + seconds * 1000;
    if (nextUntil <= cooldownUntil) return;
    if (cooldownInterval) clearInterval(cooldownInterval);
    cooldownUntil = nextUntil;
    render();

    const update = () => {
      if (Date.now() >= cooldownUntil) {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
        cooldownUntil = 0;
        render();
        return;
      }
      const sendBtn = container.querySelector('#chat-send');
      if (sendBtn) {
        const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        sendBtn.title = 'Límite de consultas alcanzado';
        sendBtn.innerHTML = `Esperá ${remaining}s`;
      }
    };

    cooldownInterval = setInterval(update, 1000);
    update();
  };

  // #338: consent CTA — re-open the terms modal even when the local cache
  // still says accepted (backend wins; the cache syncs on next load).
  const openConsentCTA = () => {
    renderPrivacyModal(() => {
      toast('success', 'Términos aceptados', 'Ya podés usar el chat.');
      if (onConsentAccepted) onConsentAccepted();
    }, { force: true });
  };

    const sendMessage = async (explicitQuestion) => {
    const input = container.querySelector('#chat-input');
    const question = String(explicitQuestion ?? input?.value ?? '').trim();
    if (!question || isLoading || selectedClassIds.length === 0 || hasEnrollment === false) return;

    const botPrefs = auth.getBotPreferences();

    const conversationHistory = messages
      .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim().length > 0)
      .map(msg => ({ role: msg.role, content: msg.content.trim() }))
      .slice(-FOLLOW_UP_HISTORY_WINDOW_SIZE);

    input.value = '';
    // #401: el alcance viaja con el turno, no sólo con la petición — es lo que
    // permite mostrar con qué clase se preguntó cada tramo y que el hilo
    // guardado conserve su alcance al reabrirlo.
    const turnClassIds = [...selectedClassIds];
    messages.push({ role: 'user', content: question, classIds: turnClassIds });
    isLoading = true;
    cancelRequested = false;
    delayNotice = false;
    render();

    // Placeholder para la respuesta de la IA
    const assistantMsg = {
      id: 'ai-' + Date.now(),
      role: 'assistant',
      content: TYPING_PLACEHOLDER_HTML,
      sources: [],
      streaming: true,
      // #378: se guarda la pregunta para poder reintentarla sin reescribirla.
      question,
      classIds: turnClassIds
    };
    messages.push(assistantMsg);
    render();

    // #406: la consulta queda cancelable desde la pantalla y su demora se declara
    // pasado un rato: el compositor deshabilitado deja de ser un callejón sin salida.
    const controller = new AbortController();
    activeController = controller;
    if (delayNoticeTimer) clearTimeout(delayNoticeTimer);
    delayNoticeTimer = setTimeout(() => {
      if (!isLoading || activeController !== controller) return;
      delayNotice = true;
      render();
    }, DELAY_NOTICE_MS);

    const getMsgEl = () => container.querySelector(`#msg-${assistantMsg.id}`);

    try {
      await api.ragQueryStream({
        question,
        classIds: selectedClassIds,
        subjectId,
        sessionId: currentSessionId,
        conversationHistory,
        historyWindowSize: FOLLOW_UP_HISTORY_WINDOW_SIZE,
        transcriptFocus,
        botTone: botPrefs?.tone,
        botLength: botPrefs?.length,
        includeSources: botPrefs?.includeSources,
        // #406: señal propia del turno, para poder cancelar y para cortar la demora.
        signal: controller.signal,
      }, (type, data) => {
        const msgEl = getMsgEl();
        if (!msgEl) return;

        if (type === 'metadata') {
          if (data.interactionId && assistantMsg.id !== data.interactionId) {
            msgEl.id = `msg-${data.interactionId}`;
            assistantMsg.id = data.interactionId;
          }
          assistantMsg.sources = data.sources || [];
          assistantMsg.verified = data.verified || false;
          assistantMsg.model = data.model || '';
          assistantMsg.glossary = data.glossary || null;
          // #358/UJ-22: la abstención la decide el backend; se guarda para que
          // la constancia se muestre por el motivo real y de forma consistente.
          if (typeof data.abstained === 'boolean') assistantMsg.abstained = data.abstained;
          const footerEl = msgEl.querySelector('.chat-msg-footer');
          if (footerEl) {
            footerEl.innerHTML = `
              ${assistantMsg.sources.length > 0 ? `
              <div class="chat-sources chat-sources-circles">
                ${deduplicateSources(assistantMsg.sources).map((s) => `
                  <button class="source-circle-item" data-source-index="${s.sourceIndex}" title="${s.slideTitle ? `${escapeHtml(s.slideTitle)} (${escapeHtml(s.sourceFilename)})` : escapeHtml(s.sourceFilename)}">
                    <span class="source-circle-num">${s.sourceIndex}</span>
                    <span class="truncate">${escapeHtml(s.slideTitle || s.sourceFilename)}</span>
                    ${s.materialPriority ? `<span class="source-priority source-priority-${escapeHtml(s.materialPriority)}">${s.materialPriority === 'primary' ? 'Primario' : 'Secundario'}</span>` : ''}
                  </button>
                `).join('')}
              </div>
              ` : '<span></span>'}
              <div class="chat-msg-actions">
                <div class="chat-feedback-btns" data-message-id="${assistantMsg.id}">
                  <button class="feedback-btn" data-type="positive" title="Útil">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.53l-1.6 7A2 2 0 0 1 18.23 21H7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h4l.5-1c.9-1.8 1.8-3 3.5-3 1.1 0 2 1.1 2 2.5 0 1-.3 1.5-1 2.38Z"/></svg>
                  </button>
                  <button class="feedback-btn" data-type="negative" title="No es útil">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.53l1.6-7A2 2 0 0 1 5.77 3H17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4l-.5 1c-.9 1.8-1.8 3-3.5 3-1.1 0-2-1.1-2-2.5 0-1 .3-1.5 1-2.38Z"/></svg>
                  </button>
                </div>
                <button class="report-issue-btn" data-message-id="${assistantMsg.id}" title="Usalo si la respuesta es incorrecta o contradice lo visto en clase" aria-label="Reportar respuesta incorrecta">${ICON_REPORT_ISSUE}<span>Respuesta incorrecta</span></button>
                <button class="report-missing-keyword-btn" data-message-id="${assistantMsg.id}" title="Usalo si esperabas encontrar un tema que no aparece en los materiales" aria-label="Reportar concepto faltante">${ICON_REPORT_MISSING_KEYWORD}<span>Falta un concepto</span></button>
              </div>
            `;
            bindFeedbackEvents(footerEl);
            bindReportIssueEvents(footerEl);
            // The answer may still be streaming: keep rating/report controls
            // disabled until the message is final (no server id yet). They are
            // re-rendered enabled by the final render() once streaming ends.
            if (assistantMsg.streaming) {
              footerEl.querySelectorAll('button').forEach((b) => { b.disabled = true; });
            }
          }
          if (data.verified) {
            const badgeEl = document.createElement('div');
            badgeEl.className = 'verified-badge';
            badgeEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-md);color:var(--color-success);font-size:12px;font-weight:600;';
            badgeEl.innerHTML = '✅ Respuesta verificada por el docente';
            const bubbleEl = msgEl.querySelector('.chat-bubble-assistant');
            if (bubbleEl) {
              bubbleEl.parentElement.insertBefore(badgeEl, bubbleEl);
            }
          }
          if (data.glossary?.found) {
            const glossaryBadgeEl = document.createElement('div');
            glossaryBadgeEl.className = 'glossary-badge';
            glossaryBadgeEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);border-radius:var(--radius-md);color:var(--color-primary,#2563eb);font-size:12px;font-weight:600;';
            glossaryBadgeEl.innerHTML = '📖 Glosario';
            const bubbleEl = msgEl.querySelector('.chat-bubble-assistant');
            if (bubbleEl && !msgEl.querySelector('.glossary-badge')) {
              bubbleEl.parentElement.insertBefore(glossaryBadgeEl, bubbleEl);
            }
          }
        } else if (type === 'error') {
          const resolved = resolveChatErrorMessage({ ...data, status: data?.status });
          // Preserve raw category for cooldown
          const category = data?.errorCategory || data?.category;
          if (category === 'STREAM_INTERRUPTED' || data?.code === 'STREAM_INTERRUPTED') {
            markInterrupted(assistantMsg, resolved);
          } else {
            assistantMsg.content = resolved;
            assistantMsg.streaming = false;
            // #406: un error no es una respuesta — no se ofrece para calificar y
            // sí para reintentar la misma pregunta.
            assistantMsg.isError = true;
          }
          const bubbleEl = msgEl.querySelector('.chat-bubble-assistant');
          if (bubbleEl) bubbleEl.textContent = assistantMsg.content;
          // #338: consent denial gets the terms CTA, not just copy.
          if (isConsentError(data)) openConsentCTA();
          if (category === 'RATE_LIMIT' && data.retryAfterSec) {
            startCooldown(data.retryAfterSec);
          } else if (resolved === ERROR_MESSAGES.RATE_LIMIT && data?.retryAfterSec) {
            startCooldown(data.retryAfterSec);
          }
        } else if (type === 'delta') {
          if (assistantMsg.content === TYPING_PLACEHOLDER_HTML) {
            assistantMsg.content = '';
          }
          assistantMsg.content += data.content;
          const bubbleEl = msgEl.querySelector('.chat-bubble-assistant');
          if (bubbleEl) {
            bubbleEl.innerHTML = renderMarkdown(assistantMsg.content);
            scrollToBottom();
          }
        }
  else if (type === 'done') {
          assistantMsg.content = data.answer;
          assistantMsg.streaming = false;
          // #358/UJ-22: el backend marca la abstención en el evento final.
          if (typeof data.abstained === 'boolean') assistantMsg.abstained = data.abstained;
          const msgEl = getMsgEl();
          if (msgEl) {
            msgEl.classList.remove('streaming');
            const bubbleEl = msgEl.querySelector('.chat-bubble-assistant');
            if (bubbleEl) {
              bubbleEl.innerHTML = renderMarkdown(assistantMsg.content);
            }
            const body = msgEl.querySelector('.chat-msg-body');
            if (body) {
              if (assistantMsg.model) {
                const existingIndicator = body.querySelector('.model-name-indicator');
                if (!existingIndicator) {
                  const modelIndicator = document.createElement('div');
                  modelIndicator.className = 'model-name-indicator';
                  modelIndicator.style.cssText = 'font-size:11px;color:var(--color-text-muted, #9ca3af);margin-top:6px;padding:0 2px;';
                  modelIndicator.textContent = `Powered by ${assistantMsg.model}`;
                  const bubble = body.querySelector('.chat-bubble-assistant');
                  if (bubble) bubble.after(modelIndicator);
                }
              }
              if (isLowConfidence(assistantMsg.content) && !assistantMsg.missingInfoReported) {
                const actionsArea = body.querySelector('.chat-msg-actions');
                if (actionsArea && !actionsArea.querySelector('.report-missing-info-btn')) {
                  const missingBtn = document.createElement('button');
                  missingBtn.className = 'report-missing-info-btn';
                  missingBtn.dataset.messageId = assistantMsg.id;
                  missingBtn.title = 'Reportar información faltante';
                  missingBtn.textContent = 'Reportar información faltante';
                  actionsArea.appendChild(missingBtn);
                  bindReportIssueEvents(missingBtn.parentElement);
                }
              }
            }
          }
          // Auto-save conversation after each response, then notify parent
          (async () => {
            try {
              await api.saveConversation({
                conversationId: currentSessionId,
                subjectId,
                // #401 (UJ-23): el alcance de cada tramo viaja con el mensaje.
                // Antes se guardaba sólo `{ role, content }`, así que el hilo
                // guardado perdía con qué clase se había preguntado cada parte.
                messages: messages.map((m) => ({
                  role: m.role,
                  content: m.content,
                  ...(Array.isArray(m.classIds) && m.classIds.length > 0 ? { classIds: [...m.classIds] } : {}),
                })),
              });
            } catch (err) {
              console.error('[Chat] Auto-save failed:', err);
            }
            if (onMessageSent) onMessageSent({ sessionId: currentSessionId });
          })();
        }
      });
    } catch (err) {
      // #406: la persona cortó la consulta desde la pantalla. No es un fallo del
      // servicio: se declara el corte y se ofrece reintentar la misma pregunta.
      const cancelado = cancelRequested && (err?.name === 'AbortError' || err?.code === 'ABORT_ERR');
      if (cancelado) {
        assistantMsg.content = ERROR_MESSAGES.CANCELLED;
        assistantMsg.streaming = false;
        assistantMsg.isError = true;
      } else if (err?.message?.includes('ENROLLMENT_REQUIRED') || (err?.code === 'ENROLLMENT_REQUIRED')) {
        // Use unified resolver — covers ENROLLMENT, CONSENT, VALIDATION, AUTH, network, etc.
        // Keep early ENROLLMENT guard for exact legacy string but prefer resolver.
        assistantMsg.content = ERROR_MESSAGES.AUTH;
        assistantMsg.streaming = false;
        assistantMsg.isError = true;
        render();
        if (onMessageSent) onMessageSent({ sessionId: currentSessionId });
        return;
      } else {
        const interrupted = err?.code === 'STREAM_INTERRUPTED' || err?.errorCategory === 'STREAM_INTERRUPTED';
        if (interrupted) {
          // #378: se conserva lo recibido y se marca la respuesta como incompleta.
          markInterrupted(assistantMsg, resolveChatErrorMessage(err));
        } else {
          assistantMsg.content = resolveChatErrorMessage(err);
          assistantMsg.streaming = false;
          // #406: un error no es una respuesta — se reintenta, no se califica.
          assistantMsg.isError = true;
        }
      }
      // #338: consent denial gets the terms CTA, not just copy.
      if (isConsentError(err)) openConsentCTA();
      render();
      const cat = err?.errorCategory || err?.category;
      if ((cat === 'RATE_LIMIT' || assistantMsg.content === ERROR_MESSAGES.RATE_LIMIT) && err?.retryAfterSec) {
        startCooldown(err.retryAfterSec);
      }
      if (onMessageSent) onMessageSent({ sessionId: currentSessionId });
    } finally {
      isLoading = false;
      if (delayNoticeTimer) { clearTimeout(delayNoticeTimer); delayNoticeTimer = null; }
      delayNotice = false;
      cancelRequested = false;
      if (activeController === controller) activeController = null;
      render();
    }
  };

  const bindFeedbackEvents = (parent) => {
    parent.querySelectorAll('.feedback-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.parentElement.dataset.messageId;
        const type = btn.dataset.type;
        if (!messageId || btn.classList.contains('active')) return;
        // Do not rate an answer that is still streaming: it has no server id
        // yet, so the mark would be bound to a non-existent message.
        const streamingMsg = messages.find((item) => item.id === messageId && item.streaming);
        if (streamingMsg) return;
        btn.parentElement.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        let comment = '';
        if (type === 'negative') {
          comment = (await showPromptDialog({
            title: '¿Qué esperabas?',
            label: 'Decinos qué faltó o qué esperabas de la respuesta (opcional)',
            placeholder: 'Ej: esperaba que mencione el patrón Observer...',
            confirmText: 'Enviar',
            cancelText: 'No, gracias',
            required: false,
          })) || '';
        }

        try {
          const classId = Array.isArray(selectedClassIds) && selectedClassIds.length > 0 ? selectedClassIds[0] : '';
          // Write both signals, but tolerate a partial failure: the analytics
          // rating and the chat-log feedback are independent stores, so one
          // 404 must not discard the other (nor revert a persisted rating).
          const [feedbackRes, ratingRes] = await Promise.allSettled([
            api.sendChatFeedback({ messageId, subjectId, isPositive: type === 'positive' }),
            api.sendChatRating({ sessionId: currentSessionId, messageId, subjectId, classId, rating: type, comment }),
          ]);
          const msg = messages.find((item) => item.id === messageId);
          if (ratingRes.status === 'fulfilled' || feedbackRes.status === 'fulfilled') {
            if (msg) { msg.feedback = type; msg.rated = true; }
            if (type === 'positive') toast('success', 'Respuesta calificada', '');
          }
          if (feedbackRes.status === 'rejected' && ratingRes.status === 'rejected') {
            throw feedbackRes.reason || ratingRes.reason || new Error('No se pudo guardar tu valoración.');
          }
        } catch (err) {
          console.error('Error sending feedback:', err);
          // #330: revert the optimistic highlight so the UI doesn't show a
          // rating that the server never persisted, then surface the error.
          btn.classList.remove('active');
          toast('error', 'No se pudo guardar tu valoración', err?.message || 'Intentá de nuevo.');
        }
      });
    });
  };

  const showReportModal = ({ title, question, answer }) => {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-content" style="max-width:560px;width:92%;">
          <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <h3 class="h4" style="margin:0;">${escapeHtml(title)}</h3>
            <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom:16px;">
              <label class="form-label" style="font-weight:600;">Tu pregunta</label>
              <div class="chat-bubble chat-bubble-user" style="margin-top:4px;white-space:pre-wrap;font-size:14px;">${escapeHtml(question)}</div>
            </div>
            <div style="margin-bottom:16px;">
              <label class="form-label" style="font-weight:600;">Respuesta de IA</label>
              <div class="chat-bubble chat-bubble-assistant" style="margin-top:4px;max-height:180px;overflow-y:auto;white-space:pre-wrap;font-size:14px;">${escapeHtml(answer)}</div>
            </div>
            <div>
              <label class="form-label" for="report-detail-input">¿Qué esperabas?</label>
              <textarea id="report-detail-input" class="form-input" style="min-height:80px;resize:vertical;" placeholder="Ej: la respuesta no coincide con el material de la clase"></textarea>
              <p id="report-detail-error" style="display:none;margin-top:6px;color:var(--color-error);font-size:13px;"></p>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost dialog-cancel">Cancelar</button>
            <button type="button" class="btn btn-primary dialog-confirm" id="report-submit-btn" disabled>Enviar reporte</button>
          </div>
        </div>
      `;

      const textarea = overlay.querySelector('#report-detail-input');
      const errorEl = overlay.querySelector('#report-detail-error');
      const submitBtn = overlay.querySelector('#report-submit-btn');

      const cleanup = (result) => { overlay.remove(); resolve(result); };

      textarea.addEventListener('input', () => {
        submitBtn.disabled = (textarea.value || '').trim().length < 10;
        errorEl.style.display = 'none';
      });

      overlay.querySelector('.dialog-close')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.dialog-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(null); });

      submitBtn.addEventListener('click', () => {
        const val = (textarea.value || '').trim();
        if (val.length < 10) {
          errorEl.textContent = 'Debe tener al menos 10 caracteres.';
          errorEl.style.display = 'block';
          textarea.focus();
          return;
        }
        cleanup(val);
      });

      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') cleanup(null);
      });

      document.body.appendChild(overlay);
      setTimeout(() => textarea.focus(), 100);
    });
  };

  const showMissingInfoModal = () => {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-content" style="max-width:560px;width:92%;">
          <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <h3 class="h4" style="margin:0;">Reportar información faltante</h3>
            <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom:16px;">
              <label class="form-label" for="missing-info-detail" style="font-weight:600;">¿Qué información esperabas encontrar?</label>
              <textarea id="missing-info-detail" class="form-input" style="min-height:100px;resize:vertical;" placeholder="Ej: esperaba que la respuesta incluyera el concepto de inmutabilidad en DDD..."></textarea>
              <p id="missing-info-error" style="display:none;margin-top:6px;color:var(--color-error);font-size:13px;"></p>
            </div>
            <div>
              <label class="form-label" for="missing-info-class" style="font-weight:600;">¿En qué clase/material? (opcional)</label>
              <select id="missing-info-class" class="form-input" style="min-height:44px;">
                <option value="">No estoy seguro / Cualquier clase</option>
                ${(classes || []).map(c => `
                  <option value="${c.id}">${escapeHtml(c.title || c.id)}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost dialog-cancel">Cancelar</button>
            <button type="button" class="btn btn-primary dialog-confirm" id="missing-info-submit-btn" disabled>Enviar reporte</button>
          </div>
        </div>
      `;

      const textarea = overlay.querySelector('#missing-info-detail');
      const errorEl = overlay.querySelector('#missing-info-error');
      const submitBtn = overlay.querySelector('#missing-info-submit-btn');
      const classSelect = overlay.querySelector('#missing-info-class');

      const cleanup = (result) => { overlay.remove(); resolve(result); };

      textarea.addEventListener('input', () => {
        submitBtn.disabled = (textarea.value || '').trim().length < 10;
        errorEl.style.display = 'none';
      });

      overlay.querySelector('.dialog-close')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.dialog-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(null); });

      submitBtn.addEventListener('click', () => {
        const val = (textarea.value || '').trim();
        if (val.length < 10) {
          errorEl.textContent = 'Debe tener al menos 10 caracteres.';
          errorEl.style.display = 'block';
          textarea.focus();
          return;
        }
        cleanup({ expectedInfo: val, classId: classSelect.value || '' });
      });

      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') cleanup(null);
      });

      document.body.appendChild(overlay);
      setTimeout(() => textarea.focus(), 100);
    });
  };

  const showMissingKeywordModal = () => {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-content" style="max-width:560px;width:92%;">
          <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <h3 class="h4" style="margin:0;">Reportar concepto faltante</h3>
            <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom:16px;">
              <label class="form-label" for="missing-keyword-input" style="font-weight:600;">¿Qué concepto no encontraste?</label>
              <textarea id="missing-keyword-input" class="form-input" style="min-height:80px;resize:vertical;" placeholder="Ej: patrón Observer, arquitectura hexagonal..."></textarea>
              <p id="missing-keyword-error" style="display:none;margin-top:6px;color:var(--color-error);font-size:13px;"></p>
            </div>
            <div>
              <label class="form-label" for="missing-keyword-class" style="font-weight:600;">¿En qué clase esperabas encontrarlo? (opcional)</label>
              <select id="missing-keyword-class" class="form-input" style="min-height:44px;">
                <option value="">No estoy seguro / Cualquier clase</option>
                ${(classes || []).map(c => `
                  <option value="${c.id}">${escapeHtml(c.title || c.id)}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost dialog-cancel">Cancelar</button>
            <button type="button" class="btn btn-primary dialog-confirm" id="missing-keyword-submit-btn" disabled>Enviar reporte</button>
          </div>
        </div>
      `;

      const textarea = overlay.querySelector('#missing-keyword-input');
      const errorEl = overlay.querySelector('#missing-keyword-error');
      const submitBtn = overlay.querySelector('#missing-keyword-submit-btn');
      const classSelect = overlay.querySelector('#missing-keyword-class');

      const cleanup = (result) => { overlay.remove(); resolve(result); };

      textarea.addEventListener('input', () => {
        submitBtn.disabled = (textarea.value || '').trim().length < 2;
        errorEl.style.display = 'none';
      });

      overlay.querySelector('.dialog-close')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('.dialog-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(null); });

      submitBtn.addEventListener('click', () => {
        const val = (textarea.value || '').trim();
        if (val.length < 2) {
          errorEl.textContent = 'Ingresá el concepto que no encontraste.';
          errorEl.style.display = 'block';
          textarea.focus();
          return;
        }
        cleanup({ keyword: val, classId: classSelect.value || '' });
      });

      textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') cleanup(null);
      });

      document.body.appendChild(overlay);
      setTimeout(() => textarea.focus(), 100);
    });
  };

  const showCitationModal = (source) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:600px;width:92%;">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <h3 class="h4" style="margin:0;display:flex;align-items:center;gap:8px;">
            ${materialIcon(source.materialType)}
            ${escapeHtml(source.slideTitle || source.sourceFilename)}
          </h3>
          <button type="button" class="btn btn-ghost btn-sm dialog-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--text-muted,#888);">
            <span>${materialIcon(source.materialType)} ${escapeHtml(materialTypeLabel(source.materialType))}</span>
            <span>· Chunk ${source.chunkIndex ?? '—'}</span>
            <span>· ${escapeHtml(source.sourceFilename)}</span>
            ${source.score ? `<span>· Relevancia: ${(source.score * 100).toFixed(0)}%</span>` : ''}
          </div>
          ${source.text ? `
            <div style="background:var(--surface-2,#f5f5f5);border:1px solid var(--border-color, rgba(128,128,128,0.15));border-radius:8px;padding:16px;max-height:300px;overflow-y:auto;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(source.text)}</div>
          ` : `
            <p style="color:var(--text-muted,#888);font-style:italic;">Texto del fragmento no disponible</p>
          `}
          <div style="margin-top:16px;">
            <button type="button" class="btn btn-primary citation-download-btn" data-material-id="${escapeHtml(source.materialId || '')}" style="${!source.materialId ? 'opacity:0.5;cursor:not-allowed;' : ''}" ${!source.materialId ? 'disabled' : ''}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline;margin-right:6px;vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Descargar material completo
            </button>
          </div>
        </div>
      </div>
    `;

    const cleanup = () => overlay.remove();

    overlay.querySelector('.dialog-close')?.addEventListener('click', cleanup);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) cleanup(); });
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') cleanup(); });

    const downloadBtn = overlay.querySelector('.citation-download-btn');
    if (downloadBtn && !downloadBtn.disabled) {
      downloadBtn.addEventListener('click', async () => {
        const materialId = downloadBtn.dataset.materialId;
        if (!materialId) return;
        try {
          const { downloadUrl, filename } = await api.getMaterialDownloadUrl(subjectId, materialId);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = filename || 'material';
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.click();
          toast('success', 'Descarga iniciada', filename || '');
        } catch (err) {
          toast('error', 'No se pudo descargar', err?.message || 'Intentá nuevamente.');
        }
      });
    }

    document.body.appendChild(overlay);
  };

  const bindReportIssueEvents = (parent) => {
    parent.querySelectorAll('.report-issue-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.dataset.messageId;
        if (!messageId || btn.disabled) return;

        const msg = messages.find(m => m.id === messageId);
        if (msg?.streaming) return;
        const msgIndex = messages.indexOf(msg);
        const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
        const question = userMsg?.role === 'user' ? userMsg.content : '';
        const answer = msg?.content || '';

        const issueDetail = await showReportModal({ title: 'Reportar respuesta incorrecta', question, answer });
        if (!issueDetail) return;

        try {
          // #429: el reporte viaja con su clase. Si la alumna no tiene una clase
          // seleccionada (hilo viejo), se usa la del material citado en la
          // respuesta; sin eso el caso queda "unknown" para quien corrige.
          const sourceClassId = Array.isArray(msg?.sources) && msg.sources.length > 0
            ? (msg.sources[0].classId || '')
            : '';
          const reportClassId = (Array.isArray(selectedClassIds) && selectedClassIds.length > 0)
            ? selectedClassIds[0]
            : sourceClassId;
          await api.reportChatIssue({ messageId, subjectId, classId: reportClassId, issueDetail, question, answer });
          if (msg) msg.issueReported = true;
          btn.disabled = true;
          btn.classList.add('active');
          btn.textContent = '✅ Reportado';
          toast('success', 'Reporte enviado', 'Tu reporte fue registrado. El docente recibió una alerta.');
        } catch (err) {
          console.error('Error reporting issue:', err);
          toast('error', 'No se pudo reportar', err?.message || 'Intentá nuevamente en unos segundos.');
        }
      });
    });

    parent.querySelectorAll('.report-missing-info-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.dataset.messageId;
        if (!messageId || btn.disabled) return;

        const result = await showMissingInfoModal();
        if (!result) return;

        const msg = messages.find(m => m.id === messageId);
        if (msg?.streaming) return;
        const msgIndex = messages.indexOf(msg);
        const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
        const question = userMsg?.role === 'user' ? userMsg.content : '';

        try {
          await api.reportMissingInfo({
            messageId,
            subjectId,
            classId: result.classId,
            expectedInfo: result.expectedInfo,
            question,
          });
          if (msg) msg.missingInfoReported = true;
          btn.disabled = true;
          btn.textContent = '✅ Reportado';
          toast('success', 'Reporte enviado', 'El docente recibió una alerta sobre la información faltante.');
        } catch (err) {
          console.error('Error reporting missing info:', err);
          toast('error', 'No se pudo reportar', err?.message || 'Intentá nuevamente en unos segundos.');
        }
      });
    });
  parent.querySelectorAll('.report-missing-keyword-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.dataset.messageId;
        if (!messageId || btn.disabled) return;

        const result = await showMissingKeywordModal();
        if (!result) return;

        const msg = messages.find(m => m.id === messageId);
        if (msg?.streaming) return;
        const msgIndex = messages.indexOf(msg);
        const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
        const question = userMsg?.role === 'user' ? userMsg.content : '';
        const answer = msg?.content || '';

        try {
          await api.reportMissingKeyword({
            messageId,
            subjectId,
            classId: result.classId,
            keyword: result.keyword,
            question,
            answer,
          });
          if (msg) msg.missingKeywordReported = true;
          btn.disabled = true;
          btn.classList.add('active');
          btn.textContent = '✅ Concepto reportado';
          toast('success', 'Reporte enviado', 'El docente recibió una alerta sobre el concepto faltante.');
        } catch (err) {
          console.error('Error reporting missing keyword:', err);
          toast('error', 'No se pudo reportar', err?.message || 'Intentá nuevamente en unos segundos.');
        }
      });
    });
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = container.querySelector('#chat-messages');
      if (!el) return;

      if (highlightMessageId) {
        const target = el.querySelector(`#msg-${highlightMessageId}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      el.scrollTop = el.scrollHeight;
    });
  };

  const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // #380 (UJ-27): el tipo de material se muestra traducido, no como jerga interna.
  const MATERIAL_TYPE_LABELS = {
    transcript: 'Registro textual',
    presentation: 'Presentación',
    notes: 'Notas',
    bibliography: 'Bibliografía',
    'verified-answer': 'Respuesta verificada del docente',
  };
  const materialTypeLabel = (type) => MATERIAL_TYPE_LABELS[type] || 'Material';

  const materialIcon = (type) => {
    const map = {
      transcript: 'document',
      presentation: 'presentation',
      notes: 'notes',
      bibliography: 'book',
      'verified-answer': 'verified',
    };
    return icon(map[type] || 'document');
  };

  // #495/UJ-21: el backend numera los fragmentos recuperados 1..N (`<chunk indice="n">` en
  // rag-query.js) y el modelo cita ese número en el texto (`[n]`). La lista que se muestra
  // deduplica por material, así que la posición en la lista visible NO es el número citado:
  // hay que conservar el índice original para que la cita abra el fragmento que el modelo citó.
  const deduplicateSources = (sources) => {
    if (!Array.isArray(sources)) return [];
    const seen = new Set();
    return sources
      .map((s, i) => ({ ...s, sourceIndex: i + 1 }))
      .filter(s => {
        const key = s.materialId || `${s.sourceFilename || ''}|${s.chunkIndex ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const icon = (name) => {
    const icons = {
      bot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 3v3"/><path d="M8 12h.01"/><path d="M16 12h.01"/></svg>',
      alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
      target: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
      document: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      presentation: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
      notes: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h16v18H4z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
       book: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
       verified: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    };

    return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.document}</span>`;
  };

  const katexRender = (tex, displayMode) => {
    try {
      return katex.renderToString(tex, { displayMode, throwOnError: false });
    } catch (_e) {
      return `<span class="latex-raw">${tex}</span>`;
    }
  };

  const KNOWN_LATEX_INLINE = [
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
    'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
    'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon',
    'phi', 'varphi', 'chi', 'psi', 'omega',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
    'partial', 'infty', 'nabla', 'hbar', 'hslash', 'ell', 'imath', 'jmath',
    'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow',
    'leftrightarrow', 'Leftrightarrow', 'uparrow', 'downarrow',
    'approx', 'neq', 'ne', 'geq', 'leq', 'gg', 'll', 'equiv', 'sim', 'simeq', 'cong',
    'times', 'cdot', 'cdots', 'dots', 'ldots', 'forall', 'exists',
    'emptyset', 'varnothing', 'subset', 'supset', 'subseteq', 'supseteq',
    'in', 'notin', 'cup', 'cap', 'setminus', 'oplus', 'otimes', 'odot',
    'sqrt', 'lim', 'log', 'ln', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'to', 'mapsto', 'circ', 'bullet', 'neg', 'lnot', 'land', 'lor',
    'angle', 'triangle', 'aleph', 'Re', 'Im', 'wp',
    'colon', 'mod', 'pmod', 'bmod',
  ];
  const LATEX_INLINE_RE = new RegExp('\\\\(' + KNOWN_LATEX_INLINE.join('|') + ')(?![a-zA-Z])', 'g');

  // Detect if a line is predominantly math (strong LaTeX commands, minimal prose)
  const isDisplayMathLine = (line) => {
    const strongLatex = /\\frac\s*\{/.test(line)
      || /\\[intsumprodlimoiintiiintoint]\s*(?:_\^)?\{/.test(line)
      || /\\(?:displaystyle|dfrac|tfrac|binom|cfrac|overbrace|underbrace|coprod|bigsqcup)/.test(line);
    if (!strongLatex) return false;
    const hasProse = /\b(?:el|la|los|las|un|una|que|es|en|por|para|con|del|como|más|pero|the|and|for|with|from|this|that|are|was|were|been|have|has|had)\b/i.test(line);
    return !hasProse;
  };

  const renderMarkdown = (text) => {
    if (!text) return '';

    // 1. Protect code blocks
    const codeBlocks = [];
    let processed = text
      .replace(/```([\s\S]*?)```/g, (m) => {
        codeBlocks.push(m);
        return `\x00CODEB${codeBlocks.length - 1}\x00`;
      })
      .replace(/`([^`]+)`/g, (m) => {
        codeBlocks.push(m);
        return `\x00CODEB${codeBlocks.length - 1}\x00`;
      });

    // 2. $$...$$ display math (common LLM output)
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => katexRender(tex, true));

    // 3. \[...\] display math
    processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => katexRender(tex, true));

    // 4. $...$ inline math — only if content looks like LaTeX
    processed = processed.replace(/\$(.+?)\$/g, (match, tex) => {
      if (/\\[a-zA-Z@]+/.test(tex) || /[{}^_]/.test(tex)) {
        return katexRender(tex, false);
      }
      return match;
    });

    // 5. \(...\) inline math
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => katexRender(tex, false));

    // 6. Heuristic: undelimited display math (standalone equation lines)
    processed = processed.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('\x00CODEB')) return line;
      if (isDisplayMathLine(trimmed)) return katexRender(trimmed, true);
      return line;
    }).join('\n');

    // 7. Heuristic: undelimited inline math (known LaTeX commands in prose)
    processed = processed.replace(LATEX_INLINE_RE, '\\\($1\\\)');
    processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => katexRender(tex, false));

    // 8. Restore code blocks
    processed = processed.replace(/\x00CODEB(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

    // 9. Markdown processing
    return processed
      .replace(/\[(\d+)\]/g, '<sup class="citation-ref" data-source-index="$1" style="color:var(--color-primary,#0066cc);cursor:pointer;font-weight:700;">[$1]</sup>')
      .replace(/\[([^\]]+)\]\(((?:#|\/|https?:\/\/)[^)\s]+)\)/g, (_, label, href) => {
        const safeHref = href.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeLabel = escapeHtml(label);
        return `<a href="${safeHref}" class="chat-task-link" style="color:var(--color-primary,#0066cc);text-decoration:underline;">${safeLabel}</a>`;
      })
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^#{1,3} (.+)$/gm, '<h4>$1</h4>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/^(?!<[hup])(.+)$/gm, '<p>$1</p>')
      .replace(/<p><\/p>/g, '');
  };

  const consentBlocked = () => auth.getRole() === 'student' && !auth.getAIConsentAccepted();

  const renderConsentGate = () => {
    container.innerHTML = `
      <div class="flex-1 flex items-center justify-center px-6">
        <div class="text-center" style="max-width: 340px;">
          <div class="mb-5 text-primary">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h3 class="text-lg font-bold text-text-primary mb-3">Aceptá los términos para usar el chat</h3>
          <p class="text-sm text-text-secondary mb-6 leading-relaxed">Para poder consultar los materiales de clase, necesitás aceptar los términos de uso y consentimiento de IA.</p>
          <button id="open-consent-modal-btn" class="btn btn-primary">Aceptar términos</button>
        </div>
      </div>
    `;
    container.querySelector('#open-consent-modal-btn')?.addEventListener('click', () => {
      renderPrivacyModal(() => {
        if (document.contains(container) && onConsentAccepted && typeof onConsentAccepted === 'function') {
          onConsentAccepted();
        }
      });
    });
  };

  const renderConsentAware = () => {
    if (consentBlocked()) {
      renderConsentGate();
    } else {
      render();
    }
  };

  window.addEventListener('auth:aiConsentAccepted', () => {
    if (document.contains(container) && !consentBlocked()) renderConsentAware();
  });
  window.addEventListener('auth:aiConsentRevoked', () => {
    if (document.contains(container) && consentBlocked()) renderConsentAware();
  });

  renderConsentAware();
  return container;
}
