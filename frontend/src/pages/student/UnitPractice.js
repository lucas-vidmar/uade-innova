/* ============================================================
   UnitPractice.js — Práctica de autoexamen de la UNIDAD (UJ-30, pasos 1 y 2)

   Antes esta práctica sólo existía dentro del detalle de una clase: para
   preparar la evaluación de la unidad había que repetir generar → responder →
   cerrar una vez por clase, y nunca se veía la unidad entera. Acá el alcance se
   anuncia (clases publicadas, sus temas y materiales) y se puede acotar a los
   temas que más preocupan antes de empezar. La práctica por clase del detalle
   sigue funcionando igual: es otro alcance del mismo componente.
   ============================================================ */
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { renderAutoevaluacion } from '../../components/Autoevaluacion.js';

export async function renderStudentUnitPractice(container) {
  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  const subjectName = user?.subjects?.find((s) => s.id === activeSubjectId)?.name || 'la unidad';

  renderHeader('Práctica de la unidad');

  if (!activeSubjectId) {
    container.innerHTML = '<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>';
    return;
  }

  container.innerHTML = `
    <div class="student-unit-practice" style="max-width:960px;margin:0 auto;padding:var(--space-6);">
      <header style="margin-bottom:var(--space-5);">
        <h2 class="h3" style="margin:0 0 var(--space-2) 0;">Práctica de la unidad</h2>
        <p style="margin:0;color:var(--color-text-secondary);font-size:var(--font-size-sm);">
          Prepará la evaluación de <strong>${escapeHtml(subjectName)}</strong> en una sola práctica:
          reúne los temas de todas las clases publicadas y podés acotarla a los que más te preocupan.
          Si querés practicar una clase suelta, abrila y usá su pestaña <em>Autoevaluación</em>.
          ¿La preparan en grupo? <a href="#/student/group-practice" id="unit-practice-group-link" style="font-weight:600;">Abran la práctica compartida →</a>
        </p>
      </header>
      <div id="unit-practice-mount"></div>
    </div>
  `;

  renderAutoevaluacion(container.querySelector('#unit-practice-mount'), {
    subjectId: activeSubjectId,
    className: subjectName,
    scope: 'unit',
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
