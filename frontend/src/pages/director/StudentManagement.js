/* ============================================================
   StudentManagement (Director) — Gestión de Alumnos por materia.
   Tab dedicado (Story 1.6): asignar/quitar alumnos a materias vía
   Enrollments. Accesible desde el rail y desde el acceso directo
   en la columna "Alumnos" de Gestión de Materias.
   ============================================================ */
import { renderHeader } from '../../components/Header.js';
import { api } from '../../services/api.js';
import { enrollments as enrollmentService } from '../../services/enrollments.js';
import { toast } from '../../components/Toast.js';

function parseHashQuery() {
  const hash = window.location.hash || '';
  const query = hash.split('?')[1] || '';
  return new URLSearchParams(query);
}

export async function renderDirectorStudentManagement(container) {
  renderHeader('Gestión de Alumnos');
  container.innerHTML = `<div class="loading-state">Cargando alumnos...</div>`;

  const safeArray = (value) => (Array.isArray(value) ? value : []);
  const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  let students = [];
  let subjects = [];
  let subjectEnrollmentMap = {};
  let query = '';
  let focusSubjectId = parseHashQuery().get('subjectId') || null;

  const refreshData = async () => {
    const [users, subjectList] = await Promise.all([
      api.getAdminUsers(),
      api.getSubjects(),
    ]);
    students = safeArray(users).filter((u) => {
      const role = String(u.role || '').toLowerCase();
      return role === 'student' || role === 'alumno';
    });
    subjects = safeArray(subjectList);

    const entries = await Promise.all(subjects.map(async (subject) => {
      // fix #500: strict read. A failed read of the enrollments must be declared,
      // never drawn as "0 INSCRIPTOS" for a unit that does have students.
      const enrollments = safeArray(await api.getEnrollmentsBySubject(subject.id, { strict: true }));
      return [subject.id, enrollments];
    }));
    subjectEnrollmentMap = Object.fromEntries(entries);
  };

  const getEnrolledStudentIds = (subjectId) => {
    const entries = subjectEnrollmentMap[subjectId] || [];
    return entries
      .filter((e) => e.role === 'student' && e.status === 'active')
      .map((e) => e.userId);
  };

  const displayName = (student) => {
    const full = `${student.name || ''} ${student.surname || ''}`.trim();
    return full || student.email || student.userId || 'Alumno';
  };

  const toggleAssignment = async (subjectId, studentId, assign) => {
    if (!subjectId || !studentId) return;
    const student = students.find((s) => (s.id || s.userId) === studentId);
    try {
      if (assign) {
        await api.createEnrollment(subjectId, studentId, 'student', 'active');
      } else {
        await api.deleteEnrollment(subjectId, studentId);
      }
      enrollmentService.clearCache(studentId);
      const enrollments = safeArray(await api.getEnrollmentsBySubject(subjectId));
      subjectEnrollmentMap = { ...subjectEnrollmentMap, [subjectId]: enrollments };
      toast('success', assign ? 'Alumno asignado' : 'Alumno desasignado',
        assign
          ? `${displayName(student || {})} fue asignado a la materia.`
          : `${displayName(student || {})} fue desasignado de la materia.`);
      render();
    } catch (err) {
      toast('error', 'Error', err?.message || 'No se pudo actualizar la inscripción.');
    }
  };

  const filteredStudents = () => {
    const q = query.toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      `${displayName(s)} ${s.email || ''} ${s.userId || ''}`.toLowerCase().includes(q));
  };

  const render = () => {
    const visibleStudents = filteredStudents();

    container.innerHTML = `
      <div class="page-container">
        <section class="subject-directory-shell">
          <div class="subject-directory-head">
            <div>
              <h3 class="subject-directory-title">Gestión de Alumnos</h3>
              <p class="subject-directory-meta">${students.length} alumnos · marcá la casilla para inscribir en cada materia</p>
            </div>
            <div class="subject-directory-tools">
              <input
                id="student-search"
                class="form-input subject-directory-search"
                placeholder="Buscar alumno..."
                value="${escapeHtml(query)}"
              />
              ${focusSubjectId ? `
                <button class="btn btn-ghost" id="clear-focus-subject">Ver todas las materias</button>
              ` : ''}
            </div>
          </div>

          <div class="table-responsive">
            <table class="table align-middle subject-directory-table">
              <thead>
                <tr>
                  <th style="width:260px;">Alumno</th>
                  ${subjects.map((subject) => `
                    <th style="text-align:center;${focusSubjectId && focusSubjectId !== subject.id ? 'opacity:0.45;' : ''}${focusSubjectId === subject.id ? 'background:rgba(59,130,246,0.08);' : ''}">
                      <div style="display:flex;flex-direction:column;gap:2px;align-items:center;">
                        <span>${escapeHtml(subject.name || subject.id)}</span>
                        <span style="font-size:11px;font-weight:500;color:var(--color-text-muted,#6b7280);">
                          ${getEnrolledStudentIds(subject.id).length} inscriptos
                        </span>
                      </div>
                    </th>
                  `).join('')}
                </tr>
              </thead>
              <tbody>
                ${visibleStudents.map((student) => {
                  const sid = student.id || student.userId;
                  return `
                  <tr>
                    <td>
                      <div class="subject-directory-name-wrap">
                        <span class="subject-directory-name">${escapeHtml(displayName(student))}</span>
                        <span class="subject-directory-track">${escapeHtml(student.email || '')}</span>
                      </div>
                    </td>
                    ${subjects.map((subject) => {
                      const enrolled = getEnrolledStudentIds(subject.id).includes(sid);
                      const dimmed = focusSubjectId && focusSubjectId !== subject.id;
                      return `
                      <td style="text-align:center;${dimmed ? 'opacity:0.45;' : ''}${focusSubjectId === subject.id ? 'background:rgba(59,130,246,0.05);' : ''}">
                        <input
                          type="checkbox"
                          class="student-enroll-toggle"
                          data-subject-id="${escapeHtml(subject.id)}"
                          data-student-id="${escapeHtml(sid)}"
                          ${enrolled ? 'checked' : ''}
                          title="${enrolled ? 'Quitar de' : 'Inscribir en'} ${escapeHtml(subject.name || subject.id)}"
                          style="width:18px;height:18px;cursor:pointer;"
                        />
                      </td>`;
                    }).join('')}
                  </tr>`;
                }).join('')}

                ${visibleStudents.length === 0 ? `
                  <tr>
                    <td colspan="${subjects.length + 1}" class="subject-table-empty">No se encontraron alumnos.</td>
                  </tr>
                ` : ''}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    const searchInput = document.getElementById('student-search');
    searchInput?.addEventListener('input', (event) => {
      query = String(event.target.value || '');
      rerenderPreservingFocus();
    });

    document.getElementById('clear-focus-subject')?.addEventListener('click', () => {
      focusSubjectId = null;
      window.history.replaceState(null, '', '#/director/students');
      render();
    });

    container.querySelectorAll('.student-enroll-toggle').forEach((checkbox) => {
      checkbox.addEventListener('change', async () => {
        const subjectId = checkbox.getAttribute('data-subject-id');
        const studentId = checkbox.getAttribute('data-student-id');
        checkbox.disabled = true;
        await toggleAssignment(subjectId, studentId, checkbox.checked);
      });
    });
  };

  const rerenderPreservingFocus = () => {
    const activeEl = document.getElementById('student-search');
    const pos = activeEl && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
    render();
    const nextEl = document.getElementById('student-search');
    if (!nextEl) return;
    nextEl.focus();
    if (pos !== null && typeof nextEl.setSelectionRange === 'function') {
      nextEl.setSelectionRange(pos, pos);
    }
  };

  try {
    await refreshData();
    // Si la materia del shortcut ya no existe, limpiar el foco.
    if (focusSubjectId && !subjects.some((s) => s.id === focusSubjectId)) {
      focusSubjectId = null;
    }
    render();
  } catch (err) {
    console.error(err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <h3>No se pudieron leer las matrículas</h3>
        <p>La lectura de las inscripciones de las materias falló. No se muestran conteos para no afirmar que no hay alumnos inscriptos.</p>
        <button id="btn-retry-students" class="btn btn-primary" style="margin-top:12px;">Reintentar</button>
      </div>
    `;
    container.querySelector('#btn-retry-students')?.addEventListener('click', () => renderDirectorStudentManagement(container));
  }
}
