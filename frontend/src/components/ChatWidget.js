/* ============================================================
   ChatWidget — Full RAG chat UI with streaming effect
   ============================================================ */
import { api } from '../services/api.js';
import { auth } from '../services/auth.js';

export function createChatWidget({ classes = [], subjectId = '' }) {
  const user = auth.getUser();
  let selectedClassIds = classes.slice(0, 2).map(c => c.id);
  let messages = [];
  let isLoading = false;

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
          ${classes.map(c => `
            <span class="chip ${selectedClassIds.includes(c.id) ? 'selected' : ''}" data-class-id="${c.id}">
              ${c.title.split('—')[0].trim()}
            </span>
          `).join('')}
        </div>
        ${selectedClassIds.length > 0 ? `
          <div class="chat-context-info">
            <span class="badge badge-primary">${selectedClassIds.length} clase${selectedClassIds.length !== 1 ? 's' : ''} seleccionada${selectedClassIds.length !== 1 ? 's' : ''}</span>
          </div>
        ` : `<div class="chat-context-warn">⚠️ Seleccioná al menos una clase</div>`}
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
      <div class="chat-welcome-icon">🤖</div>
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
      <div class="chat-msg chat-msg-assistant animate-fade">
        <div class="chat-avatar-bot">🤖</div>
        <div class="chat-msg-body">
          <div class="chat-bubble chat-bubble-assistant">${renderMarkdown(msg.content)}</div>
          ${msg.sources?.length > 0 ? `
            <div class="chat-sources">
              <span class="chat-sources-label">📎 Fuentes:</span>
              ${msg.sources.map(s => `
                <span class="source-chip" title="${s.sourceFilename}">
                  ${{ transcript: '📝', presentation: '📊', notes: '📓', bibliography: '📚' }[s.materialType] || '📄'}
                  ${s.sourceFilename}
                </span>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  };

  const renderTyping = () => `
    <div class="chat-msg chat-msg-assistant" id="typing-indicator">
      <div class="chat-avatar-bot">🤖</div>
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

    messages.push({ role: 'user', content: question });
    isLoading = true;
    render();

    // Show typing
    const messagesEl = container.querySelector('#chat-messages');
    if (messagesEl) messagesEl.insertAdjacentHTML('beforeend', renderTyping());
    scrollToBottom();

    try {
      const result = await api.ragQuery({ question, classIds: selectedClassIds, subjectId });
      
      // Deduplicate sources by filename
      const uniqueSources = [];
      const seen = new Set();
      for (const s of (result.sources || [])) {
        if (s.sourceFilename && !seen.has(s.sourceFilename)) {
          seen.add(s.sourceFilename);
          uniqueSources.push(s);
        }
      }

      messages.push({ role: 'assistant', content: result.answer, sources: uniqueSources });
    } catch (err) {
      messages.push({ role: 'assistant', content: err.message || 'Error de conexión con el servidor. Por favor intentá nuevamente.', sources: [] });
    } finally {
      isLoading = false;
      render();
    }
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = container.querySelector('#chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
