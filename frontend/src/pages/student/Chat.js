/* ============================================================
   Student Chat — RAG interface with class selector
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { createChatWidget } from '../../components/ChatWidget.js';
import { renderHeader } from '../../components/Header.js';

export async function renderStudentChat(container) {
    renderHeader('Chat RAG · IA');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando clases...</div>`;

    const user = auth.getUser();
    const activeSubjectId = auth.getActiveSubjectId();
    const classes = await api.getClasses(activeSubjectId);

    container.innerHTML = '';
    const widget = createChatWidget({ classes, subjectId: activeSubjectId });
    container.appendChild(widget);
}
