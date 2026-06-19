/* ============================================================
   ChatWidget — Full RAG chat UI with streaming effect
   ============================================================ */
import { api } from '../services/api.js';
import { auth } from '../services/auth.js';
import { showPromptDialog } from './Dialog.js';
import { toast } from './Toast.js';
import { renderPrivacyModal } from './PrivacyModal.js';

const FOLLOW_UP_HISTORY_WINDOW_SIZE = 4;
const CLASS_SELECTION_WARN_THRESHOLD = 5;

export function createChatWidget({ classes = [], subjectId = '', sessionId = null, initialMessages = [], highlightMessageId = null, transcriptFocus: initialTranscriptFocus = null, onNewChat, onMessageSent }) {
  const user = auth.getUser();
  const hasEnrollment = auth.isEnrolled(subjectId) !== false;
  let selectedClassIds = [];
  let messages = [...initialMessages];
  let currentSessionId = sessionId || crypto.randomUUID();
  let isLoading = false;
  let transcriptFocus = initialTranscriptFocus;

  const container = document.createElement('div');
  container.className = 'chat-container-card';
  container.style.height = '100%';

  // Consent gate for students: block chat rendering and show modal
  if (auth.getRole() === 'student' && !auth.getAIConsentAccepted()) {
    container.innerHTML = `
      <div class="flex items-center justify-center h-full p-6">
        <div class="text-center max-w-md">
          <div class="mb-4 text-primary">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mx-auto">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h3 class="text-lg font-bold text-text-primary mb-2">Aceptá los términos para usar el chat</h3>
          <p class="text-sm text-text-secondary mb-4">Para poder consultar los materiales de clase, necesitás aceptar los términos de uso y consentimiento de IA.</p>
          <button id="open-consent-modal-btn" class="btn btn-primary">Aceptar términos</button>
        </div>
      </div>
    `;
    container.querySelector('#open-consent-modal-btn')?.addEventListener('click', () => {
      renderPrivacyModal(() => {
        if (auth.getAIConsentAccepted()) {
          location.reload();
        }
      });
    });
    return container;
  }

  const render = () => {
    container.innerHTML = `
      <!-- Class selector -->
      <div class="chat-sources-bar">
        <div class="chat-sources-top">
          <span class="chat-sources-label">Fuentes de consulta:</span>
          <button class="chat-new-btn" id="chat-save" title="Guardar conversación" style="${messages.length === 0 ? 'display:none' : ''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>Guardar</span>
          </button>
          <button class="chat-new-btn" id="chat-saved-list" title="Mis conversaciones guardadas">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            <span>Guardadas</span>
          </button>
          <button class="chat-new-btn" id="chat-clear" title="Nuevo chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>Nuevo chat</span>
          </button>
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
              ${isLoading || selectedClassIds.length === 0 || !hasEnrollment ? 'disabled' : ''}
            ></textarea>
            <button
              class="chat-send-btn ${isLoading || selectedClassIds.length === 0 || !hasEnrollment ? 'disabled' : ''}"
              id="chat-send"
              ${isLoading || selectedClassIds.length === 0 || !hasEnrollment ? 'disabled' : ''}
              title="Enviar mensaje"
            >
              ${isLoading ? '<span class="spinner"></span>' : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
            </button>
          </div>
          ${!hasEnrollment ? '<p class="chat-footer-hint text-error">No estás matriculado en esta materia. Contactá a administración.</p>' : '<p class="chat-footer-hint">La IA puede cometer errores. Verificá la información importante.</p>'}
        </div>
      `;
    bindChatEvents();
    scrollToBottom();
  };

  const renderWelcome = () => `
    <div class="chat-welcome-container">
      <div class="mb-6 text-primary flex justify-center">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h3 class="text-2xl font-extrabold text-text-primary mb-2">¡Hola, ${user.name.split(' ')[0]}!</h3>
      <p class="text-text-secondary text-base font-medium">¿En qué puedo ayudarte hoy?</p>
      
      ${selectedClassIds.length === 0 ? `
        <div class="mt-4 p-3 bg-primary/10 text-primary rounded-xl flex items-center gap-3 border border-primary/20 animate-pulse">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span class="text-sm font-bold">Tenés que seleccionar al menos una clase para empezar.</span>
        </div>
      ` : ''}
    </div>
  `;

  const hasCitations = (content) => /\[\d+\]/.test(content || '');

  const renderFuentesSection = (sources) => {
    if (!sources || sources.length === 0) return '';
    const deduped = deduplicateSources(sources);
    return `
      <div class="fuentes-section" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-color, rgba(128,128,128,0.2));">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted, #888);margin-bottom:6px;">Fuentes</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${deduped.map((s, i) => `
            <button class="fuentes-item citation-ref" data-source-index="${i + 1}" style="display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:3px 6px;border-radius:4px;cursor:pointer;font-size:12px;text-align:left;color:var(--text-primary, inherit);transition:background 0.15s;" title="Ver fragmento">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--color-primary, #0066cc);color:#fff;font-size:10px;font-weight:700;flex-shrink:0;">${i + 1}</span>
              ${materialIcon(s.materialType)}
              <span class="truncate" style="max-width:160px;">${escapeHtml(s.slideTitle || s.sourceFilename)}</span>
              ${s.materialPriority ? `<span class="source-priority source-priority-${escapeHtml(s.materialPriority)}" style="font-size:9px;">${s.materialPriority === 'primary' ? 'Primario' : 'Secundario'}</span>` : ''}
            </button>
          `).join('')}
        </div>
      </div>
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
    const contentHtml = renderMarkdown(msg.content);
    const showFuentes = hasCitations(msg.content) && msg.sources?.length > 0;
    return `
      <div class="chat-msg chat-msg-assistant received animate-fade ${msg.id === highlightMessageId ? 'highlight-msg' : ''}" id="msg-${msg.id || ''}">
        <div class="chat-msg-body flex-1 overflow-hidden">
          <div class="chat-bubble chat-bubble-assistant leading-relaxed">${contentHtml}</div>
          
          ${msg.verified ? `
          <div class="verified-badge" style="display:flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-md);color:var(--color-success);font-size:12px;font-weight:600;">
            ✅ Respuesta verificada por el docente
          </div>
          ` : ''}
          
          ${showFuentes ? renderFuentesSection(msg.sources) : ''}

          <div class="chat-msg-footer mt-3 flex justify-between items-end gap-4">
            ${msg.sources?.length > 0 ? `
              <div class="chat-sources flex flex-wrap gap-2">
                ${deduplicateSources(msg.sources).map(s => `
                  <span class="source-chip bg-surface border border-border px-2 py-1 rounded text-[10px] flex items-center gap-1" title="${s.slideTitle ? `${escapeHtml(s.slideTitle)} (${escapeHtml(s.sourceFilename)})` : escapeHtml(s.sourceFilename)}">
                    ${materialIcon(s.materialType)}
                    <span class="truncate max-w-[120px]">${escapeHtml(s.slideTitle || s.sourceFilename)}</span>
                    ${s.materialPriority ? `<span class="source-priority source-priority-${escapeHtml(s.materialPriority)}">${s.materialPriority === 'primary' ? 'Primario' : 'Secundario'}</span>` : ''}
                  </span>
                `).join('')}
              </div>
            ` : '<span></span>'}

            <div class="chat-feedback-btns flex items-center gap-1" data-message-id="${msg.id || ''}">
              <button class="feedback-btn p-1 rounded hover:bg-surface-3 transition-colors ${msg.feedback === 'positive' ? 'active text-primary' : 'text-text-muted'}" data-type="positive" title="Útil">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.53l-1.6 7A2 2 0 0 1 18.23 21H7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h4l.5-1c.9-1.8 1.8-3 3.5-3 1.1 0 2 1.1 2 2.5 0 1-.3 1.5-1 2.38Z"/></svg>
              </button>
              <button class="feedback-btn p-1 rounded hover:bg-surface-3 transition-colors ${msg.feedback === 'negative' ? 'active text-error' : 'text-text-muted'}" data-type="negative" title="No es útil">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.53l1.6-7A2 2 0 0 1 5.77 3H17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4l-.5 1c-.9 1.8-1.8 3-3.5 3-1.1 0-2-1.1-2-2.5 0-1 .3-1.5 1-2.38Z"/></svg>
              </button>
              <button class="report-issue-btn ${msg.issueReported ? 'active' : ''}" data-message-id="${msg.id || ''}" title="Reportar problema" ${msg.issueReported ? 'disabled' : ''}>
                ${msg.issueReported ? '✅ Reportado' : 'Reportar respuesta incorrecta'}
              </button>
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

    // Feedback buttons
    container.querySelectorAll('.feedback-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.parentElement.dataset.messageId;
        const type = btn.dataset.type;
        if (!messageId || btn.classList.contains('active')) return;

        // Visual update
        btn.parentElement.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        try {
          await api.sendChatFeedback({ messageId, subjectId, isPositive: type === 'positive' });
        } catch (err) {
          console.error('Error sending feedback:', err);
        }
      });
    });

    // Report issue
    bindReportIssueEvents(container);

    // Save conversation
    container.querySelector('#chat-save')?.addEventListener('click', async () => {
      if (messages.length === 0) return;
      const msgCount = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
      try {
        await api.saveConversation({
          conversationId: currentSessionId,
          subjectId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });
        toast('success', 'Conversación guardada', `Se guardaron ${msgCount} mensajes.`);
      } catch (err) {
        toast('error', 'No se pudo guardar', err?.message || 'Intentá nuevamente.');
      }
    });

    // Saved conversations list
    container.querySelector('#chat-saved-list')?.addEventListener('click', async () => {
      const { renderSavedConversationsModal } = await import('./SavedConversationsModal.js');
      renderSavedConversationsModal({
        subjectId,
        onLoad: async (conversation) => {
          messages = conversation.messages.map((m) => {
            const msg = { role: m.role, content: m.content };
            if (m.role === 'assistant') {
              msg.id = 'ai-' + Date.now() + '-' + Math.random().toString(36).slice(2);
              msg.sources = [];
            }
            return msg;
          });
          currentSessionId = conversation.conversationId;
          render();
        },
      });
    });

    // Clear
    container.querySelector('#chat-clear')?.addEventListener('click', () => {
      const previousSessionId = currentSessionId;
      messages = [];
      currentSessionId = crypto.randomUUID();
      render();
      toast('success', 'Nuevo chat iniciado', 'Las consultas anteriores se guardaron en el historial.');
      if (onNewChat) onNewChat({ newSessionId: currentSessionId, previousSessionId });
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
        const source = sources[sourceIndex - 1];
        if (!source) return;

        showCitationModal(source);
      });
    }

    // Send
    const sendBtn = container.querySelector('#chat-send');
    const input = container.querySelector('#chat-input');
    sendBtn?.addEventListener('click', sendMessage);
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  };

  const sendMessage = async () => {
    const input = container.querySelector('#chat-input');
    const question = input?.value?.trim();
    if (!question || isLoading || selectedClassIds.length === 0 || hasEnrollment === false) return;

    const conversationHistory = messages
      .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string' && msg.content.trim().length > 0)
      .map(msg => ({ role: msg.role, content: msg.content.trim() }))
      .slice(-FOLLOW_UP_HISTORY_WINDOW_SIZE);

    input.value = '';
    messages.push({ role: 'user', content: question });
    isLoading = true;
    render();

    // Placeholder para la respuesta de la IA
    const assistantMsg = {
      id: 'ai-' + Date.now(),
      role: 'assistant',
      content: '',
      sources: []
    };
    messages.push(assistantMsg);
    render();

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
      }, (type, data) => {
        const msgEl = getMsgEl();
        if (!msgEl) return;

        if (type === 'metadata') {
          assistantMsg.sources = data.sources || [];
          assistantMsg.verified = data.verified || false;
          const footerEl = msgEl.querySelector('.chat-msg-footer');
          if (footerEl && assistantMsg.sources.length > 0) {
            footerEl.innerHTML = `
              <div class="chat-sources">
                <span class="chat-sources-label">Fuentes:</span>
                ${deduplicateSources(assistantMsg.sources).map(s => `
                  <span class="source-chip" title="${s.slideTitle ? `${escapeHtml(s.slideTitle)} (${escapeHtml(s.sourceFilename)})` : escapeHtml(s.sourceFilename)}">
                    ${materialIcon(s.materialType)}
                    ${escapeHtml(s.slideTitle || s.sourceFilename)}
                    ${s.materialPriority ? `<span class="source-priority source-priority-${escapeHtml(s.materialPriority)}">${s.materialPriority === 'primary' ? 'Primario' : 'Secundario'}</span>` : ''}
                  </span>
                `).join('')}
              </div>
              <div class="chat-feedback-btns" data-message-id="${assistantMsg.id}">
                <button class="feedback-btn" data-type="positive" title="Útil">👍</button>
                <button class="feedback-btn" data-type="negative" title="No es útil">👎</button>
                <button class="report-issue-btn" data-message-id="${assistantMsg.id}" title="Reportar problema">Reportar respuesta incorrecta</button>
              </div>
            `;
            bindFeedbackEvents(footerEl);
            bindReportIssueEvents(footerEl);
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
        } else if (type === 'delta') {
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
          const msgEl = getMsgEl();
          if (msgEl && hasCitations(data.answer) && assistantMsg.sources?.length > 0) {
            const body = msgEl.querySelector('.chat-msg-body');
            const verifiedBadge = body?.querySelector('.verified-badge');
            const fuentesDiv = document.createElement('div');
            fuentesDiv.innerHTML = renderFuentesSection(assistantMsg.sources);
            if (verifiedBadge) {
              verifiedBadge.after(fuentesDiv.firstElementChild);
            } else {
              const bubble = body?.querySelector('.chat-bubble-assistant');
              if (bubble) bubble.after(fuentesDiv.firstElementChild);
            }
          }
        }
      });
    } catch (err) {
      if (err?.message?.includes('ENROLLMENT_REQUIRED') || err?.status === 403) {
        assistantMsg.content = 'No estás matriculado en esta materia. Contactá a administración.';
        assistantMsg.streaming = false;
        render();
        return;
      }
      const category = err?.errorCategory || 'LLM';
      const categoryMessage = category === 'SAFETY'
        ? 'Categoria: SAFETY (contenido bloqueado por seguridad).'
        : `Categoria: ${category}.`;
      assistantMsg.content = `${err.message || 'Error de conexión con el servidor. Por favor intentá nuevamente.'}\n\n${categoryMessage}`;
      assistantMsg.streaming = false;
      render();
    } finally {
      isLoading = false;
      // No re-renderizamos todo al final para evitar parpadeo si ya está actualizado vía DOM
      const sendBtn = container.querySelector('#chat-send');
      if (sendBtn) sendBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
      if (sendBtn) sendBtn.disabled = false;
      const textarea = container.querySelector('#chat-input');
      if (textarea) textarea.disabled = false;
      if (onMessageSent) onMessageSent({ sessionId: currentSessionId });
    }
  };

  const bindFeedbackEvents = (parent) => {
    parent.querySelectorAll('.feedback-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.parentElement.dataset.messageId;
        const type = btn.dataset.type;
        if (!messageId || btn.classList.contains('active')) return;
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
          await Promise.all([
            api.sendChatFeedback({ messageId, subjectId, isPositive: type === 'positive' }),
            api.sendChatRating({ sessionId: currentSessionId, messageId, subjectId, rating: type, comment }),
          ]);
          const msg = messages.find((item) => item.id === messageId);
          if (msg) { msg.feedback = type; msg.rated = true; }
        } catch (err) { console.error('Error sending feedback:', err); }
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
            <span>${materialIcon(source.materialType)} ${escapeHtml(source.materialType)}</span>
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
        const msgIndex = messages.indexOf(msg);
        const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
        const question = userMsg?.role === 'user' ? userMsg.content : '';
        const answer = msg?.content || '';

        const issueDetail = await showReportModal({ title: 'Reportar respuesta incorrecta', question, answer });
        if (!issueDetail) return;

        try {
          await api.reportChatIssue({ messageId, subjectId, issueDetail });
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

  const deduplicateSources = (sources) => {
    if (!Array.isArray(sources)) return [];
    const seen = new Set();
    return sources.filter(s => {
      const key = `${s.sourceFilename}|${s.chunkIndex ?? ''}` || s.materialId || JSON.stringify(s);
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

  const renderMarkdown = (text) => {
    return text
      .replace(/\[(\d+)\]/g, '<sup class="citation-ref" data-source-index="$1" style="color:var(--color-primary,#0066cc);cursor:pointer;font-weight:700;">[$1]</sup>')
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

  render();
  return container;
}
