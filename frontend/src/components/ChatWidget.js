/* ============================================================
   ChatWidget — Full RAG chat UI with streaming effect
   ============================================================ */
import { api } from '../services/api.js';
import { auth } from '../services/auth.js';

const FOLLOW_UP_HISTORY_WINDOW_SIZE = 4;

export function createChatWidget({ classes = [], subjectId = '', initialMessages = [], highlightMessageId = null, transcriptFocus: initialTranscriptFocus = null }) {
  const user = auth.getUser();
  let selectedClassIds = (classes || []).slice(0, 2).map(c => c.id);
  let messages = [...initialMessages];
  let isLoading = false;
  let transcriptFocus = initialTranscriptFocus;

  const container = document.createElement('div');
  container.className = 'chat-container';

  const render = () => {
    container.innerHTML = `
      <!-- Class selector -->
      <div class="chat-filter-bar">
        <div class="chat-filter-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          Contexto RAG — seleccioná las clases fuente:
        </div>
        <div class="chat-chips" id="chat-chips">
          ${(classes || []).map(c => `
            <span class="chip ${selectedClassIds.includes(c.id) ? 'selected' : ''}" data-class-id="${c.id}">
              ${(c.title || '').split('—')[0].trim() || 'Clase'}
            </span>
          `).join('')}
        </div>
        ${selectedClassIds.length > 0 ? `
          <div class="chat-context-info">
            <span class="badge badge-primary">${selectedClassIds.length} clase${selectedClassIds.length !== 1 ? 's' : ''} seleccionada${selectedClassIds.length !== 1 ? 's' : ''}</span>
            ${transcriptFocus ? `<span class="badge badge-info" id="chat-transcript-focus">${icon('target')} ${escapeHtml(transcriptFocus.label || 'Sección de transcripción')}</span>` : ''}
          </div>
        ` : `<div class="chat-context-warn">${icon('alert')} Seleccioná al menos una clase</div>`}
        <button class="btn btn-sm btn-ghost" id="chat-clear" title="Limpiar conversación" style="margin-left:auto; height: 28px; padding: 0 8px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          Limpiar
        </button>
      </div>

      <!-- Messages -->
      <div class="chat-messages" id="chat-messages">
        ${messages.length === 0 ? renderWelcome() : messages.map(renderMessage).join('')}
      </div>

      <!-- Input -->
      <div class="chat-input-area">
        <div class="chat-input-wrapper">
          <textarea
            id="chat-input"
            class="chat-input form-textarea"
            placeholder="Preguntá sobre los materiales de clase... (Ej: ¿Qué es la arquitectura hexagonal?)"
            rows="2"
            ${isLoading ? 'disabled' : ''}
          ></textarea>
          <button
            class="btn btn-primary chat-send-btn"
            id="chat-send"
            ${isLoading || selectedClassIds.length === 0 ? 'disabled' : ''}
            title="Enviar (Enter)"
          >
            ${isLoading ? '<span class="spinner"></span>' : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`}
          </button>
        </div>
        <div class="chat-footer-hint">Respuestas basadas exclusivamente en los materiales de clase indexados · <strong>Modo RAG</strong></div>
      </div>
    `;
    bindChatEvents();
    scrollToBottom();
  };

  const renderWelcome = () => `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">${icon('bot')}</div>
      <h3 class="chat-welcome-title">Hola, ${user.name.split(' ')[0]}!</h3>
      <p class="chat-welcome-sub">Seleccioná las clases arriba y haceme cualquier pregunta sobre los materiales.</p>
      <div class="chat-suggestions">
        ${['¿Qué es la arquitectura hexagonal?', '¿Cuál es la diferencia entre microservicios y monolito?', 'Explicame el patrón SAGA'].map(s => `
          <button class="suggestion-chip" data-suggestion="${s}">${s}</button>
        `).join('')}
      </div>
    </div>
  `;

  const renderMessage = (msg) => {
    if (msg.role === 'user') {
      return `
        <div class="chat-msg chat-msg-user animate-fade">
          <div class="chat-bubble chat-bubble-user">${escapeHtml(msg.content)}</div>
          <div class="avatar" style="width:30px;height:30px;font-size:11px;flex-shrink:0">${user.avatar}</div>
        </div>
      `;
    }
    return `
      <div class="chat-msg chat-msg-assistant animate-fade ${msg.id === highlightMessageId ? 'highlight-msg' : ''}" id="msg-${msg.id || ''}">
        <div class="chat-avatar-bot">${icon('bot')}</div>
        <div class="chat-msg-body">
          <div class="chat-bubble chat-bubble-assistant">${renderMarkdown(msg.content)}</div>
          
          <div class="chat-msg-footer">
            ${msg.sources?.length > 0 ? `
              <div class="chat-sources">
                <span class="chat-sources-label">Fuentes:</span>
                ${msg.sources.map(s => `
                  <span class="source-chip" title="${s.sourceFilename}">
                    ${materialIcon(s.materialType)}
                    ${s.sourceFilename}
                  </span>
                `).join('')}
              </div>
            ` : '<span></span>'}

            <div class="chat-feedback-btns" data-message-id="${msg.id || ''}">
              <button class="feedback-btn ${msg.feedback === 'positive' ? 'active' : ''}" data-type="positive" title="Útil">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.53l-1.6 7A2 2 0 0 1 18.23 21H7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h4l.5-1c.9-1.8 1.8-3 3.5-3 1.1 0 2 1.1 2 2.5 0 1-.3 1.5-1 2.38Z"/></svg>
              </button>
              <button class="feedback-btn ${msg.feedback === 'negative' ? 'active' : ''}" data-type="negative" title="No es útil">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.53l1.6-7A2 2 0 0 1 5.77 3H17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4l-.5 1c-.9 1.8-1.8 3-3.5 3-1.1 0-2-1.1-2-2.5 0-1 .3-1.5 1-2.38Z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  };

  const renderTyping = () => `
    <div class="chat-msg chat-msg-assistant" id="typing-indicator">
      <div class="chat-avatar-bot">${icon('bot')}</div>
      <div class="chat-bubble chat-bubble-assistant">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;

  const bindChatEvents = () => {
    // Class chip toggle
    container.querySelectorAll('.chip[data-class-id]').forEach(chip => {
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

    // Suggestion chips
    container.querySelectorAll('.suggestion-chip').forEach(btn => {
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

    // Clear
    container.querySelector('#chat-clear')?.addEventListener('click', () => {
      if (confirm('¿Estás seguro de que querés limpiar la conversación actual?')) {
        messages = [];
        render();
      }
    });

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
    if (!question || isLoading || selectedClassIds.length === 0) return;

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
        conversationHistory,
        historyWindowSize: FOLLOW_UP_HISTORY_WINDOW_SIZE,
        transcriptFocus,
      }, (type, data) => {
        const msgEl = getMsgEl();
        if (!msgEl) return;

        if (type === 'metadata') {
          assistantMsg.sources = data.sources || [];
          const footerEl = msgEl.querySelector('.chat-msg-footer');
          if (footerEl && assistantMsg.sources.length > 0) {
            footerEl.innerHTML = `
              <div class="chat-sources">
                <span class="chat-sources-label">Fuentes:</span>
                ${assistantMsg.sources.map(s => `
                  <span class="source-chip" title="${s.sourceFilename}">
                    ${materialIcon(s.materialType)}
                    ${s.sourceFilename}
                  </span>
                `).join('')}
              </div>
              <div class="chat-feedback-btns" data-message-id="${assistantMsg.id}">
                <button class="feedback-btn" data-type="positive" title="Útil">👍</button>
                <button class="feedback-btn" data-type="negative" title="No es útil">👎</button>
              </div>
            `;
            bindFeedbackEvents(footerEl);
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
        }
      });
    } catch (err) {
      assistantMsg.content = err.message || 'Error de conexión con el servidor. Por favor intentá nuevamente.';
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
        try {
          await api.sendChatFeedback({ messageId, subjectId, isPositive: type === 'positive' });
        } catch (err) { console.error('Error sending feedback:', err); }
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
    };
    return icon(map[type] || 'document');
  };

  const icon = (name) => {
    const icons = {
      bot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 3v3"/><path d="M8 12h.01"/><path d="M16 12h.01"/></svg>',
      alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
      target: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
      document: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      presentation: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
      notes: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h16v18H4z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
      book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
    };

    return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.document}</span>`;
  };

  const renderMarkdown = (text) => {
    return text
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
