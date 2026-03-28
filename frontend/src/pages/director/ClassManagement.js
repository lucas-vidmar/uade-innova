import { renderHeader } from '../../components/Header.js';
import { renderClassManager } from '../teacher/ClassManager.js';

export async function renderClassManagement(container) {
    try {
        renderHeader('Gestion de Clases');
        await renderClassManager(container);
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="empty-state">Ocurrio un error cargando el panel de gestion.</div>`;
    }
}
