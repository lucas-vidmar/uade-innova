/* ============================================================
   ChatWidget — Full RAG chat UI with streaming effect
   ============================================================ */
import { api } from '../services/api.js';
import { auth } from '../services/auth.js';
import { showConfirmDialog, showPromptDialog } from './Dialog.js';
import { toast } from './Toast.js';

const FOLLOW_UP_HISTORY_WINDOW_SIZE = 4;

export function createChatWidget({ classes = [], subjectId = '', initialMessages = [], highlightMessageId = null, transcriptFocus: initialTranscriptFocus = null }) {
  const user = auth.getUser();
  let selectedClassIds = (classes || []).slice(0, 2).map(c => c.id);
  let messages = [...initialMessages];
  let isLoading = false;
  let transcriptFocus = initialTranscriptFocus;

  const container = document.createElement('div');
  container.className = 'chat-container-card'; // Use the new design system class
  container.style.height = '100%';

  const render = () => {
    container.innerHTML = `
      <!-- Class selector -->
      <div class="chat-sources-bar">
        <span class="text-[10px] font-bold text-text-muted uppercase tracking-wider">Fuentes de consulta:</span>
        <div class="flex flex-wrap gap-2" id="chat-chips">
          ${(classes || []).map(c => `
            <button class="source-pill ${selectedClassIds.includes(c.id) ? 'active' : ''}" data-class-id="${c.id}">
              ${(c.title || '').split('—')[0].trim() || 'Clase'}
            </button>
          `).join('')}
        </div>
        <button class="ml-auto text-primary hover:bg-surface p-1 rounded-md transition-colors" id="chat-clear" title="Limpiar conversación">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </button>
      </div>

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
            placeholder="Preguntá sobre los materiales de clase..."
            rows="1"
            ${isLoading ? 'disabled' : ''}
          ></textarea>
          <button
            class="chat-send-btn ${isLoading || selectedClassIds.length === 0 ? 'disabled' : ''}"
            id="chat-send"
            ${isLoading || selectedClassIds.length === 0 ? 'disabled' : ''}
            title="Enviar mensaje"
          >
            ${isLoading ? '<span class="spinner"></span>' : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-linecap="round" stroke-linejoin="round"/></svg>`}
          </button>
        </div>
        <p class="chat-footer-hint">La IA puede cometer errores. Verificá la información importante.</p>
      </div>
    `;
    bindChatEvents();
    scrollToBottom();
  };

  const renderWelcome = () => `
    <div class="chat-welcome-container">
      <div class="mb-6 text-primary flex justify-center">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8V4m0 4 4-4m-4 4L8 4m4 12v4m0-4 4 4m-4-4-4 4M4 12h4m-4 0 4 4m-4-4 4-4m12 0h-4m4 0-4 4m4-4-4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h3 class="text-2xl font-extrabold text-text-primary mb-2">¡Hola, ${user.name.split(' ')[0]}!</h3>
      <p class="text-text-secondary text-sm">Soy tu asistente de ${auth.getActiveSubjectId() || 'estudio'}. ¿En qué puedo ayudarte hoy con la cursada de 2026?</p>
      
      <div class="chat-suggestions">
        ${['¿Qué es la arquitectura hexagonal?', '¿Cuál es la diferencia entre microservicios y monolito?', 'Explicame el patrón SAGA'].map(s => `
          <button class="suggestion-pill" data-suggestion="${s}">${s}</button>
        `).join('')}
      </div>
    </div>
  `;

  const renderMessage = (msg) => {
    if (msg.role === 'user') {
      return `
        <div class="chat-msg chat-msg-user sent animate-fade">
          <div class="chat-bubble chat-bubble-user">${escapeHtml(msg.content)}</div>
        </div>
      `;
    }
    return `
      <div class="chat-msg chat-msg-assistant received animate-fade ${msg.id === highlightMessageId ? 'highlight-msg' : ''}" id="msg-${msg.id || ''}">
        <div class="chat-msg-body flex-1 overflow-hidden">
          <div class="chat-bubble chat-bubble-assistant leading-relaxed">${renderMarkdown(msg.content)}</div>
          
          <div class="chat-msg-footer mt-3 flex justify-between items-end gap-4">
            ${msg.sources?.length > 0 ? `
              <div class="chat-sources flex flex-wrap gap-2">
                ${msg.sources.map(s => `
                  <span class="source-chip bg-surface border border-border px-2 py-1 rounded text-[10px] flex items-center gap-1" title="${s.sourceFilename}">
                    ${materialIcon(s.materialType)}
                    <span class="truncate max-w-[120px]">${s.sourceFilename}</span>
                    <span class="source-priority source-priority-${s.materialPriority === 'secondary' ? 'secondary' : 'primary'}">${materialPriorityLabel(s.materialPriority)}</span>
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
                ${msg.issueReported ? '✅ Reportado' : '⚠️ Report Issue'}
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
    container.querySelectorAll('.report-issue-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.dataset.messageId;
        if (!messageId || btn.disabled) return;

        const issueDetail = await showPromptDialog({
          title: 'Reportar problema en respuesta IA',
          label: '¿Qué estuvo mal o qué faltó?',
          placeholder: 'Ej: la respuesta confunde microservicios con SOA...',
          confirmText: 'Reportar',
          cancelText: 'Cancelar',
          required: false,
        });
        if (issueDetail === null) return;

        try {
          await api.reportChatIssue({ messageId, subjectId, issueDetail });
          const msg = messages.find((item) => item.id === messageId);
          if (msg) msg.issueReported = true;
          btn.disabled = true;
          btn.classList.add('active');
          btn.textContent = '✅ Reportado';
          toast('success', 'Reporte enviado', 'Tu reporte fue enviado y el docente recibió una alerta.');
        } catch (err) {
          console.error('Error reporting issue:', err);
          toast('error', 'No se pudo reportar', err?.message || 'Intentá nuevamente en unos segundos.');
        }
      });
    });

    // Clear
    container.querySelector('#chat-clear')?.addEventListener('click', async () => {
      const shouldClear = await showConfirmDialog({
        title: 'Limpiar conversacion',
        message: 'Seguro que queres limpiar la conversacion actual?',
        confirmText: 'Limpiar',
        cancelText: 'Cancelar',
      });
      if (shouldClear) {
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
                    <span class="source-priority source-priority-${s.materialPriority === 'secondary' ? 'secondary' : 'primary'}">${materialPriorityLabel(s.materialPriority)}</span>
                  </span>
                `).join('')}
              </div>
              <div class="chat-feedback-btns" data-message-id="${assistantMsg.id}">
                <button class="feedback-btn" data-type="positive" title="Útil">👍</button>
                <button class="feedback-btn" data-type="negative" title="No es útil">👎</button>
                <button class="report-issue-btn" data-message-id="${assistantMsg.id}" title="Reportar problema">⚠️ Report Issue</button>
              </div>
            `;
            bindFeedbackEvents(footerEl);
            bindReportIssueEvents(footerEl);
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

  const bindReportIssueEvents = (parent) => {
    parent.querySelectorAll('.report-issue-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = btn.dataset.messageId;
        if (!messageId || btn.disabled) return;

        const issueDetail = await showPromptDialog({
          title: 'Reportar problema en respuesta IA',
          label: '¿Qué estuvo mal o qué faltó?',
          placeholder: 'Ej: la respuesta no coincide con el material de la clase',
          confirmText: 'Reportar',
          cancelText: 'Cancelar',
          required: false,
        });
        if (issueDetail === null) return;

        try {
          await api.reportChatIssue({ messageId, subjectId, issueDetail });
          const msg = messages.find((item) => item.id === messageId);
          if (msg) msg.issueReported = true;
          btn.disabled = true;
          btn.classList.add('active');
          btn.textContent = '✅ Reportado';
          toast('success', 'Reporte enviado', 'Tu reporte fue enviado y el docente recibió una alerta.');
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
    };
    return icon(map[type] || 'document');
  };

  const materialPriorityLabel = (priority) => {
    return priority === 'secondary' ? 'Secundario' : 'Primario';
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
