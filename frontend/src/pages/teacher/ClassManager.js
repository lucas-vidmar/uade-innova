import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { toast } from '../../components/Toast.js';
import { showConfirmDialog } from '../../components/Dialog.js';

export async function renderClassManager(container) {
    renderHeader('Gestión de Clases');
    container.innerHTML = `<div class="loading-state">Cargando clases...</div>`;

    const subjectId = auth.getActiveSubjectId();
    if (!subjectId) {
        const userRole = auth.getRole();
        container.innerHTML = `
            <div class="empty-state card">
                <div class="empty-state-icon">📚</div>
                <h3>No hay materia seleccionada</h3>
                <p>${userRole === 'director' 
                    ? 'Para gestionar clases, primero debés seleccionar una materia desde el selector superior o crear una nueva.' 
                    : 'Seleccioná una materia en el menú superior para ver sus clases.'}</p>
                <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: center;">
                    ${userRole === 'director' ? `
                        <a href="#/director/subjects" class="btn btn-primary">Ir a Gestión de Materias</a>
                    ` : ''}
                    <button class="btn btn-ghost" onclick="document.getElementById('global-course-btn').click()">Seleccionar Materia</button>
                </div>
            </div>
        `;
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
                            <button id="btn-add-class" class="btn btn-primary" style="margin-top:12px;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                Nueva Clase
                            </button>
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
                                            <th class="class-col-topics">Tags</th>
                                            <th class="class-col-summary">Resumen IA</th>
                                            <th class="class-col-podcast">Podcast</th>
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
                                                <td class="class-col-topics">
                                                    <div class="topic-tags-cell" data-idx="${i}">
                                                        ${(c.topics || []).slice(0, 3).map(t => `<span class="badge badge-neutral topic-tag">${escapeHtml(t)}</span>`).join('')}
                                                        ${(c.topics || []).length > 3 ? `<span class="badge badge-info" style="font-size:10px;padding:2px 6px;flex-shrink:0;">+${(c.topics || []).length - 3}</span>` : ''}
                                                        <button class="btn btn-ghost btn-sm btn-edit-topics" data-idx="${i}" title="Editar tags" style="padding:2px 4px;font-size:10px;flex-shrink:0;">✏️</button>
                                                    </div>
                                                </td>
                                                <td class="class-col-summary">
                                                    ${c.materials.some(m => m.type === 'transcript' || m.type === 'notes') ? `
                                                        <button class="btn btn-sm ${c.summaryReady ? 'btn-ghost' : 'btn-secondary'} btn-review-summary" data-idx="${i}">
                                                            ${c.summaryReady ? '✅ Ver Resumen' : '✍️ Revisar'}
                                                        </button>
                                                    ` : '<span style="color:var(--color-text-muted); font-size:0.8rem">Sin material</span>'}
                                                </td>
                                                <td class="class-col-podcast">
                                                    ${c.materials.some(m => m.type === 'transcript' || m.type === 'notes') ? `
                                                        <button class="btn btn-sm ${c.audioScriptReady ? 'btn-ghost' : 'btn-secondary'} btn-review-podcast" data-idx="${i}">
                                                            ${c.audioScriptReady ? '✅ Audio listo' : '🎧 Revisar'}
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
                const overlay = document.createElement('div');
                overlay.className = 'modal-overlay';
                overlay.innerHTML = `
                    <div class="modal-content" style="max-width:480px;width:92%;">
                        <div class="modal-header"><h3 class="h4" style="margin:0;">Agregar clase</h3>
                        <button type="button" class="btn btn-ghost btn-sm dialog-close">✕</button></div>
                        <div class="modal-body" style="display:flex;flex-direction:column;gap:var(--space-4)">
                            <div class="form-group">
                                <label class="form-label">Título <span class="text-error">*</span></label>
                                <input class="form-input" id="new-class-title" placeholder="Ej: Clase 4 - Patrones de Diseño" />
                            </div>
                            <div class="form-group">
                                <label class="form-label">Fecha <span class="text-error">*</span></label>
                                <input type="date" class="form-input" id="new-class-date" value="${new Date().toISOString().split('T')[0]}" />
                            </div>
                            <div class="form-group">
                                <label class="form-label">Temas (uno por línea)</label>
                                <textarea class="form-input" id="new-class-topics" placeholder="Arquitectura hexagonal&#10;DDD&#10;Puertos y adaptadores" style="min-height:80px;"></textarea>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-ghost dialog-cancel">Cancelar</button>
                            <button type="button" class="btn btn-primary" id="new-class-save">Guardar</button>
                        </div>
                    </div>`;
                const cleanup = () => overlay.remove();
                overlay.querySelector('.dialog-close')?.addEventListener('click', cleanup);
                overlay.querySelector('.dialog-cancel')?.addEventListener('click', cleanup);
                overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
                overlay.querySelector('#new-class-save')?.addEventListener('click', () => {
                    const title = overlay.querySelector('#new-class-title').value.trim();
                    const date = overlay.querySelector('#new-class-date').value;
                    const topicsStr = overlay.querySelector('#new-class-topics').value.trim();
                    if (!title || !date) { toast('error', 'Campos requeridos', 'Completá título y fecha.'); return; }
                    const newId = `class-${String(classes.length + 1).padStart(2, '0')}`;
                    const topics = topicsStr ? topicsStr.split('\n').map(t => t.trim()).filter(Boolean) : [];
                    classes.push({ id: newId, subjectId, title, date, topics, materials: [] });
                    saveAllClasses(classes);
                    cleanup();
                });
                document.body.appendChild(overlay);
                setTimeout(() => overlay.querySelector('#new-class-title')?.focus(), 100);
            });

            // Edit topics
            container.querySelectorAll('.btn-edit-topics').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.idx);
                    const c = classes[idx];
                    if (!c) return;
                    const overlay = document.createElement('div');
                    overlay.className = 'modal-overlay';
                    overlay.innerHTML = `
                        <div class="modal-content" style="max-width:480px;width:92%;">
                            <div class="modal-header"><h3 class="h4" style="margin:0;">Administrar tags: ${escapeHtml(c.title)}</h3>
                            <button type="button" class="btn btn-ghost btn-sm dialog-close">✕</button></div>
                            <div class="modal-body">
                                <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:6px" id="tags-list">
                                    ${(c.topics || []).map(t => `<span class="badge badge-primary" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:13px;">${escapeHtml(t)} <button class="tag-remove" data-tag="${escapeHtml(t)}" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);padding:0;font-size:14px;line-height:1;">×</button></span>`).join('')}
                                </div>
                                <div style="display:flex;gap:var(--space-2)">
                                    <input class="form-input" id="new-tag-input" placeholder="Nuevo tag..." style="flex:1;" />
                                    <button class="btn btn-secondary btn-sm" id="add-tag-btn">Agregar</button>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-ghost dialog-close">Cerrar</button>
                                <button type="button" class="btn btn-primary" id="save-tags-btn">Guardar</button>
                            </div>
                        </div>`;
                    const cleanup2 = () => overlay.remove();
                    overlay.querySelectorAll('.dialog-close').forEach(el => el.addEventListener('click', cleanup2));
                    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup2(); });
                    const tagsList = overlay.querySelector('#tags-list');
                    overlay.querySelector('#add-tag-btn')?.addEventListener('click', () => {
                        const input = overlay.querySelector('#new-tag-input');
                        const val = input.value.trim();
                        if (!val) return;
                        const chip = document.createElement('span');
                        chip.className = 'badge badge-primary';
                        chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:13px;';
                        chip.innerHTML = escapeHtml(val) + ' <button class="tag-remove" data-tag="' + escapeHtml(val) + '" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);padding:0;font-size:14px;line-height:1;">×</button>';
                        chip.querySelector('.tag-remove').addEventListener('click', () => chip.remove());
                        tagsList.appendChild(chip);
                        input.value = '';
                        input.focus();
                    });
                    tagsList.addEventListener('click', (e) => {
                        if (e.target.classList.contains('tag-remove')) {
                            e.target.closest('.badge').remove();
                        }
                    });
                    overlay.querySelector('#new-tag-input')?.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('#add-tag-btn')?.click(); }
                    });
                    overlay.querySelector('#save-tags-btn')?.addEventListener('click', () => {
                        const tags = [...tagsList.querySelectorAll('.badge')].map(el => el.textContent.replace('×', '').trim()).filter(Boolean);
                        classes[idx].topics = tags;
                        saveAllClasses(classes);
                        cleanup2();
                    });
                    document.body.appendChild(overlay);
                });
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
            container.querySelectorAll('.btn-review-summary, .btn-review-podcast').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                    window.location.hash = `#/teacher/class/${classes[idx].id}`;
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
