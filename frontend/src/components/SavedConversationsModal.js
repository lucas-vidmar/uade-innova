import { api } from '../services/api.js';
import { toast } from './Toast.js';

export async function renderSavedConversationsModal({ subjectId, onLoad }) {
  const existing = document.getElementById('saved-conversations-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'saved-conversations-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content saved-conversations-modal" style="max-width: 600px; max-height: 80vh; display: flex; flex-direction: column;">
      <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--color-border);">
        <h3 style="margin: 0; font-size: 16px; font-weight: 700;">Mis Conversaciones Guardadas</h3>
        <button class="modal-close-btn" style="background: none; border: none; cursor: pointer; font-size: 18px; color: var(--color-text-muted);">&times;</button>
      </div>
      <div id="saved-conversations-list" style="flex: 1; overflow-y: auto; padding: 12px 20px;">
        <div class="flex items-center justify-center p-8">
          <span class="spinner"></span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.modal-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const listEl = overlay.querySelector('#saved-conversations-list');
  try {
    const conversations = await api.listConversations(subjectId);

    if (!Array.isArray(conversations) || conversations.length === 0) {
      listEl.innerHTML = `
        <div class="flex flex-col items-center justify-center p-8 text-text-muted">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px;">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
          <p style="font-size: 14px; font-weight: 600;">No tenés conversaciones guardadas</p>
          <p style="font-size: 12px; margin-top: 4px;">Usá el botón "Guardar" en el chat para almacenar tus consultas.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = conversations.map((c, i) => `
      <div class="saved-conversation-item" data-index="${i}" style="display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 8px; cursor: pointer; transition: background 0.15s;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 600; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(c.firstQuestion || 'Sin pregunta')}
          </div>
          <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">
            ${c.messageCount} mensaje${c.messageCount !== 1 ? 's' : ''} &middot; ${formatDate(c.lastMessageAt)}
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0;">
          <button class="btn btn-sm saved-load-btn" data-id="${c.conversationId}" style="padding: 4px 10px; font-size: 12px;">Cargar</button>
          <button class="btn btn-sm btn-danger saved-delete-btn" data-id="${c.conversationId}">Eliminar</button>
        </div>
      </div>
    `).join('');

    const items = listEl.querySelectorAll('.saved-conversation-item');

    items.forEach((item) => {
      item.addEventListener('mouseenter', () => {
        item.style.background = 'var(--color-surface-3)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = '';
      });
    });

    listEl.querySelectorAll('.saved-load-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const conversationId = btn.dataset.id;
        btn.textContent = 'Cargando...';
        btn.disabled = true;
        try {
          const conversation = await api.getConversation(conversationId, subjectId);
          if (!conversation) {
            toast('error', 'Error', 'No se pudo cargar la conversación.');
            return;
          }
          if (onLoad) onLoad(conversation);
          close();
        } catch (err) {
          toast('error', 'Error', err?.message || 'No se pudo cargar la conversación.');
        }
      });
    });

    listEl.querySelectorAll('.saved-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const conversationId = btn.dataset.id;
        const item = btn.closest('.saved-conversation-item');
        const title = (item?.querySelector('div')?.innerText || '').trim();
        const ok = confirm(
          `¿Eliminar esta conversación guardada?\n\nSe borra el hilo completo, con todas sus preguntas y respuestas` +
          (title ? `:\n"${title.slice(0, 120)}"` : '.') +
          `\n\nEsta acción no se puede deshacer.`
        );
        if (!ok) return;
        btn.textContent = '...';
        btn.disabled = true;
        try {
          // Borra el hilo entero (turnos + conversación guardada), no sólo la
          // fila de la conversación: si no, el hilo reaparece en el historial.
          await api.deleteChatSession(conversationId, subjectId);
          if (item) item.style.display = 'none';
          toast('success', 'Eliminada', 'La conversación fue eliminada.');
        } catch (err) {
          btn.textContent = 'Eliminar';
          btn.disabled = false;
          toast('error', 'Error', err?.message || 'No se pudo eliminar.');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `
      <div class="flex items-center justify-center p-8 text-error">
        <p>Error al cargar conversaciones. Intentá nuevamente.</p>
      </div>
    `;
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}
