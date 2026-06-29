import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { enrollments as enrollmentService } from '../../services/enrollments.js';
import { toast } from '../../components/Toast.js';
import { showConfirmDialog } from '../../components/Dialog.js';

export async function renderSubjectManagement(container) {
    renderHeader('Gestion de Materias');
    container.innerHTML = `<div class="loading-state">Cargando materias...</div>`;

    const safeArray = (value) => (Array.isArray(value) ? value : []);
    const escapeHtml = (value = '') => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    let subjects = [];
    let users = [];
    let subjectProfessorMap = {};
    let pendingHighlight = null;
    let query = '';
    let currentPage = 1;
    const PAGE_SIZE = 8;
    let activeProfessorPickerSubjectId = null;
    let columnFilters = {
        id: '',
        name: '',
        professor: '',
    };
    let sortConfig = {
        key: 'id',
        direction: 'asc',
    };

    const refreshSubjects = async () => {
        subjects = safeArray(await api.getSubjects());
    };

    const refreshUsers = async () => {
        users = safeArray(await api.getAdminUsers());
    };

    const refreshSubjectProfessorMap = async () => {
        const entries = await Promise.all(subjects.map(async (subject) => {
            try {
                const classes = safeArray(await api.getClasses(subject.id));
                const classProfessorIds = Array.from(new Set(classes.flatMap((cls) => safeArray(cls.professorIds))));
                // Merge class-level with subject-level professorIds
                const subjectProfessorIds = safeArray(subject.professorIds);
                const merged = Array.from(new Set([...classProfessorIds, ...subjectProfessorIds]));
                return [subject.id, merged];
            } catch {
                return [subject.id, safeArray(subject.professorIds)];
            }
        }));
        subjectProfessorMap = Object.fromEntries(entries);
    };

    const getTeacherUsers = () => users.filter((user) => {
        const role = String(user.role || '').toLowerCase();
        return role === 'teacher' || role === 'professor' || role === 'docente';
    });

    const getSubjectProfessorIds = (subject) => {
        const mapped = subjectProfessorMap[subject.id];
        if (Array.isArray(mapped)) return mapped;
        if (Array.isArray(subject.professorIds)) return subject.professorIds;
        if (subject.professorId) return [subject.professorId];
        return [];
    };

    const getSubjectOneLiner = (subject) => {
        const value = String(subject.oneLiner || subject.comment || subject.description || '').trim();
        return value || 'Sin comentario';
    };

    const getPreviousProfessorIds = (subject) => {
        const mapped = subjectProfessorMap[subject.id];
        if (Array.isArray(mapped)) return mapped;
        if (Array.isArray(subject.professorIds)) return subject.professorIds;
        if (subject.professorId) return [subject.professorId];
        return [];
    };

    const saveSubjectProfessorIds = async (subjectId, selectedIds) => {
        const subject = subjects.find((item) => item.id === subjectId);
        if (!subject) return;

        const previousIds = getPreviousProfessorIds(subject);
        const addedIds = selectedIds.filter(id => !previousIds.includes(id));
        const removedIds = previousIds.filter(id => !selectedIds.includes(id));

        await api.saveSubject({ ...subject, professorIds: selectedIds });

        const classes = safeArray(await api.getClasses(subjectId));
        if (classes.length > 0) {
            const nextClasses = classes.map((cls) => ({ ...cls, professorIds: [...selectedIds] }));
            await api.saveClasses(subjectId, nextClasses);
        }

        // Upsert enrollment records for added professors
        await Promise.all(addedIds.map(async (profId) => {
            try {
                await api.createEnrollment(subjectId, profId, 'teacher', 'active');
            } catch (err) {
                console.warn(`[SubjectManagement] Error creating enrollment for ${profId}:`, err);
            }
        }));

        // Remove enrollment records for removed professors
        await Promise.all(removedIds.map(async (profId) => {
            try {
                await api.deleteEnrollment(subjectId, profId);
            } catch (err) {
                console.warn(`[SubjectManagement] Error deleting enrollment for ${profId}:`, err);
            }
        }));

        // Clear enrollment cache for affected teachers
        [...addedIds, ...removedIds].forEach(profId => {
            enrollmentService.clearCache(profId);
        });

        subjects = subjects.map((item) => (
            item.id === subjectId
                ? { ...item, professorIds: selectedIds }
                : item
        ));

        subjectProfessorMap = {
            ...subjectProfessorMap,
            [subjectId]: [...selectedIds],
        };
    };

    const generateSubjectId = (name) => String(name || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');

    const openCreateSubjectModal = () => new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 560px; width: 92%;">
                <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                    <h3 class="h4" style="margin:0;">Nueva materia</h3>
                    <button type="button" class="btn btn-ghost btn-sm create-subject-close" aria-label="Cerrar">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label" for="new-subject-name">Nombre de la materia</label>
                        <input id="new-subject-name" class="form-input" type="text" placeholder="Ej: Materia de prueba 2026" />
                    </div>
                    <div class="form-group" style="margin-top: 10px;">
                        <label class="form-label" for="new-subject-oneliner">Oneliner</label>
                        <input id="new-subject-oneliner" class="form-input" type="text" placeholder="Comentario corto de la materia" />
                    </div>
                    <div class="form-group" style="margin-top: 10px;">
                        <label class="form-label">ID</label>
                        <div id="new-subject-id" class="subject-id-preview">-</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-ghost create-subject-cancel">Cancelar</button>
                    <button type="button" class="btn btn-primary create-subject-confirm" disabled>Crear</button>
                </div>
            </div>
        `;

        const nameInput = overlay.querySelector('#new-subject-name');
        const oneLinerInput = overlay.querySelector('#new-subject-oneliner');
        const idInput = overlay.querySelector('#new-subject-id');
        const confirmBtn = overlay.querySelector('.create-subject-confirm');

        const close = (payload) => {
            overlay.remove();
            resolve(payload);
        };

        const syncPreview = () => {
            const nameValue = String(nameInput?.value || '').trim();
            const idValue = generateSubjectId(nameValue);
            if (idInput) idInput.textContent = idValue || '-';
            if (confirmBtn) confirmBtn.disabled = !nameValue || !idValue;
        };

        overlay.querySelector('.create-subject-close')?.addEventListener('click', () => close(null));
        overlay.querySelector('.create-subject-cancel')?.addEventListener('click', () => close(null));
        overlay.querySelector('.create-subject-confirm')?.addEventListener('click', () => {
            const name = String(nameInput?.value || '').trim();
            const id = String(idInput?.textContent || '').trim();
            const oneLiner = String(oneLinerInput?.value || '').trim();
            if (!name || !id) return;
            close({ name, id, oneLiner });
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) close(null);
        });

        nameInput?.addEventListener('input', syncPreview);
        nameInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !confirmBtn.disabled) {
                event.preventDefault();
                confirmBtn.click();
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                close(null);
            }
        });

        document.body.appendChild(overlay);
        nameInput?.focus();
        syncPreview();
    });

    const rerenderWithFocus = (elementId) => {
        const activeEl = document.getElementById(elementId);
        const selectionStart = activeEl && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
        const selectionEnd = activeEl && typeof activeEl.selectionEnd === 'number' ? activeEl.selectionEnd : null;

        render();

        const nextEl = document.getElementById(elementId);
        if (!nextEl) return;
        nextEl.focus();
        if (selectionStart !== null && selectionEnd !== null && typeof nextEl.setSelectionRange === 'function') {
            nextEl.setSelectionRange(selectionStart, selectionEnd);
        }
    };

    const applySort = (items, teacherUsers) => {
        const sorted = [...items];
        sorted.sort((a, b) => {
            const getValue = (subject, key) => {
                if (key === 'id') return String(subject.id || '').toLowerCase();
                if (key === 'name') return String(subject.name || '').toLowerCase();
                    if (key === 'professor') {
                        const ids = getSubjectProfessorIds(subject);
                        if (ids.length === 0) return '';
                        const names = ids
                            .map((id) => teacherUsers.find((teacher) => teacher.id === id)?.name || id)
                            .join(' ')
                            .toLowerCase();
                        return names;
                    }
                    if (key === 'enrolledCount') {
                        return String(subject.enrolledCount || 0).padStart(10, '0');
                    }
                    return '';
            };

            const av = getValue(a, sortConfig.key);
            const bv = getValue(b, sortConfig.key);
            const cmp = av.localeCompare(bv, 'es', { sensitivity: 'base', numeric: true });
            return sortConfig.direction === 'asc' ? cmp : -cmp;
        });
        return sorted;
    };

    const render = () => {
        const baseFilteredSubjects = subjects.filter((subject) => {
            const haystack = `${subject.id || ''} ${subject.name || ''} ${getSubjectOneLiner(subject)}`.toLowerCase();
            return haystack.includes(query.toLowerCase());
        });
        const teacherUsers = getTeacherUsers();

        const columnFilteredSubjects = baseFilteredSubjects.filter((subject) => {
            const idPass = String(subject.id || '').toLowerCase().includes(columnFilters.id.toLowerCase());
            const namePass = String(subject.name || '').toLowerCase().includes(columnFilters.name.toLowerCase());

            const selectedProfessorIds = getSubjectProfessorIds(subject);
            const professorFilter = columnFilters.professor;
            let profPass = true;
            if (professorFilter === '__assigned') {
                profPass = selectedProfessorIds.length > 0;
            } else if (professorFilter === '__unassigned') {
                profPass = selectedProfessorIds.length === 0;
            } else if (professorFilter) {
                profPass = selectedProfessorIds.includes(professorFilter);
            }

            return idPass && namePass && profPass;
        });

        const filteredSubjects = applySort(columnFilteredSubjects, teacherUsers);

        const totalPages = Math.max(1, Math.ceil(filteredSubjects.length / PAGE_SIZE));
        currentPage = Math.min(currentPage, totalPages);
        const pageStart = (currentPage - 1) * PAGE_SIZE;
        const pageItems = filteredSubjects.slice(pageStart, pageStart + PAGE_SIZE);
        const visibleFrom = filteredSubjects.length === 0 ? 0 : pageStart + 1;
        const visibleTo = Math.min(pageStart + pageItems.length, filteredSubjects.length);

        container.innerHTML = `
            <div class="page-container">
                ${subjects.length === 0 ? `
                    <div class="empty-state card">
                        <div class="empty-state-icon">📚</div>
                        <p>No hay materias disponibles.</p>
                        <button class="btn btn-primary" id="btn-new-subject" style="margin-top: 20px;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            Nueva materia
                        </button>
                    </div>
                ` : `
                    <section class="subject-directory-shell">
                        <div class="subject-directory-head">
                            <div>
                                <h3 class="subject-directory-title">Directorio de Materias</h3>
                                <p class="subject-directory-meta">${subjects.length} materias activas</p>
                            </div>
                            <div class="subject-directory-tools">
                                <input
                                    id="subject-search"
                                    class="form-input subject-directory-search"
                                    placeholder="Buscar materias..."
                                    value="${escapeHtml(query)}"
                                />
                                <button class="btn btn-primary subject-directory-new" id="btn-new-subject">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    Nueva materia
                                </button>
                            </div>
                        </div>

                        <div class="table-responsive">
                            <table class="table align-middle subject-directory-table">
                                <thead>
                                    <tr>
                                        <th style="width:220px;">
                                            <button class="subject-sort-btn" data-sort-key="id">ID Materia ${sortConfig.key === 'id' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</button>
                                        </th>
                                        <th>
                                            <button class="subject-sort-btn" data-sort-key="name">Nombre ${sortConfig.key === 'name' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</button>
                                        </th>
                                        <th style="width:200px;">
                                            <button class="subject-sort-btn" data-sort-key="professor">Profesores ${sortConfig.key === 'professor' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</button>
                                        </th>
                                        <th style="width:90px;">
                                            <button class="subject-sort-btn" data-sort-key="enrolledCount">Alumnos ${sortConfig.key === 'enrolledCount' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}</button>
                                        </th>
                                        <th style="width:100px;">Acciones</th>
                                    </tr>
                                    <tr class="subject-filter-row">
                                        <th>
                                            <input id="col-filter-id" class="form-input subject-col-filter" placeholder="Filtrar ID" value="${escapeHtml(columnFilters.id)}" />
                                        </th>
                                        <th>
                                            <input id="col-filter-name" class="form-input subject-col-filter" placeholder="Filtrar nombre" value="${escapeHtml(columnFilters.name)}" />
                                        </th>
                                        <th>
                                            <select id="col-filter-prof" class="form-input subject-col-filter">
                                                <option value="" ${columnFilters.professor === '' ? 'selected' : ''}>Todos</option>
                                                <option value="__assigned" ${columnFilters.professor === '__assigned' ? 'selected' : ''}>Con profesor</option>
                                                <option value="__unassigned" ${columnFilters.professor === '__unassigned' ? 'selected' : ''}>Sin profesor</option>
                                                ${teacherUsers.map((teacher) => `
                                                    <option value="${escapeHtml(teacher.id)}" ${columnFilters.professor === teacher.id ? 'selected' : ''}>${escapeHtml(teacher.name || teacher.id)}</option>
                                                `).join('')}
                                            </select>
                                        </th>
                                        <th></th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${pageItems.map((subject) => {
                                        const selectedProfessorIds = getSubjectProfessorIds(subject);
                                        const assignedTeachers = selectedProfessorIds
                                            .map((profId) => teacherUsers.find((teacher) => teacher.id === profId))
                                            .filter(Boolean);
                                        const availableTeachers = teacherUsers.filter((teacher) => !selectedProfessorIds.includes(teacher.id));
                                        return `
                                            <tr>
                                                <td><span class="subject-directory-id">${escapeHtml(subject.id)}</span></td>
                                                <td>
                                                    <div class="subject-directory-name-wrap">
                                                        <span
                                                            class="inline-cell inline-edit-subject subject-directory-name"
                                                            data-subject-id="${escapeHtml(subject.id)}"
                                                            data-field="name"
                                                            data-current-value="${escapeHtml(subject.name || '')}"
                                                            title="Click para editar"
                                                        >${escapeHtml(subject.name || 'Sin nombre')}</span>
                                                        <span
                                                            class="inline-cell inline-edit-subject subject-directory-track"
                                                            data-subject-id="${escapeHtml(subject.id)}"
                                                            data-field="oneLiner"
                                                            data-current-value="${escapeHtml(getSubjectOneLiner(subject) === 'Sin comentario' ? '' : getSubjectOneLiner(subject))}"
                                                            title="Click para editar"
                                                        >${escapeHtml(getSubjectOneLiner(subject))}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div class="subject-prof-pills-wrap">
                                                        <div class="subject-prof-pills">
                                                            ${assignedTeachers.length > 0
                                                                ? assignedTeachers.map((teacher) => `
                                                                    <span class="subject-prof-pill">
                                                                        <span class="subject-prof-pill-name">${escapeHtml(teacher.name || teacher.id)}</span>
                                                                        <button class="subject-prof-remove" data-subject-id="${escapeHtml(subject.id)}" data-professor-id="${escapeHtml(teacher.id)}" title="Quitar profesor">×</button>
                                                                    </span>
                                                                `).join('')
                                                                : '<span class="subject-prof-empty">Sin profesores</span>'}

                                                            <button class="subject-prof-add" data-subject-id="${escapeHtml(subject.id)}" title="Agregar profesor">+</button>
                                                        </div>

                                                        ${activeProfessorPickerSubjectId === subject.id ? `
                                                            <div class="subject-prof-picker">
                                                                <div class="subject-prof-picker-card">
                                                                    <div class="subject-prof-picker-title">Agregar profesor</div>
                                                                    <div class="subject-prof-picker-list">
                                                                        ${availableTeachers.length === 0
                                                                            ? '<div class="subject-prof-picker-empty">No hay mas profesores disponibles</div>'
                                                                            : availableTeachers.map((teacher) => `
                                                                                <button class="subject-prof-picker-item" data-subject-id="${escapeHtml(subject.id)}" data-professor-id="${escapeHtml(teacher.id)}">
                                                                                    ${escapeHtml(teacher.name || teacher.id)}
                                                                                </button>
                                                                            `).join('')}
                                                                    </div>
                                                                    <div class="subject-prof-picker-actions">
                                                                        <button class="btn btn-ghost btn-sm subject-prof-picker-close" data-subject-id="${escapeHtml(subject.id)}">Cerrar</button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ` : ''}
                                                    </div>
                                                </td>
                                                <td style="text-align:center;">
                                                    <span
                                                        class="inline-cell inline-edit-subject subject-directory-enrolled"
                                                        data-subject-id="${escapeHtml(subject.id)}"
                                                        data-field="enrolledCount"
                                                        data-current-value="${subject.enrolledCount || ''}"
                                                        title="Click para editar cantidad de alumnos"
                                                    >${subject.enrolledCount || '-'}</span>
                                                </td>
                                                <td style="text-align:center;">
                                                    <div class="subject-directory-actions">
                                                        <button class="btn btn-icon btn-ghost btn-delete-subject" data-subject-id="${escapeHtml(subject.id)}" data-subject-name="${escapeHtml(subject.name || subject.id)}" title="Eliminar Materia">
                                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}

                                    ${filteredSubjects.length === 0 ? `
                                        <tr>
                                            <td colspan="5" class="subject-table-empty">No se encontraron materias para esa busqueda.</td>
                                        </tr>
                                    ` : ''}
                                </tbody>
                            </table>
                        </div>

                        <div class="subject-directory-footer">
                            <span>Mostrando ${visibleFrom} a ${visibleTo} de ${filteredSubjects.length} materias</span>
                            <div class="subject-directory-pagination">
                                <button class="subject-page-btn" data-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
                                </button>
                                ${Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => `
                                    <button class="subject-page-btn ${page === currentPage ? 'active' : ''}" data-page="${page}">${page}</button>
                                `).join('')}
                                <button class="subject-page-btn" data-page="next" ${currentPage >= totalPages ? 'disabled' : ''}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                                </button>
                            </div>
                        </div>
                    </section>
                `}
            </div>
        `;

        const searchInput = document.getElementById('subject-search');
        searchInput?.addEventListener('input', (event) => {
            query = String(event.target.value || '');
            currentPage = 1;
            rerenderWithFocus('subject-search');
        });

        container.querySelectorAll('.subject-sort-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-sort-key');
                if (!key) return;
                if (sortConfig.key === key) {
                    sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    sortConfig = { key, direction: 'asc' };
                }
                render();
            });
        });

        const filterIdEl = document.getElementById('col-filter-id');
        filterIdEl?.addEventListener('input', (event) => {
            columnFilters.id = String(event.target.value || '');
            currentPage = 1;
            rerenderWithFocus('col-filter-id');
        });

        const filterNameEl = document.getElementById('col-filter-name');
        filterNameEl?.addEventListener('input', (event) => {
            columnFilters.name = String(event.target.value || '');
            currentPage = 1;
            rerenderWithFocus('col-filter-name');
        });

        const filterProfEl = document.getElementById('col-filter-prof');
        filterProfEl?.addEventListener('change', (event) => {
            columnFilters.professor = String(event.target.value || '');
            currentPage = 1;
            render();
        });

        container.querySelectorAll('.subject-page-btn[data-page]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-page');
                if (!action) return;
                if (action === 'prev') {
                    currentPage = Math.max(1, currentPage - 1);
                } else if (action === 'next') {
                    currentPage += 1;
                } else {
                    currentPage = Number(action) || 1;
                }
                render();
            });
        });

        container.querySelectorAll('.subject-prof-add').forEach((btn) => {
            btn.addEventListener('click', () => {
                const subjectId = btn.getAttribute('data-subject-id');
                if (!subjectId) return;
                activeProfessorPickerSubjectId = activeProfessorPickerSubjectId === subjectId ? null : subjectId;
                render();
            });
        });

        container.querySelectorAll('.subject-prof-picker-close').forEach((btn) => {
            btn.addEventListener('click', () => {
                activeProfessorPickerSubjectId = null;
                render();
            });
        });

        container.querySelectorAll('.subject-prof-picker-item').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const subjectId = btn.getAttribute('data-subject-id');
                const selectedProfessorId = btn.getAttribute('data-professor-id');
                if (!subjectId) return;
                if (!selectedProfessorId) return;

                const currentIds = getSubjectProfessorIds({ id: subjectId });
                const nextIds = Array.from(new Set([...currentIds, selectedProfessorId]));

                try {
                    await saveSubjectProfessorIds(subjectId, nextIds);
                    activeProfessorPickerSubjectId = null;
                    toast('success', 'Profesores actualizados', 'Se agrego el profesor a la materia.');
                    render();
                } catch (err) {
                    toast('error', 'Error', err.message || 'No se pudo actualizar la asignacion de profesores.');
                }
            });
        });

        container.querySelectorAll('.subject-prof-remove').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const subjectId = btn.getAttribute('data-subject-id');
                const professorId = btn.getAttribute('data-professor-id');
                if (!subjectId || !professorId) return;

                const currentIds = getSubjectProfessorIds({ id: subjectId });
                const nextIds = currentIds.filter((id) => id !== professorId);

                try {
                    await saveSubjectProfessorIds(subjectId, nextIds);
                    toast('success', 'Profesores actualizados', 'Se quito el profesor de la materia.');
                    render();
                } catch (err) {
                    toast('error', 'Error', err.message || 'No se pudo actualizar la asignacion de profesores.');
                }
            });
        });

        if (pendingHighlight) {
            const target = container.querySelector(`.inline-edit-subject[data-subject-id="${pendingHighlight.subjectId}"][data-field="${pendingHighlight.field}"]`);
            if (target) {
                target.classList.add('inline-cell-saved');
                setTimeout(() => target.classList.remove('inline-cell-saved'), 1100);
            }
            pendingHighlight = null;
        }

        document.getElementById('btn-new-subject')?.addEventListener('click', async () => {
            const result = await openCreateSubjectModal();
            if (!result) return;
            try {
                const newSubject = {
                    id: result.id,
                    name: result.name,
                    oneLiner: result.oneLiner || '',
                    comment: result.oneLiner || '',
                    description: result.oneLiner || '',
                };
                await api.saveSubject(newSubject);
                
                // Set as active so user can go straight to Class Management
                auth.setActiveSubjectId(result.id);

                await refreshSubjects();
                await refreshSubjectProfessorMap();
                toast('success', 'Materia creada', 'La materia fue creada correctamente.');
                
                // Reload to update header/sidebar context
                setTimeout(() => window.location.reload(), 1000);
            } catch (err) {
                toast('error', 'Error', err.message || 'No se pudo crear la materia.');
            }
        });

        container.querySelectorAll('.inline-edit-subject').forEach((cell) => {
            cell.addEventListener('click', () => {
                if (cell.dataset.editing === '1') return;
                cell.dataset.editing = '1';

                const subjectId = cell.getAttribute('data-subject-id');
                const field = cell.getAttribute('data-field') || 'name';
                const currentValue = cell.getAttribute('data-current-value') || '';
                cell.innerHTML = `<input type="text" class="form-input form-input-sm inline-editor" value="${escapeHtml(currentValue)}" />`;

                const input = cell.querySelector('.inline-editor');
                if (!input) return;
                input.focus();
                input.select();

                const finish = async (shouldSave) => {
                    cell.dataset.editing = '0';
                    const nextValue = String(input.value || '').trim();

                    if (!shouldSave || !subjectId) {
                        render();
                        return;
                    }

                    if (field === 'name' && !nextValue) {
                        render();
                        return;
                    }

                    if (nextValue === currentValue) {
                        render();
                        return;
                    }

                    try {
                        const subject = subjects.find((item) => item.id === subjectId) || {};
                        const payload = { ...subject, id: subjectId };
                        if (field === 'oneLiner') {
                            payload.oneLiner = nextValue;
                            payload.comment = nextValue;
                            payload.description = nextValue;
                        } else if (field === 'enrolledCount') {
                            payload.enrolledCount = nextValue ? Number(nextValue) : 0;
                        } else {
                            payload[field] = nextValue;
                        }
                        await api.saveSubject(payload);
                        pendingHighlight = { subjectId, field };
                        await refreshSubjects();
                        await refreshSubjectProfessorMap();
                        toast('success', 'Materia actualizada', field === 'name' ? 'Se guardo el nombre de la materia.' : 'Se guardo el oneliner de la materia.');
                        render();
                    } catch (err) {
                        toast('error', 'Error', err.message || 'No se pudo actualizar la materia.');
                        render();
                    }
                };

                input.addEventListener('keydown', async (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        await finish(true);
                    }
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        await finish(false);
                    }
                });

                input.addEventListener('blur', async () => {
                    await finish(true);
                });
            });
        });

        container.querySelectorAll('.btn-delete-subject').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const subjectId = e.currentTarget.getAttribute('data-subject-id');
                const subjectName = e.currentTarget.getAttribute('data-subject-name') || subjectId;
                if (!subjectId) return;

                const performDelete = async (cascade = false) => {
                    try {
                        await api.deleteSubject(subjectId, cascade);
                        
                        if (auth.getActiveSubjectId() === subjectId) {
                            sessionStorage.removeItem('edu_active_subject');
                        }

                        await refreshSubjects();
                        await refreshSubjectProfessorMap();
                        toast('success', 'Materia eliminada', cascade ? 'La materia y todos sus recursos fueron eliminados.' : 'La materia fue eliminada correctamente.');
                        
                        setTimeout(() => window.location.reload(), 1000);
                    } catch (err) {
                        if (err.message.includes(' Use \'cascade=true\'')) {
                            const shouldCascade = await showConfirmDialog({
                                title: 'Eliminar con clases asociadas',
                                message: `La materia "${subjectName}" tiene clases y materiales. ¿Deseas eliminar ABSOLUTAMENTE TODO lo relacionado con esta materia? Esta acción es irreversible e incluye vectores de búsqueda y resúmenes IA.`,
                                confirmText: 'Eliminar todo',
                                cancelText: 'Cancelar',
                                danger: true,
                            });
                            if (shouldCascade) {
                                await performDelete(true);
                            }
                        } else {
                            // Si el error indica que no existe (404), refrescamos la lista para limpiar fantasmas
                            if (err.message.includes('404') || err.message.toLowerCase().includes('no encontrada')) {
                                await refreshSubjects();
                                render();
                            }
                            toast('error', 'Error', err.message || 'No se pudo eliminar la materia.');
                        }
                    }
                };

                const shouldDelete = await showConfirmDialog({
                    title: 'Eliminar materia',
                    message: `Seguro que queres eliminar la materia "${subjectName}"?`,
                    confirmText: 'Eliminar',
                    cancelText: 'Cancelar',
                    danger: true,
                });

                if (shouldDelete) {
                    await performDelete(false);
                }
            });
        });
    };

    try {
        await Promise.all([refreshSubjects(), refreshUsers()]);
        await refreshSubjectProfessorMap();
        render();
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="empty-state">Ocurrio un error cargando el gestor de materias.</div>`;
    }
}
