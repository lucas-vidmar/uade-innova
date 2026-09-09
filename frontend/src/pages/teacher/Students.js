import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { toast } from '../../components/Toast.js';

export async function renderTeacherStudents(container) {
    renderHeader('Estudiantes');
    container.innerHTML = `<div class="loading-state">Cargando estudiantes...</div>`;

    const subjectId = auth.getActiveSubjectId();
    if (!subjectId) {
        container.innerHTML = `
            <div class="empty-state card">
                <div class="empty-state-icon">👥</div>
                <h3>No hay materia seleccionada</h3>
                <p>Seleccioná una materia para gestionar sus alumnos.</p>
                <button class="btn btn-ghost" onclick="document.getElementById('global-course-btn').click()">Seleccionar Materia</button>
            </div>
        `;
        return;
    }

    const escapeHtml = (v = '') => String(v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    let students = [];
    let subjectStudents = [];
    let showPicker = false;

    const refresh = async () => {
        try {
            const all = await api.getAdminUsers();
            students = all.filter(u => String(u.role||'').toLowerCase()==='student');
        } catch { students = []; }
        try {
            const enrolls = await api.getEnrollmentsBySubject(subjectId);
            subjectStudents = enrolls.filter(e => e.role==='student' && e.status==='active');
        } catch { subjectStudents = []; }
    };

    const assign = async (studentId, doAdd) => {
        if (doAdd) await api.createEnrollment(subjectId, studentId, 'student', 'active');
        else await api.deleteEnrollment(subjectId, studentId);
        await refresh();
        render();
        toast('success', doAdd ? 'Alumno asignado' : 'Alumno desasignado', doAdd ? 'Alumno agregado a la materia.' : 'Alumno quitado de la materia.');
    };

    const render = () => {
        const subjectName = auth.getEnrolledSubjects().find(s=>s.id===subjectId)?.name || subjectId;
        const visibleCount = subjectStudents.filter(enr => students.some(s => (s.id===enr.userId || s.userId===enr.userId))).length;
        container.innerHTML = `
            <div class="page-container">
                <div class="card" style="padding:var(--space-5);">
                    <div>
                        <div>
                            <h3 style="margin:0 0 4px;">Alumnos de la materia</h3>
                            <p style="font-size:var(--fs-sm);color:var(--color-text-secondary);margin:0;">${escapeHtml(subjectName)} — ${visibleCount} alumno(s) asignado(s).</p>
                        </div>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:var(--space-4);max-width:100%;overflow:visible;">
                        ${(() => {
                            const visible = subjectStudents.filter(enr => students.some(s => (s.id===enr.userId || s.userId===enr.userId)));
                            const pills = visible.length===0
                                ? '<span class="subject-prof-empty" style="color:var(--color-text-secondary);font-size:0.85rem;">Sin alumnos asignados todavía.</span>'
                                : visible.map(enr => {
                                const st = students.find(s=> s.id===enr.userId || s.userId===enr.userId);
                                const name = String(st?.name || st?.surname ? `${st.name} ${st.surname||''}`.trim() : st?.email || '').trim() || 'Alumno';
                                return `<span class="subject-prof-pill" style="max-width:100%;word-break:break-word;">
                                    <span class="subject-prof-pill-name">${escapeHtml(name)}</span>
                                    <button class="subject-prof-remove teacher-student-remove" data-student-id="${escapeHtml(enr.userId)}" title="Quitar alumno">×</button>
                                </span>`;
                            }).join('');
                            return pills + `<button class="subject-prof-add" id="btn-toggle-picker" title="${showPicker ? 'Cerrar selector' : 'Agregar alumno'}" aria-label="${showPicker ? 'Cerrar selector' : 'Agregar alumno'}">${showPicker ? '×' : '+'}</button>`;
                        })()}
                    </div>
                    ${showPicker ? `
                        <div style="margin-top:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:var(--space-3);">
                            <div class="subject-prof-picker-title" style="font-weight:600;margin-bottom:var(--space-2);">Agregar alumno</div>
                            <div style="display:flex;flex-wrap:wrap;gap:6px;max-height:240px;overflow-y:auto;">
                                ${(() => {
                                    const assigned = new Set(subjectStudents.map(e=>e.userId));
                                    const avail = students.filter(s => !assigned.has(s.id) && !assigned.has(s.userId));
                                    if (avail.length===0) return '<span class="subject-prof-empty" style="color:var(--color-text-secondary);font-size:0.85rem;">No hay más alumnos disponibles.</span>';
                                    return avail.map(s => {
                                        const sid = s.id || s.userId;
                                        const name = String(s.name || s.surname ? `${s.name} ${s.surname||''}`.trim() : s.email || '').trim() || 'Alumno';
                                        return `<button class="btn btn-secondary btn-sm teacher-student-add" data-student-id="${escapeHtml(sid)}">${escapeHtml(name)}</button>`;
                                    }).join('');
                                })()}
                            </div>
                        </div>
                    ` : ''}
                </div>
                <div class="card" style="padding:var(--space-4);margin-top:var(--space-4);background:var(--color-surface-2);">
                    <p style="font-size:var(--fs-sm);color:var(--color-text-secondary);margin:0;">Los alumnos asignados aquí acceden automáticamente a las clases y materiales de la materia. Gestioná también desde <a href="#/teacher/classes">Gestor de Clases</a>.</p>
                </div>
            </div>
        `;
        container.querySelector('#btn-toggle-picker')?.addEventListener('click', () => { showPicker = !showPicker; render(); });
        container.querySelectorAll('.teacher-student-add').forEach(btn => {
            btn.addEventListener('click', async () => {
                const sid = btn.getAttribute('data-student-id');
                try { await assign(sid, true); } catch(e){ toast('error','Error',e?.message||'No se pudo asignar');}
            });
        });
        container.querySelectorAll('.teacher-student-remove').forEach(btn => {
            btn.addEventListener('click', async () => {
                const sid = btn.getAttribute('data-student-id');
                try { await assign(sid, false); } catch(e){ toast('error','Error',e?.message||'No se pudo desasignar');}
            });
        });
    };

    await refresh();
    render();
}
