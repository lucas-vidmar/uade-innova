import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { toast } from '../../components/Toast.js';
import { createSummaryReviewModal } from '../../components/SummaryReviewModal.js';

export async function renderClassManager() {
    renderHeader('Gestión de Clases');
    const mainEl = document.getElementById('main-content');
    mainEl.innerHTML = `<div class="loading-state">Cargando clases...</div>`;

    const subjectId = auth.getActiveSubjectId();
    if (!subjectId) {
        mainEl.innerHTML = `<div class="empty-state">No hay materia seleccionada.</div>`;
        return;
    }
    try {
        let classes = await api.getClasses(subjectId);

        const saveAllClasses = async (newClassesList) => {
            try {
                mainEl.style.opacity = '0.5';
                await api.saveClasses(subjectId, newClassesList);
                classes = newClassesList;
                toast('success', 'Guardado', 'Cambios guardados correctamente.');
            } catch (e) {
                toast('error', 'Error', 'No se pudieron guardar los cambios.');
            } finally {
                mainEl.style.opacity = '1';
                render();
            }
        };

        const render = () => {
            mainEl.innerHTML = `
                <div class="page-container">
                    <div class="row align-center space-between m-b-4">
                        <h2 style="font-size:1.5rem;font-weight:600;">Clases del Cuatrimestre</h2>
                        <button id="btn-add-class" class="btn btn-primary">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Nueva Clase
                        </button>
                    </div>
                    
                    ${Array.isArray(classes) && classes.length === 0 ? `
                        <div class="empty-state">
                            <span class="empty-icon">📚</span>
                            <h3>No hay clases creadas</h3>
                            <p>Creá tu primera clase para empezar a subir materiales.</p>
                        </div>
                    ` : `
                        <div class="card p-0">
                            <div class="table-responsive">
                                <table class="table align-middle">
                                    <thead>
                                        <tr>
                                            <th>ID Clase</th>
                                            <th>Título</th>
                                            <th>Fecha</th>
                                            <th>Materiales</th>
                                            <th>Resumen IA</th>
                                            <th style="width:100px;text-align:right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${Array.isArray(classes) && classes.map((c, i) => `
                                            <tr>
                                                <td><div class="badge badge-gray">${c.id}</div></td>
                                                <td>
                                                    <input type="text" class="form-input form-input-sm class-title-input" data-idx="${i}" value="${c.title || ''}" />
                                                </td>
                                                <td>
                                                    <input type="date" class="form-input form-input-sm class-date-input" data-idx="${i}" value="${c.date || ''}" />
                                                </td>
                                                <td>
                                                    <div style="font-size:0.875rem; color:var(--color-text-muted)">
                                                        ${c.materials.length} archivo(s)
                                                    </div>
                                                </td>
                                                <td>
                                                    ${c.materials.some(m => m.type === 'transcript' || m.type === 'notes') ? `
                                                        <button class="btn btn-sm ${c.summaryReady ? 'btn-ghost' : 'btn-secondary'} btn-review-summary" data-idx="${i}">
                                                            ${c.summaryReady ? '✅ Ver Resumen' : '✍️ Revisar'}
                                                        </button>
                                                    ` : '<span style="color:var(--color-text-muted); font-size:0.8rem">Sin material</span>'}
                                                </td>
                                                <td style="text-align:right">
                                                    <button class="btn btn-icon btn-ghost btn-delete-class" data-idx="${i}" title="Eliminar Clase">
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `}
                </div>
            `;

            // Agregar clase
            document.getElementById('btn-add-class')?.addEventListener('click', () => {
                const newId = `class-${String(classes.length + 1).padStart(2, '0')}`;
                classes.push({ id: newId, subjectId, title: "Nueva Clase", date: null, topics: [], materials: [] });
                saveAllClasses(classes);
            });

            // Borrar clase
            mainEl.querySelectorAll('.btn-delete-class').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                    if (classes[idx].materials.length > 0) {
                        alert('No podés borrar una clase que tiene materiales asociados. Primero mové o eliminá los materiales de esta clase.');
                        return;
                    }
                    if (confirm(`¿Seguro que querés borrar la clase "${classes[idx].title}"?`)) {
                        classes.splice(idx, 1);
                        saveAllClasses(classes);
                    }
                });
            });
            mainEl.querySelectorAll('.btn-review-summary').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                    createSummaryReviewModal(classes[idx].id, classes[idx].title, async (isValidated) => {
                        // Si se valida, actualizamos el state local y el backend
                        if (isValidated) {
                            classes[idx].summaryReady = true;
                            // Update total config
                            await api.saveClasses(subjectId, classes);
                            render();
                        }
                    });
                });
            });

            // Live edit en título y fecha (Auto-save on blur)
            mainEl.querySelectorAll('.class-title-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.getAttribute('data-idx'));
                    classes[idx].title = e.target.value;
                    saveAllClasses(classes);
                });
            });
            mainEl.querySelectorAll('.class-date-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const idx = parseInt(e.target.getAttribute('data-idx'));
                    classes[idx].date = e.target.value;
                    saveAllClasses(classes);
                });
            });
        };

        render();
    } catch (e) {
        console.error(e);
        mainEl.innerHTML = `<div class="empty-state">Ocurrió un error cargando las clases.</div>`;
    }
}
