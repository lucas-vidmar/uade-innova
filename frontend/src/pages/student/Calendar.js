import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

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

  const today = new Date();
  let currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let viewMode = 'month';

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

  const showEmptyDay = (dateStr) => {
    const overlay = document.createElement('div');
    overlay.className = 'slide-panel-overlay';
    overlay.id = 'class-detail-overlay';

    const panel = document.createElement('div');
    panel.className = 'slide-panel';
    const d = new Date(dateStr + 'T12:00:00');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6)">
        <div>
          <span class="badge badge-primary" style="margin-bottom:var(--space-2)">📅 ${d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h2 style="font-size:var(--font-size-lg);margin-top:var(--space-2)">Sin clase programada</h2>
        </div>
        <button class="btn btn-icon btn-ghost" id="close-panel">✕</button>
      </div>
      <p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">No hay actividades registradas para esta fecha.</p>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.getElementById('close-panel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  };

  const formatDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const goToToday = () => {
    currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    render();
  };

  const renderCellEvents = (dateStr) => {
    const cls = classMap[dateStr];
    const dayDeadlines = deadlineMap[dateStr] || [];
    const hasContent = cls || dayDeadlines.length > 0;
    return `
      ${cls ? `<span class="cal-class-dot" title="${cls.title}"></span>` : ''}
      ${dayDeadlines.length > 0 ? `<span class="cal-deadline-dot" title="${dayDeadlines.map(d => d.title).join(' · ')}"></span>` : ''}
      ${!hasContent ? `<span class="cal-empty-dot"></span>` : ''}
    `;
  };

  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    return `
      <div class="cal-view-label">${MONTHS[month]} ${year}</div>
      <div class="calendar-grid">
        ${DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('')}
        ${Array(firstDay).fill(0).map(() => `<div class="cal-cell cal-empty"></div>`).join('')}
        ${Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const d = new Date(year, month, day);
      const dateStr = formatDateStr(d);
      const cls = classMap[dateStr];
      const dayDeadlines = deadlineMap[dateStr] || [];
      const isTodayDate = isSameDay(d, today);
      return `
            <div class="cal-cell ${cls ? 'has-class' : ''} ${isTodayDate ? 'today' : ''} ${dayDeadlines.length > 0 ? 'has-deadline' : ''}" data-date="${dateStr}" data-has-class="${!!cls}">
              <span class="cal-day-num">${day}</span>
              <div class="cal-cell-dots">${renderCellEvents(dateStr)}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  };

  const renderWeekView = () => {
    const dayOfWeek = currentDate.getDay();
    const monday = new Date(currentDate);
    monday.setDate(monday.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));

    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });

    const startLabel = weekDays[0].toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
    const endLabel = weekDays[6].toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });

    return `
      <div class="cal-view-label">${startLabel} — ${endLabel}</div>
      <div class="calendar-grid">
        ${DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('')}
        ${weekDays.map(d => {
      const dateStr = formatDateStr(d);
      const cls = classMap[dateStr];
      const dayDeadlines = deadlineMap[dateStr] || [];
      const isTodayDate = isSameDay(d, today);
      return `
            <div class="cal-cell ${cls ? 'has-class' : ''} ${isTodayDate ? 'today' : ''} ${dayDeadlines.length > 0 ? 'has-deadline' : ''}" data-date="${dateStr}" data-has-class="${!!cls}">
              <span class="cal-day-num">${d.getDate()}</span>
              <div class="cal-cell-dots">${renderCellEvents(dateStr)}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  };

  const renderCuatrimestreView = () => {
    const year = currentDate.getFullYear();
    const cuatrimestreMonths = [2, 3, 4, 5]; // March (2) to June (5)

    return `
      <div class="cal-view-label">Cuatrimestre — Marzo a Junio ${year}</div>
      <div class="cal-cuatrimestre-grid">
        ${cuatrimestreMonths.map(m => {
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      const firstDay = new Date(year, m, 1).getDay();
      return `
            <div class="cal-cuatrimestre-month">
              <div class="cal-cuatrimestre-month-title">${MONTHS[m]} ${year}</div>
              <div class="calendar-grid">
                ${DAYS.map(d => `<div class="cal-day-header">${d[0]}</div>`).join('')}
                ${Array(firstDay).fill(0).map(() => `<div class="cal-cell cal-empty"></div>`).join('')}
                ${Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const d = new Date(year, m, day);
          const dateStr = formatDateStr(d);
          const cls = classMap[dateStr];
          const dayDeadlines = deadlineMap[dateStr] || [];
          const isTodayDate = isSameDay(d, today);
          return `
                  <div class="cal-cell cal-cuatri-cell ${cls ? 'has-class' : ''} ${isTodayDate ? 'today' : ''} ${dayDeadlines.length > 0 ? 'has-deadline' : ''}" data-date="${dateStr}" data-has-class="${!!cls}">
                    <span class="cal-day-num">${day}</span>
                  </div>
                `;
        }).join('')}
              </div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  };

  const render = () => {
    container.innerHTML = `
      <div class="calendar-page">
        <div class="calendar-wrapper">
          <div class="calendar-header">
            <div class="cal-header-left">
              <button class="btn btn-ghost btn-sm" id="cal-prev">←</button>
              <button class="btn btn-ghost btn-sm" id="cal-today">Hoy</button>
              <button class="btn btn-ghost btn-sm" id="cal-next">→</button>
            </div>
            <div class="cal-view-tabs">
              <button class="cal-view-tab ${viewMode === 'month' ? 'active' : ''}" data-view="month">Mes</button>
              <button class="cal-view-tab ${viewMode === 'week' ? 'active' : ''}" data-view="week">Semana</button>
              <button class="cal-view-tab ${viewMode === 'cuatrimestre' ? 'active' : ''}" data-view="cuatrimestre">Cuatrimestre</button>
            </div>
            <div class="cal-header-right" style="position:relative;">
              <div class="cal-export-wrap" style="position:relative;display:inline-block;">
                <button class="btn btn-ghost btn-sm" id="cal-export-ics">📅 Exportar ▾</button>
                <div id="cal-export-menu" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:30;min-width:220px;overflow:hidden;">
                  <button class="cal-export-option" data-target="google" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;border:none;background:none;cursor:pointer;font-size:0.85rem;text-align:left;border-bottom:1px solid var(--color-border);">
                    <span>🗓️</span> Google Calendar
                  </button>
                  <button class="cal-export-option" data-target="outlook" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;border:none;background:none;cursor:pointer;font-size:0.85rem;text-align:left;border-bottom:1px solid var(--color-border);">
                    <span>📧</span> Outlook Calendar
                  </button>
                  <button class="cal-export-option" data-target="ics" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;border:none;background:none;cursor:pointer;font-size:0.85rem;text-align:left;">
                    <span>💾</span> Descargar .ics
                  </button>
                </div>
              </div>
            </div>
          </div>

          ${viewMode === 'month' ? renderMonthView() : viewMode === 'week' ? renderWeekView() : renderCuatrimestreView()}

          <div class="calendar-legend">
            <span class="cal-legend-item"><span class="cal-class-dot"></span> Clase</span>
            <span class="cal-legend-item"><span class="cal-deadline-dot"></span> Deadline</span>
            <span class="cal-legend-item today-legend">Hoy</span>
          </div>
        </div>
      </div>
    `;

    document.getElementById('cal-prev')?.addEventListener('click', () => {
      if (viewMode === 'month') { currentDate.setMonth(currentDate.getMonth() - 1); }
      else if (viewMode === 'week') { currentDate.setDate(currentDate.getDate() - 7); }
      else if (viewMode === 'cuatrimestre') { currentDate.setFullYear(currentDate.getFullYear() - 1); }
      render();
    });
    document.getElementById('cal-next')?.addEventListener('click', () => {
      if (viewMode === 'month') { currentDate.setMonth(currentDate.getMonth() + 1); }
      else if (viewMode === 'week') { currentDate.setDate(currentDate.getDate() + 7); }
      else if (viewMode === 'cuatrimestre') { currentDate.setFullYear(currentDate.getFullYear() + 1); }
      render();
    });
    document.getElementById('cal-today')?.addEventListener('click', goToToday);

    container.querySelectorAll('.cal-view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        viewMode = tab.dataset.view;
        render();
      });
    });

    container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateStr = cell.dataset.date;
        const cls = classMap[dateStr];
        if (cls) {
          showClassDetail(cls);
        } else {
          showEmptyDay(dateStr);
        }
      });
    });

    container.querySelectorAll('.cal-export-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = btn.dataset.target;
        document.getElementById('cal-export-menu').style.display = 'none';
        if (target === 'ics') {
          downloadIcs();
          return;
        }
        // Fix #339: the old bulk URLs embedded the whole ICS text in
        // outlook.live.com/calendar/0/import/<ics> (HTTP 400) and in Google's
        // ?cid= (which expects a feed URL, not ICS text). Export a per-event
        // compose/deeplink for the next upcoming event instead; with no
        // upcoming events fall back to the working .ics download.
        const next = nextUpcomingEvent();
        if (!next) {
          downloadIcs();
          toast('info', 'Sin próximos eventos', 'No hay eventos futuros: se descargó el calendario completo en .ics.');
          return;
        }
        if (target === 'google') {
          window.open(buildGoogleTemplateUrl(next), '_blank', 'noopener');
        } else if (target === 'outlook') {
          window.open(buildOutlookComposeUrl(next), '_blank', 'noopener');
        }
      });
    });

    container.querySelector('#cal-export-ics')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('cal-export-menu');
      if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
  };

  // ── Calendar export helpers (fix #339: RFC 5545 + valid provider URLs) ──
  const dtStamp = () => new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  // RFC 5545 TEXT escaping: backslash, semicolon, comma, newline.
  const escapeIcsText = (s) => String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
  const toIcsDate = (iso) => String(iso).slice(0, 10).replace(/-/g, '');
  // All-day VEVENTs use exclusive DTEND, so DTEND is the day AFTER DTSTART.
  const nextDayIcsDate = (iso) => {
    const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };
  const stableUid = (prefix, id, date) => {
    const seed = `${prefix}-${id || date || 'event'}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
    return `${h.toString(16)}-${toIcsDate(date || '') || 'nodate'}@uade-innova`;
  };

  const buildIcs = () => {
    const stamp = dtStamp();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UADE Innova//Dashboard//ES'];
    classes.forEach(c => {
      if (!c.date) return;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${stableUid('class', c.id, c.date)}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push('DTSTART;VALUE=DATE:' + toIcsDate(c.date));
      lines.push('DTEND;VALUE=DATE:' + nextDayIcsDate(c.date));
      lines.push('SUMMARY:' + escapeIcsText(c.title || 'Clase'));
      lines.push('DESCRIPTION:' + escapeIcsText('Clase de ' + (c.subjectId || '') + '. Temas: ' + (c.topics || []).join(', ')));
      lines.push('END:VEVENT');
    });
    deadlines.forEach(d => {
      if (!d.dueDate) return;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${stableUid('deadline', d.id, d.dueDate)}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push('DTSTART;VALUE=DATE:' + toIcsDate(d.dueDate));
      lines.push('DTEND;VALUE=DATE:' + nextDayIcsDate(d.dueDate));
      lines.push('SUMMARY:' + escapeIcsText('Entrega: ' + (d.title || 'Tarea')));
      lines.push('DESCRIPTION:' + escapeIcsText(d.description || 'Entrega de ' + (d.title || '')));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  // Next upcoming event across classes + deadlines (today or later).
  const nextUpcomingEvent = () => {
    const today = formatDateStr(new Date());
    const candidates = [
      ...classes.filter(c => c.date).map(c => ({ kind: 'class', date: String(c.date).slice(0, 10), title: c.title || 'Clase', detail: 'Clase de ' + (c.subjectId || '') + '. Temas: ' + (c.topics || []).join(', ') })),
      ...deadlines.filter(d => d.dueDate).map(d => ({ kind: 'deadline', date: String(d.dueDate).slice(0, 10), title: 'Entrega: ' + (d.title || 'Tarea'), detail: d.description || '' })),
    ].filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    return candidates[0] || null;
  };

  const buildGoogleTemplateUrl = (ev) => {
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: ev.title,
      dates: `${toIcsDate(ev.date)}/${nextDayIcsDate(ev.date)}`,
      details: ev.detail || '',
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };
  const buildOutlookComposeUrl = (ev) => {
    const params = new URLSearchParams({
      subject: ev.title,
      startdt: `${ev.date}T09:00:00`,
      enddt: `${ev.date}T10:00:00`,
      body: ev.detail || '',
      allday: 'true',
    });
    return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
  };

  const downloadIcs = () => {
    const blob = new Blob([buildIcs()], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calendario-uade.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('cal-export-menu');
    if (menu && !e.target.closest('.cal-export-wrap')) menu.style.display = 'none';
  });

  // Fix #346 (modal leak): navigating away must not leave the class-detail
  // slide-panel overlay mounted over the next route.
  window.addEventListener('hashchange', () => {
    document.getElementById('class-detail-overlay')?.remove();
  });

  render();
}
