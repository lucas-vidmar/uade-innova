import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { toast } from '../../components/Toast.js';
import { showConfirmDialog } from '../../components/Dialog.js';

const MATERIAL_TYPES = [
    { value: 'transcript', label: 'Transcripción', icon: '🎙️' },
    { value: 'presentation', label: 'Presentación', icon: '📊' },
    { value: 'notes', label: 'Apuntes', icon: '📝' },
    { value: 'bibliography', label: 'Bibliografía', icon: '📚' },
];

function typeLabel(type) {
    return MATERIAL_TYPES.find(t => t.value === type)?.label || type || 'Sin tipo';
}

function typeIcon(type) {
    return MATERIAL_TYPES.find(t => t.value === type)?.icon || '📄';
}

const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export async function renderMaterialManager(container) {
    renderHeader('Gestión de Materiales');
    container.innerHTML = `<div class="loading-state">Cargando materiales...</div>`;

    const subjectId = auth.getActiveSubjectId();
    if (!subjectId) {
        container.innerHTML = `
            <div class="empty-state card">
                <div class="empty-state-icon">📦</div>
                <h3>No hay materia seleccionada</h3>
                <p>Seleccioná una materia en el menú superior para gestionar sus materiales.</p>
                <button class="btn btn-ghost" onclick="document.getElementById('global-course-btn').click()" style="margin-top:12px;">Seleccionar Materia</button>
            </div>
        `;
        return;
    }

    try {
        let classes = await api.getClasses(subjectId);
        let materials = [];

        // Flatten materials from all classes + deduplicate
        const materialMap = new Map();
        for (const cls of classes) {
            if (!Array.isArray(cls.materials)) continue;
            for (const mat of cls.materials) {
                const id = mat.id || mat.materialId;
                if (!id) continue;
                if (materialMap.has(id)) {
                    // merge classIds
                    const existing = materialMap.get(id);
                    const classIds = new Set([...(existing.classIds || []), ...(mat.classIds || []), cls.id]);
                    existing.classIds = [...classIds];
                } else {
                    materialMap.set(id, {
                        ...mat,
                        materialId: id,
                        classIds: [...new Set([...(mat.classIds || []), cls.id])],
                        reviewed: mat.reviewed || false,
                    });
                }
            }
        }
        materials = [...materialMap.values()];

        // Sort by uploadedAt desc
        materials.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

        let activeDropdown = null;

        const render = () => {
            container.innerHTML = `
                <div class="page-container">
                    ${materials.length === 0 ? `
                        <div class="empty-state">
                            <span class="empty-icon">📦</span>
                            <h3>No hay materiales cargados</h3>
                            <p>Subí materiales desde el panel de carga para verlos acá.</p>
                            <a href="#/teacher/upload" class="btn btn-primary" style="margin-top:12px;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5-5 5 5"/><path d="M12 5v12"/></svg>
                                Cargar Materiales
                            </a>
                        </div>
                    ` : `
                        <section class="subject-directory-shell">
                            <div class="subject-directory-head">
                                <div>
                                    <h3 class="subject-directory-title">Gestión de Materiales</h3>
                                    <p class="subject-directory-meta">${materials.length} material(es) cargado(s)</p>
                                </div>
                                <div class="subject-directory-tools">
                                    <a href="#/teacher/upload" class="btn btn-primary subject-directory-new">
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5-5 5 5"/><path d="M12 5v12"/></svg>
                                        Cargar Más
                                    </a>
                                </div>
                            </div>

                            <div class="table-responsive">
                                <table class="table align-middle subject-directory-table material-directory-table">
                                    <thead>
                                        <tr>
                                            <th class="mat-col-name">Archivo</th>
                                            <th class="mat-col-type">Tipo</th>
                                            <th class="mat-col-priority">Prioridad</th>
                                            <th class="mat-col-classes">Clases Asociadas</th>
                                            <th class="mat-col-status">Estado</th>
                                            <th class="mat-col-reviewed">Revisado</th>
                                            <th class="mat-col-actions" style="text-align:center">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${materials.map((mat, i) => `
                                            <tr>
                                                <td class="mat-col-name">
                                                    <div class="mat-filename-wrap">
                                                        <span class="mat-filename-icon">${typeIcon(mat.type)}</span>
                                                        <span class="mat-filename-text subject-directory-name" data-idx="${i}" data-field="filename" title="Click para editar nombre">${escapeHtml(mat.filename || 'Sin nombre')}</span>
                                                    </div>
                                                </td>
                                                <td class="mat-col-type">
                                                    <span
                                                        class="inline-cell mat-inline-type"
                                                        data-idx="${i}"
                                                        data-field="type"
                                                        data-current-value="${escapeHtml(mat.type || '')}"
                                                        title="Click para cambiar tipo"
                                                    >
                                                        <span class="mat-type-pill mat-type-${escapeHtml(mat.type || 'unknown')}">${escapeHtml(typeLabel(mat.type))}</span>
                                                    </span>
                                                </td>
                                                <td class="mat-col-priority">
                                                    <button 
                                                        class="mat-priority-toggle mat-priority-${mat.priority || (mat.type === 'bibliography' ? 'secondary' : 'primary')}" 
                                                        data-idx="${i}"
                                                        title="Click para cambiar prioridad (Primaria: mayor peso en RAG)"
                                                    >
                                                        ${(mat.priority || (mat.type === 'bibliography' ? 'secondary' : 'primary')) === 'primary' ? 'Primaria' : 'Secundaria'}
                                                    </button>
                                                </td>
                                                <td class="mat-col-classes">
                                                    <div class="mat-class-pills-wrap" data-idx="${i}">
                                                        ${(mat.classIds || []).map(cid => {
                                                            const cls = classes.find(c => c.id === cid);
                                                            const label = cls ? (cls.title || cid) : cid;
                                                            return `<span class="mat-class-pill" data-class-id="${escapeHtml(cid)}" title="${escapeHtml(label)}">
                                                                ${escapeHtml(label.length > 28 ? label.slice(0, 26) + '…' : label)}
                                                                <button class="mat-class-pill-remove" data-idx="${i}" data-class-id="${escapeHtml(cid)}" title="Quitar clase">×</button>
                                                            </span>`;
                                                        }).join('')}
                                                        <button class="mat-class-add-btn" data-idx="${i}" title="Agregar clase">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                                        </button>
                                                    </div>
                                                </td>
                                                <td class="mat-col-status">
                                                    ${(() => {
                                                        const s = mat.status;
                                                        const err = (mat.errorMessage || '').toLowerCase();
                                                        if (s === 'ready') return `<span class="mat-status-badge mat-status-ready">Listo</span>`;
                                                        if (s === 'processing') return `<span class="mat-status-badge mat-status-processing">Procesando</span><div class="mat-error-hint">Procesando en segundo plano...</div>`;
                                                        if (s === 'error' && err.includes('429')) return `<span class="mat-status-badge mat-status-error">En cola</span><div class="mat-error-hint">Límite de API excedido. Se procesará automáticamente.</div>`;
                                                        if (s === 'error' && (err.includes('demasiado grande') || err.includes('too large'))) return `<span class="mat-status-badge mat-status-error">Archivo muy grande</span><div class="mat-error-hint">El archivo supera el límite de 500.000 tokens. Dividilo en partes.</div>`;
                                                        if (s === 'error') return `<span class="mat-status-badge mat-status-error">Error</span>${mat.errorMessage ? `<div class="mat-error-message">${escapeHtml(mat.errorMessage)}</div>` : ''}`;
                                                        return `<span class="mat-status-badge mat-status-pending">Pendiente</span>`;
                                                    })()}
                                                </td>
                                                <td class="mat-col-reviewed">
                                                    <button class="mat-reviewed-toggle ${mat.reviewed ? 'mat-reviewed-yes' : 'mat-reviewed-no'}" data-idx="${i}" title="${mat.reviewed ? 'Marcado como revisado' : 'Click para marcar como revisado'}">
                                                        ${mat.reviewed ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>` : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`}
                                                    </button>
                                                </td>
                                                <td class="mat-col-actions" style="text-align:center">
                                                    <div class="mat-actions-row">
                                                        <button class="btn btn-icon btn-ghost mat-btn-view-text" data-idx="${i}" title="Ver / editar texto extraído">
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                                                        </button>
                                                        ${(() => {
                                                            const err = (mat.errorMessage || '').toLowerCase();
                                                            const canRetry = mat.status === 'error' && !err.includes('429') && !err.includes('demasiado grande') && !err.includes('too large');
                                                            return canRetry ? `
                                                        <button class="btn btn-sm btn-outline mat-btn-reprocess" data-idx="${i}" title="Reintentar procesamiento">
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                                                            Reintentar
                                                        </button>` : '';
                                                        })()}
                                                        <button class="btn btn-icon btn-ghost mat-btn-delete" data-idx="${i}" title="Eliminar material">
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>

                            <div class="subject-directory-footer">
                                <span>Mostrando ${materials.length} material(es)</span>
                            </div>
                        </section>
                    `}
                </div>
            `;

            bindEvents();
        };

        const updateMaterial = async (idx, updates) => {
            const mat = materials[idx];
            if (!mat) return;
            const materialId = mat.materialId || mat.id;
            try {
                container.style.opacity = '0.6';
                container.style.pointerEvents = 'none';
                await api.updateMaterial(subjectId, materialId, updates);
                Object.assign(materials[idx], updates);
                toast('success', 'Guardado', 'Material actualizado correctamente.');
            } catch (e) {
                console.error('[MaterialManager] Update failed:', e);
                toast('error', 'Error', 'No se pudo actualizar el material.');
            } finally {
                container.style.opacity = '1';
                container.style.pointerEvents = '';
                render();
            }
        };

        const bindEvents = () => {
            // Type inline edit — click to show dropdown
            container.querySelectorAll('.mat-inline-type').forEach(cell => {
                cell.addEventListener('click', () => {
                    const idx = parseInt(cell.dataset.idx);
                    const currentVal = cell.dataset.currentValue;

                    // Close any existing dropdown
                    document.querySelector('.mat-type-dropdown-active')?.remove();

                    const rect = cell.getBoundingClientRect();
                    const dropdown = document.createElement('div');
                    dropdown.className = 'mat-type-dropdown mat-type-dropdown-active';
                    dropdown.style.position = 'fixed';
                    dropdown.style.top = `${rect.bottom + 4}px`;
                    dropdown.style.left = `${rect.left}px`;
                    dropdown.style.zIndex = '9999';

                    dropdown.innerHTML = MATERIAL_TYPES.map(t => `
                        <div class="mat-type-dropdown-option ${t.value === currentVal ? 'selected' : ''}" data-value="${t.value}">
                            ${t.icon} ${t.label}
                        </div>
                    `).join('');

                    document.body.appendChild(dropdown);

                    const closeDropdown = (e) => {
                        if (!dropdown.contains(e?.target)) {
                            dropdown.remove();
                            document.removeEventListener('click', closeDropdown);
                        }
                    };

                    setTimeout(() => document.addEventListener('click', closeDropdown), 10);

                    dropdown.querySelectorAll('.mat-type-dropdown-option').forEach(opt => {
                        opt.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const newType = opt.dataset.value;
                            dropdown.remove();
                            document.removeEventListener('click', closeDropdown);
                            if (newType !== currentVal) {
                                updateMaterial(idx, { type: newType });
                            }
                        });
                    });
                });
            });

            // Filename inline edit — click to turn into input
            container.querySelectorAll('.mat-filename-text[data-field="filename"]').forEach(cell => {
                cell.addEventListener('click', () => {
                    const idx = parseInt(cell.dataset.idx);
                    const mat = materials[idx];
                    if (!mat) return;
                    const currentVal = mat.filename || '';

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'form-input mat-inline-input';
                    input.value = currentVal;
                    input.style.width = '100%';
                    input.style.fontSize = '0.88rem';
                    input.style.fontWeight = '600';

                    cell.replaceWith(input);
                    input.focus();
                    input.select();

                    const commit = () => {
                        const newVal = input.value.trim();
                        if (newVal && newVal !== currentVal) {
                            const origExt = (mat.filename || '').includes('.')
                                ? '.' + (mat.filename || '').split('.').pop()
                                : (mat.blobUrl ? '.' + (mat.blobUrl.split('.').pop() || '').split(/[?#]/)[0] : '');
                            const finalName = origExt && origExt.length < 10 && !newVal.endsWith(origExt)
                                ? newVal.replace(/\.[^/.]+$/, '') + origExt
                                : newVal;
                            updateMaterial(idx, { filename: finalName });
                        } else {
                            render();
                        }
                    };

                    input.addEventListener('blur', commit);
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
                        if (e.key === 'Escape') { input.value = currentVal; input.blur(); }
                    });
                });
            });

            // Class pill remove
            container.querySelectorAll('.mat-class-pill-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx);
                    const classId = btn.dataset.classId;
                    const mat = materials[idx];
                    if (!mat) return;
                    const newClassIds = (mat.classIds || []).filter(c => c !== classId);
                    if (newClassIds.length === 0) {
                        toast('warning', 'Mínimo requerido', 'Un material debe estar asociado al menos a una clase.');
                        return;
                    }
                    updateMaterial(idx, { classIds: newClassIds });
                });
            });

            // Class add button — show picker dropdown
            container.querySelectorAll('.mat-class-add-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx);
                    const mat = materials[idx];
                    if (!mat) return;
                    const currentClassIds = new Set(mat.classIds || []);
                    const availableClasses = classes.filter(c => !currentClassIds.has(c.id));

                    if (availableClasses.length === 0) {
                        toast('info', 'Sin clases', 'Este material ya está asociado a todas las clases disponibles.');
                        return;
                    }

                    document.querySelector('.mat-class-picker-active')?.remove();

                    const rect = btn.getBoundingClientRect();
                    const picker = document.createElement('div');
                    picker.className = 'mat-class-picker mat-class-picker-active';
                    picker.style.position = 'fixed';
                    picker.style.top = `${rect.bottom + 4}px`;
                    picker.style.left = `${Math.max(rect.left - 100, 8)}px`;
                    picker.style.zIndex = '9999';

                    picker.innerHTML = `
                        <div class="mat-class-picker-header">Agregar clase</div>
                        ${availableClasses.map(c => `
                            <div class="mat-class-picker-option" data-class-id="${escapeHtml(c.id)}">
                                <span class="mat-class-picker-id">${escapeHtml(c.id)}</span>
                                <span class="mat-class-picker-title">${escapeHtml(c.title || c.id)}</span>
                            </div>
                        `).join('')}
                    `;

                    document.body.appendChild(picker);

                    const closePicker = (ev) => {
                        if (!picker.contains(ev?.target)) {
                            picker.remove();
                            document.removeEventListener('click', closePicker);
                        }
                    };

                    setTimeout(() => document.addEventListener('click', closePicker), 10);

                    picker.querySelectorAll('.mat-class-picker-option').forEach(opt => {
                        opt.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            const classId = opt.dataset.classId;
                            picker.remove();
                            document.removeEventListener('click', closePicker);
                            updateMaterial(idx, { classIds: [...(mat.classIds || []), classId] });
                        });
                    });
                });
            });

            // Reviewed toggle
            container.querySelectorAll('.mat-reviewed-toggle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.idx);
                    const mat = materials[idx];
                    if (!mat) return;
                    updateMaterial(idx, { reviewed: !mat.reviewed });
                });
            });

            // Priority toggle
            container.querySelectorAll('.mat-priority-toggle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.idx);
                    const mat = materials[idx];
                    if (!mat) return;
                    const currentPriority = mat.priority || (mat.type === 'bibliography' ? 'secondary' : 'primary');
                    const newPriority = currentPriority === 'primary' ? 'secondary' : 'primary';
                    updateMaterial(idx, { priority: newPriority });
                });
            });

            // View / edit text modal
            container.querySelectorAll('.mat-btn-view-text').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const idx = parseInt(btn.dataset.idx);
                    const mat = materials[idx];
                    if (!mat) return;
                    const materialId = mat.materialId || mat.id;

                    // Show loading modal
                    const overlay = document.createElement('div');
                    overlay.className = 'modal-overlay';
                    overlay.innerHTML = `
                        <div class="modal-content mat-text-modal">
                            <div class="modal-header">
                                <h3 class="h4" style="margin:0;">Texto Extraído — ${escapeHtml(mat.filename)}</h3>
                                <button type="button" class="btn btn-ghost btn-sm btn-close-modal">✕</button>
                            </div>
                            <div class="modal-body">
                                <div class="loading-state" style="padding:40px 0;">Cargando texto...</div>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(overlay);
                    overlay.querySelector('.btn-close-modal')?.addEventListener('click', () => overlay.remove());
                    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

                    let extractedText = '';
                    try {
                        const result = await api.getMaterialText(subjectId, materialId);
                        extractedText = result?.text || result?.extractedText || '';
                    } catch (err) {
                        extractedText = '';
                    }

                    const modalBody = overlay.querySelector('.modal-body');
                    modalBody.innerHTML = `
                        <div class="mat-text-info">
                            <span class="mat-text-info-label">Tipo:</span> ${typeIcon(mat.type)} ${escapeHtml(typeLabel(mat.type))}
                            <span style="margin-left:16px;" class="mat-text-info-label">Estado:</span> <span class="mat-status-badge mat-status-${escapeHtml(mat.status || 'pending')}">${escapeHtml(mat.status === 'ready' ? 'Listo' : mat.status || 'Pendiente')}</span>
                        </div>
                        <textarea class="form-input mat-text-editor" id="mat-text-content" placeholder="Sin texto extraído...">${escapeHtml(extractedText)}</textarea>
                        <div class="mat-text-hint">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                            Modificar este texto actualizará los embeddings del material en el índice vectorial.
                        </div>
                    `;

                    // Add footer buttons
                    const modalContent = overlay.querySelector('.modal-content');
                    const footer = document.createElement('div');
                    footer.className = 'modal-footer';
                    footer.innerHTML = `
                        <button type="button" class="btn btn-ghost btn-cancel-text">Cancelar</button>
                        <button type="button" class="btn btn-primary btn-save-text">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                            Guardar y Re-indexar
                        </button>
                    `;
                    modalContent.appendChild(footer);

                    footer.querySelector('.btn-cancel-text')?.addEventListener('click', () => overlay.remove());
                    footer.querySelector('.btn-save-text')?.addEventListener('click', async () => {
                        const textarea = document.getElementById('mat-text-content');
                        const newText = textarea?.value || '';

                        if (newText === extractedText) {
                            overlay.remove();
                            return;
                        }

                        const saveBtn = footer.querySelector('.btn-save-text');
                        saveBtn.disabled = true;
                        saveBtn.textContent = 'Guardando...';

                        try {
                            await api.updateMaterialText(subjectId, materialId, newText);
                            toast('success', 'Texto actualizado', 'El texto fue guardado y los embeddings se están re-indexando.');
                            overlay.remove();
                        } catch (err) {
                            toast('error', 'Error', 'No se pudo guardar el texto.');
                            saveBtn.disabled = false;
                            saveBtn.textContent = 'Guardar y Re-indexar';
                        }
                    });
                });
            });

            // Reprocess material
            container.querySelectorAll('.mat-btn-reprocess').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const idx = parseInt(btn.dataset.idx);
                    const mat = materials[idx];
                    if (!mat) return;

                    const shouldRetry = await showConfirmDialog({
                        title: 'Reintentar procesamiento',
                        message: `¿Reintentar procesar "${mat.filename}"? Se eliminarán los vectores previos y se volverá a ejecutar el pipeline.`,
                        confirmText: 'Reintentar',
                        cancelText: 'Cancelar',
                    });

                    if (!shouldRetry) return;

                    try {
                        btn.disabled = true;
                        btn.textContent = 'Reintentando...';
                        await api.reprocessMaterial(mat.materialId || mat.id, subjectId);
                        mat.status = 'pending';
                        mat.errorMessage = '';
                        toast('success', 'Reprocesando', 'El material se ha re-encolado. Revisá el estado en unos segundos.');
                    } catch (e) {
                        toast('error', 'Error', e.message || 'No se pudo reprocesar el material.');
                    } finally {
                        render();
                    }
                });
            });

            // Delete material
            container.querySelectorAll('.mat-btn-delete').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const idx = parseInt(btn.dataset.idx);
                    const mat = materials[idx];
                    if (!mat) return;

                    const shouldDelete = await showConfirmDialog({
                        title: 'Eliminar material',
                        message: `¿Seguro que querés eliminar "${mat.filename}"? Esta acción eliminará también los embeddings del índice vectorial.`,
                        confirmText: 'Eliminar',
                        cancelText: 'Cancelar',
                        danger: true,
                    });

                    if (!shouldDelete) return;

                    try {
                        container.style.opacity = '0.6';
                        container.style.pointerEvents = 'none';
                        await api.deleteMaterial(mat.materialId || mat.id);
                        materials.splice(idx, 1);
                        toast('success', 'Eliminado', 'El material fue eliminado correctamente.');
                    } catch (e) {
                        toast('error', 'Error', 'No se pudo eliminar el material.');
                    } finally {
                        container.style.opacity = '1';
                        container.style.pointerEvents = '';
                        render();
                    }
                });
            });
        };

        render();
    } catch (e) {
        console.error('[MaterialManager]', e);
        container.innerHTML = `<div class="empty-state">Ocurrió un error cargando los materiales.</div>`;
    }
}
