import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { toast } from '../../components/Toast.js';
import { createSummaryReviewModal } from '../../components/SummaryReviewModal.js';
import { showConfirmDialog } from '../../components/Dialog.js';

export async function renderClassManager(container) {
    renderHeader('Gestión de Clases');
    container.innerHTML = `<div class="loading-state">Cargando clases...</div>`;

    const subjectId = auth.getActiveSubjectId();
    if (!subjectId) {
        container.innerHTML = `<div class="empty-state">No hay materia seleccionada.</div>`;
        return;
    }
    try {
        let classes = await api.getClasses(subjectId);
        let pendingCellHighlight = null;
        const escapeHtml = (value = '') => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const saveAllClasses = async (newClassesList) => {
            let success = false;
            try {
                container.style.opacity = '0.5';
                await api.saveClasses(subjectId, newClassesList);
                classes = newClassesList;
                success = true;
                toast('success', 'Guardado', 'Cambios guardados correctamente.');
            } catch (e) {
                toast('error', 'Error', 'No se pudieron guardar los cambios.');
            } finally {
                container.style.opacity = '1';
                render();
            }

            return success;
        };

        const render = () => {
            container.innerHTML = `
                <div class="page-container">
                    ${Array.isArray(classes) && classes.length === 0 ? `
                        <div class="empty-state">
                            <span class="empty-icon">📚</span>
                            <h3>No hay clases creadas</h3>
                            <p>Creá tu primera clase para empezar a subir materiales.</p>
                        </div>
                    ` : `
                        <section class="subject-directory-shell">
                            <div class="subject-directory-head">
                                <div>
                                    <h3 class="subject-directory-title">Directorio de Clases</h3>
                                    <p class="subject-directory-meta">${classes.length} clases registradas</p>
                                </div>
                                <div class="subject-directory-tools">
                                    <button id="btn-add-class" class="btn btn-primary subject-directory-new">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                        Nueva Clase
                                    </button>
                                </div>
                            </div>

                            <div class="table-responsive">
                                <table class="table align-middle subject-directory-table class-directory-table">
                                    <thead>
                                        <tr>
                                            <th class="class-col-id">ID Clase</th>
                                            <th class="class-col-title">Título</th>
                                            <th class="class-col-date">Fecha</th>
                                            <th class="class-col-materials">Materiales</th>
                                            <th class="class-col-summary">Resumen IA</th>
                                            <th class="class-col-timeline">Timeline</th>
                                            <th class="class-col-actions" style="text-align:center">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${Array.isArray(classes) && classes.map((c, i) => `
                                            <tr>
                                                <td class="class-col-id"><span class="subject-directory-id">${c.id}</span></td>
                                                <td class="class-col-title">
                                                    <span
                                                        class="inline-cell inline-edit-class"
                                                        data-idx="${i}"
                                                        data-field="title"
                                                        data-current-value="${escapeHtml(c.title || '')}"
                                                        title="Click para editar"
                                                    >${escapeHtml(c.title || 'Sin titulo')}</span>
                                                </td>
                                                <td class="class-col-date">
                                                    <span
                                                        class="inline-cell inline-edit-class"
                                                        data-idx="${i}"
                                                        data-field="date"
                                                        data-current-value="${escapeHtml(c.date || '')}"
                                                        title="Click para editar"
                                                    >${escapeHtml(c.date || 'Sin fecha')}</span>
                                                </td>
                                                <td class="class-col-materials">
                                                    <div style="font-size:0.875rem; color:var(--color-text-muted)">
                                                        ${c.materials.length} archivo(s)
                                                    </div>
                                                </td>
                                                <td class="class-col-summary">
                                                    ${c.materials.some(m => m.type === 'transcript' || m.type === 'notes') ? `
                                                        <button class="btn btn-sm ${c.summaryReady ? 'btn-ghost' : 'btn-secondary'} btn-review-summary" data-idx="${i}">
                                                            ${c.summaryReady ? '✅ Ver Resumen' : '✍️ Revisar'}
                                                        </button>
                                                    ` : '<span style="color:var(--color-text-muted); font-size:0.8rem">Sin material</span>'}
                                                </td>
                                                <td class="class-col-timeline">
                                                    <button class="btn btn-sm btn-ghost btn-edit-timeline" data-idx="${i}">🧭 Editar</button>
                                                </td>
                                                <td class="class-col-actions" style="text-align:center">
                                                    <button class="btn btn-icon btn-ghost btn-delete-class" data-idx="${i}" title="Eliminar Clase">
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>

                            <div class="subject-directory-footer">
                                <span>Mostrando ${classes.length} clase(s)</span>
                            </div>
                        </section>
                    `}
                </div>
            `;

            const applyPendingHighlight = () => {
                if (!pendingCellHighlight) return;
                const target = container.querySelector(`.inline-edit-class[data-idx="${pendingCellHighlight.idx}"][data-field="${pendingCellHighlight.field}"]`);
                if (!target) {
                    pendingCellHighlight = null;
                    return;
                }

                target.classList.add('inline-cell-saved');
                setTimeout(() => target.classList.remove('inline-cell-saved'), 1100);
                pendingCellHighlight = null;
            };

            applyPendingHighlight();

            // Agregar clase
            document.getElementById('btn-add-class')?.addEventListener('click', () => {
                const newId = `class-${String(classes.length + 1).padStart(2, '0')}`;
                classes.push({ id: newId, subjectId, title: "Nueva Clase", date: null, topics: [], materials: [] });
                saveAllClasses(classes);
            });

            // Borrar clase
            container.querySelectorAll('.btn-delete-class').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                    if (classes[idx].materials.length > 0) {
                        toast('warning', 'No se puede eliminar', 'No podes borrar una clase con materiales asociados.');
                        return;
                    }
                    const shouldDelete = await showConfirmDialog({
                        title: 'Eliminar clase',
                        message: `Seguro que queres borrar la clase "${classes[idx].title}"?`,
                        confirmText: 'Eliminar',
                        cancelText: 'Cancelar',
                        danger: true,
                    });
                    if (shouldDelete) {
                        classes.splice(idx, 1);
                        saveAllClasses(classes);
                    }
                });
            });
            container.querySelectorAll('.btn-review-summary').forEach(btn => {
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

            container.querySelectorAll('.btn-edit-timeline').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                    const classItem = classes[idx];
                    const timeline = await api.getClassTimeline(classItem.id);
                    const markers = Array.isArray(timeline.markers) ? [...timeline.markers] : [];
                    const sections = Array.isArray(timeline.sections) ? [...timeline.sections] : [];

                    const hasMarkers = markers.length > 0;
                    if (hasMarkers) {
                        const shouldRemove = await showConfirmDialog({
                            title: 'Editar timeline',
                            message: 'Esta accion elimina el ultimo hit-point actual y crea uno nuevo con valores manuales. Queres continuar?',
                            confirmText: 'Continuar',
                            cancelText: 'Cancelar',
                        });
                        if (!shouldRemove) return;
                        markers.pop();
                    }

                    const modal = document.createElement('div');
                    modal.className = 'modal-overlay';
                    const firstSection = sections[0] || null;
                    modal.innerHTML = `
                        <div class="modal-content" style="max-width:560px; width:92%;">
                            <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                                <h3 class="h4" style="margin:0;">Configurar hit-point</h3>
                                <button type="button" class="btn btn-ghost btn-sm btn-close-modal">✕</button>
                            </div>
                            <div class="modal-body">
                                <div class="form-group">
                                    <label class="form-label">Etiqueta</label>
                                    <input type="text" class="form-input" id="timeline-label" value="${escapeHtml(firstSection?.text?.slice(0, 40) || 'Nuevo punto')}" />
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Segundo de inicio</label>
                                    <input type="number" class="form-input" id="timeline-second" min="0" step="1" value="${String(firstSection?.startSecond || 0)}" />
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Tipo de icono</label>
                                    <select class="form-input" id="timeline-icon">
                                        <option value="question">Pregunta (❓)</option>
                                        <option value="assignment">Actividad (📌)</option>
                                    </select>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-ghost btn-cancel-modal">Cancelar</button>
                                <button type="button" class="btn btn-primary btn-save-modal">Guardar timeline</button>
                            </div>
                        </div>
                    `;

                    const closeModal = () => modal.remove();
                    modal.querySelector('.btn-close-modal')?.addEventListener('click', closeModal);
                    modal.querySelector('.btn-cancel-modal')?.addEventListener('click', closeModal);

                    modal.querySelector('.btn-save-modal')?.addEventListener('click', async () => {
                        const label = String(modal.querySelector('#timeline-label')?.value || '').trim();
                        const secondRaw = String(modal.querySelector('#timeline-second')?.value || '').trim();
                        const iconType = String(modal.querySelector('#timeline-icon')?.value || 'question');
                        const startSecond = Number(secondRaw);

                        if (!label) {
                            toast('warning', 'Dato requerido', 'La etiqueta del hit-point es obligatoria.');
                            return;
                        }
                        if (Number.isNaN(startSecond) || startSecond < 0) {
                            toast('warning', 'Dato invalido', 'El segundo de inicio debe ser un numero valido.');
                            return;
                        }

                        const sectionId = firstSection?.id || `manual-sec-${Date.now()}`;
                        if (!firstSection) {
                            sections.push({
                                id: sectionId,
                                startSecond,
                                endSecond: startSecond + 45,
                                timestampLabel: `Manual ${Math.floor(startSecond)}s`,
                                text: label,
                                sourceFilename: 'manual',
                            });
                        }

                        markers.push({
                            id: `manual-mk-${Date.now()}`,
                            sectionId,
                            startSecond,
                            endSecond: startSecond + 45,
                            iconType,
                            label,
                            source: 'teacher',
                        });

                        await api.saveClassTimeline(classItem.id, {
                            classId: classItem.id,
                            subjectId,
                            sections,
                            markers,
                        });

                        toast('success', 'Timeline guardada', 'Se actualizo el hit-point de la transcripcion.');
                        closeModal();
                    });

                    document.body.appendChild(modal);
                    modal.querySelector('#timeline-label')?.focus();
                    return;
                });
            });

            // Live edit en título y fecha (Auto-save on blur)
            const activateInlineEdit = (cell, kind) => {
                if (!cell || cell.dataset.editing === '1') return;
                cell.dataset.editing = '1';

                const idx = Number(cell.getAttribute('data-idx'));
                const field = cell.getAttribute('data-field');
                const currentValue = cell.getAttribute('data-current-value') || '';
                const inputType = kind === 'date' ? 'date' : 'text';
                cell.innerHTML = `<input type="${inputType}" class="form-input form-input-sm inline-editor" value="${escapeHtml(currentValue)}" />`;

                const input = cell.querySelector('.inline-editor');
                if (!input) return;
                input.focus();
                if (inputType === 'text') input.select();

                const finish = (save) => {
                    cell.dataset.editing = '0';
                    if (!save) {
                        cell.textContent = currentValue || (field === 'date' ? 'Sin fecha' : 'Sin titulo');
                        return;
                    }

                    const nextValue = String(input.value || '').trim();
                    const valueToPersist = field === 'date' ? nextValue : (nextValue || currentValue);

                    if (!Number.isInteger(idx) || idx < 0 || idx >= classes.length) {
                        render();
                        return;
                    }

                    if (valueToPersist === currentValue) {
                        cell.textContent = valueToPersist || (field === 'date' ? 'Sin fecha' : 'Sin titulo');
                        return;
                    }

                    classes[idx][field] = valueToPersist;
                    pendingCellHighlight = { idx, field };
                    saveAllClasses(classes);
                };

                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        finish(true);
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        finish(false);
                    }
                });

                input.addEventListener('blur', () => finish(true));
            };

            container.querySelectorAll('.inline-edit-class').forEach((cell) => {
                cell.addEventListener('click', () => {
                    const field = cell.getAttribute('data-field');
                    activateInlineEdit(cell, field === 'date' ? 'date' : 'text');
                });
            });
        };

        render();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="empty-state">Ocurrió un error cargando las clases.</div>`;
    }
}
