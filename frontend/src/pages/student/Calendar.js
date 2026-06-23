/* ============================================================
   Student Calendar — Monthly grid with class detail panel
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export async function renderStudentCalendar(container) {
  renderHeader('Calendario');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando calendario...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  const [classes, deadlines] = await Promise.all([
    api.getClasses(activeSubjectId),
    api.getDeadlines(activeSubjectId),
  ]);
  const classMap = {};
  classes.forEach(c => { classMap[c.date] = c; });
  const deadlineMap = {};
  deadlines.forEach(d => {
    const key = String(d.dueDate).slice(0, 10);
    if (!deadlineMap[key]) deadlineMap[key] = [];
    deadlineMap[key].push(d);
  });

  let currentDate = new Date(2026, 2, 1); // March 2026

  const render = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    container.innerHTML = `
      <div class="calendar-wrapper">
        <div class="calendar-header">
          <button class="btn btn-ghost btn-sm" id="cal-prev">← Anterior</button>
          <h2>${MONTHS[month]} ${year}</h2>
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn btn-ghost btn-sm" id="cal-export-ics">📅 Exportar</button>
            <button class="btn btn-ghost btn-sm" id="cal-next">Siguiente →</button>
          </div>
        </div>

        <div class="calendar-grid">
          ${DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('')}
          ${Array(firstDay).fill(0).map(() => `<div class="cal-cell cal-empty"></div>`).join('')}
          ${Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const cls = classMap[dateStr];
      const dayDeadlines = deadlineMap[dateStr] || [];
      const isToday = dateStr === new Date().toISOString().split('T')[0];
      return `
              <div class="cal-cell ${cls ? 'has-class' : ''} ${isToday ? 'today' : ''}" data-date="${dateStr}" data-has-class="${!!cls}">
                <span class="cal-day-num">${day}</span>
                ${cls ? `<span class="cal-class-dot" title="${cls.title}"></span>` : ''}
                ${dayDeadlines.length > 0 ? `<span class="cal-deadline-dot" title="${dayDeadlines.map(d => d.title).join(' · ')}"></span>` : ''}
              </div>
            `;
    }).join('')}
        </div>

        <div class="calendar-legend">
          <span class="cal-legend-item"><span class="cal-class-dot"></span> Clase programada</span>
          <span class="cal-legend-item"><span class="cal-deadline-dot"></span> Deadline</span>
          <span class="cal-legend-item today-legend">Hoy</span>
        </div>
      </div>
    `;

    document.getElementById('cal-prev')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); render(); });
    document.getElementById('cal-next')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); render(); });

    container.querySelectorAll('.cal-cell[data-has-class="true"]').forEach(cell => {
      cell.addEventListener('click', () => showClassDetail(classMap[cell.dataset.date]));
    });
  };

  const showClassDetail = (cls) => {
    const existingOverlay = document.getElementById('class-detail-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'slide-panel-overlay';
    overlay.id = 'class-detail-overlay';

    const panel = document.createElement('div');
    panel.className = 'slide-panel';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6)">
        <div>
          <span class="badge badge-primary" style="margin-bottom:var(--space-2)">📅 ${new Date(cls.date + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h2 style="font-size:var(--font-size-lg);margin-top:var(--space-2)">${cls.title}</h2>
        </div>
        <button class="btn btn-icon btn-ghost" id="close-panel">✕</button>
      </div>

      <div class="section-title"><h2>Temas</h2><div class="line"></div></div>
      <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-6)">
        ${cls.topics.map(t => `<li style="display:flex;gap:var(--space-2);color:var(--color-text-secondary)"><span style="color:var(--color-primary-light)">▸</span>${t}</li>`).join('')}
      </ul>

      <div class="section-title"><h2>Materiales</h2><div class="line"></div></div>
      ${cls.materials.length === 0 ? `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">Sin materiales cargados aún.</p>` : `
        <div style="display:flex;flex-direction:column;gap:var(--space-3)">
          ${cls.materials.map(m => `
            <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);background:var(--color-surface-2);border-radius:var(--radius-md)">
              <span>${{ transcript: '📝', presentation: '📊', notes: '📓', bibliography: '📚' }[m.type]}</span>
              <span style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">${m.filename}</span>
              <span class="badge badge-success" style="margin-left:auto">✅ Listo</span>
            </div>
          `).join('')}
        </div>
      `}

      <div style="margin-top:var(--space-8)">
        <a href="#/student/chat" class="btn btn-primary" style="width:100%;justify-content:center">
          💬 Preguntar sobre esta clase
        </a>
      </div>

      ${deadlines.filter(d => d.classId === cls.id).length > 0 ? `
        <div class="section-title" style="margin-top:var(--space-8)"><h2>Deadlines</h2><div class="line"></div></div>
        <div style="display:flex;flex-direction:column;gap:var(--space-3)">
          ${deadlines.filter(d => d.classId === cls.id).map(d => `
            <div class="class-list-item" style="padding:var(--space-3) var(--space-4)">
              <div class="class-list-info">
                <div class="class-list-title">${d.title}</div>
                <div class="class-list-files">Vence ${new Date(d.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</div>
              </div>
              <span class="badge badge-warning">${d.notifyOnDayBefore ? 'Aviso previo' : 'Aviso el día'}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.getElementById('close-panel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  };

  document.getElementById('cal-export-ics')?.addEventListener('click', () => {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UADE Innova//Dashboard//ES'];
    classes.forEach(c => {
      if (!c.date) return;
      const d = c.date.slice(0, 10).replace(/-/g, '');
      lines.push('BEGIN:VEVENT');
      lines.push('DTSTART;VALUE=DATE:' + d);
      lines.push('DTEND;VALUE=DATE:' + d);
      lines.push('SUMMARY:' + c.title);
      lines.push('DESCRIPTION:Clase de ' + (c.subjectId || '') + '. Temas: ' + (c.topics || []).join(', '));
      lines.push('END:VEVENT');
    });
    deadlines.forEach(d => {
      if (!d.dueDate) return;
      const dd = d.dueDate.slice(0, 10).replace(/-/g, '');
      lines.push('BEGIN:VEVENT');
      lines.push('DTSTART;VALUE=DATE:' + dd);
      lines.push('DTEND;VALUE=DATE:' + dd);
      lines.push('SUMMARY:Entrega: ' + d.title);
      lines.push('DESCRIPTION:' + (d.description || 'Entrega de ' + d.title));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calendario-uade.ics';
    a.click();
    URL.revokeObjectURL(url);
  });

  render();
}
