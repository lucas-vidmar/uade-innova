import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// fix #352: an unreadable calendar is not an empty calendar. Report it and
// offer to retry instead of drawing a month with no marks.
function renderLoadError(container, err, onRetry) {
  const message = err && err.message ? String(err.message) : 'No pudimos cargar tu calendario.';
  container.innerHTML = `
    <div class="card">
      <div class="empty-state" style="padding:32px">
        <span class="empty-state-icon">⚠️</span>
        <p>${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        <p style="font-size:13px;color:var(--color-text-muted);max-width:520px;margin:0 auto;">
          No dibujamos el mes porque no pudimos leer tus fechas comprometidas: puede que haya vencimientos que no estás viendo.
        </p>
        <button class="btn btn-primary" id="calendar-retry">Reintentar</button>
      </div>
    </div>`;
  const btn = container.querySelector('#calendar-retry');
  if (btn) {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Reintentando...';
      onRetry();
    });
  }
}

export async function renderStudentCalendar(container) {
  renderHeader('Calendario');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando calendario...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  let classes;
  let deadlines;
  try {
    // fix #352: strict reads. A failed read must be reported, never drawn as an
    // empty month that looks like "you have no dates".
    [classes, deadlines] = await Promise.all([
      api.getClasses(activeSubjectId, { strict: true }),
      api.getDeadlines(activeSubjectId, { strict: true }),
    ]);
  } catch (err) {
    renderLoadError(container, err, () => renderStudentCalendar(container));
    return;
  }
  const classMap = {};
  classes.forEach(c => { classMap[c.date] = c; });
  const deadlineMap = {};
  deadlines.forEach(d => {
    const key = String(d.dueDate).slice(0, 10);
    if (!deadlineMap[key]) deadlineMap[key] = [];
    deadlineMap[key].push(d);
  });

  // UJ-35: la antelación y la franja horaria son de quien aprende. Un fallo de
  // lectura no debe dibujarse como "sin preferencias" (#352): se reporta y los
  // controles quedan deshabilitados en vez de mostrar un default como estado.
  let reminderPrefs = { enabled: true, cadence: 'both', timeWindow: 'any', datePrefs: {} };
  let reminderPrefsError = null;
  try {
    reminderPrefs = await api.getReminderPreferences({ strict: true });
  } catch (err) {
    reminderPrefsError = err;
  }
  let datePrefs = (reminderPrefs.datePrefs && typeof reminderPrefs.datePrefs === 'object') ? { ...reminderPrefs.datePrefs } : {};
  const timeWindow = reminderPrefs.timeWindow || 'any';
  const TIME_WINDOW_LABELS = { any: 'a cualquier hora', morning: 'por la mañana (06:00 a 12:00)', afternoon: 'por la tarde (12:00 a 19:00)', evening: 'por la noche (19:00 a 23:00)' };
  const LEAD_OPTIONS = [2, 6, 12, 24, 48, 72];
  const isWatched = (dateStr) => datePrefs[dateStr]?.watch === true;
  const watchedCount = () => Object.values(datePrefs).filter(p => p && p.watch === true).length;
  const mutedCount = () => Object.values(datePrefs).filter(p => p && p.watch === false).length;
  const leadLabel = (hours) => (hours % 24 === 0 ? `${hours / 24} día(s)` : `${hours} horas`);

  const today = new Date();
  let currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let viewMode = 'month';

  const renderDeadlineItem = (d) => `
            <div class="class-list-item" style="padding:var(--space-3) var(--space-4)">
              <div class="class-list-info">
                <div class="class-list-title">${d.title}</div>
                <div class="class-list-files">Vence ${new Date(d.dueDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</div>
              </div>
              <span class="badge badge-warning">${d.notifyOnDayBefore ? 'Aviso previo' : 'Aviso el día'}</span>
            </div>
  `;

  // fix #353: a date can carry a deadline without carrying a class, and a class
  // day can carry deadlines not linked to that class. The panel must show all
  // of the day's commitments, never claim there are none.
  const deadlinesForDay = (dateStr) => deadlineMap[dateStr] || [];
  const deadlinesForClass = (cls) => {
    const byId = new Map();
    deadlinesForDay(cls.date).forEach(d => byId.set(d.id, d));
    deadlines.filter(d => d.classId === cls.id).forEach(d => byId.set(d.id, d));
    return [...byId.values()];
  };

  // UJ-35: declarar, por fecha, si genera aviso y con cuánta antelación.
  const saveDatePref = async (dateStr, watch, leadHours) => {
    const next = { ...datePrefs };
    if (watch) {
      next[dateStr] = { watch: true };
      if (Number.isInteger(leadHours)) next[dateStr].leadHours = leadHours;
    } else {
      next[dateStr] = { watch: false };
    }
    const saved = await api.saveReminderPreferences({ datePrefs: next });
    if (!saved) return null;
    datePrefs = next;
    auth.setReminderPreferences({ timeWindow, datePrefs: next });
    return saved;
  };

  const renderDateReminderControls = (dateStr) => {
    const pref = datePrefs[dateStr] || null;
    const watch = pref ? pref.watch === true : false;
    const lead = pref && Number.isInteger(pref.leadHours) ? pref.leadHours : 24;
    const disabled = reminderPrefsError ? 'disabled' : '';
    return `
      <div class="section-title" style="margin-top:var(--space-8)"><h2>Aviso anticipado</h2><div class="line"></div></div>
      ${reminderPrefsError ? `<div style="margin-bottom:var(--space-3);padding:var(--space-3);border-radius:var(--radius);background:rgba(239,68,68,0.12);color:var(--color-error);font-size:var(--fs-sm)">No pudimos leer tus preferencias de aviso, así que no sabemos qué fechas vigilás. Recargá la página para intentar de nuevo.</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:var(--space-3)">
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="watch-date-toggle" ${watch ? 'checked' : ''} ${disabled}>
          <span style="font-size:var(--fs-sm)">Vigilar esta fecha (generar aviso anticipado)</span>
        </label>
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <span style="font-size:var(--fs-sm);color:var(--color-text-secondary)">Antelación del aviso</span>
          <select class="form-input" id="lead-hours-select" style="max-width:220px" ${watch && !reminderPrefsError ? '' : 'disabled'}>
            ${LEAD_OPTIONS.map(h => `<option value="${h}" ${lead === h ? 'selected' : ''}>${leadLabel(h)} antes</option>`).join('')}
          </select>
        </div>
        <div style="font-size:var(--fs-sm);color:var(--color-text-secondary)">
          Franja horaria: <b>${TIME_WINDOW_LABELS[timeWindow] || TIME_WINDOW_LABELS.any}</b> — el aviso anticipado de esta fecha sale dentro de esa franja, no a cualquier hora.
        </div>
        <div style="font-size:var(--fs-sm);color:var(--color-text-secondary)">
          ${pref ? (watch ? `Esta fecha genera aviso (${leadLabel(lead)} antes).` : 'Esta fecha no genera aviso.') : 'Esta fecha todavía no está declarada.'}
        </div>
        <button class="btn btn-primary btn-sm" id="save-date-pref" style="align-self:flex-start" ${disabled}>Guardar aviso de esta fecha</button>
      </div>
    `;
  };

  const bindDateReminderControls = (overlay, dateStr) => {
    const toggle = overlay.querySelector('#watch-date-toggle');
    const select = overlay.querySelector('#lead-hours-select');
    toggle?.addEventListener('change', () => { if (select) select.disabled = !toggle.checked; });
    overlay.querySelector('#save-date-pref')?.addEventListener('click', async () => {
      const watch = toggle?.checked === true;
      const leadHours = Number(select?.value);
      const saved = await saveDatePref(dateStr, watch, leadHours);
      if (saved) {
        toast('success', 'Aviso guardado', watch
          ? 'Vas a recibir el aviso anticipado de esta fecha.'
          : 'Esta fecha no va a generar aviso.');
        overlay.remove();
        render();
      } else {
        toast('error', 'No se pudo guardar', 'El servicio no confirmó el guardado del aviso de esta fecha.');
      }
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

      ${deadlinesForClass(cls).length > 0 ? `
        <div class="section-title" style="margin-top:var(--space-8)"><h2>Fechas comprometidas</h2><div class="line"></div></div>
        <div style="display:flex;flex-direction:column;gap:var(--space-3)">
          ${deadlinesForClass(cls).map(renderDeadlineItem).join('')}
        </div>
        ${renderDateReminderControls(cls.date)}
      ` : ''}
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.getElementById('close-panel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    bindDateReminderControls(overlay, cls.date);
  };

  const showDayPanel = (dateStr) => {
    const overlay = document.createElement('div');
    overlay.className = 'slide-panel-overlay';
    overlay.id = 'class-detail-overlay';

    const panel = document.createElement('div');
    panel.className = 'slide-panel';
    const d = new Date(dateStr + 'T12:00:00');
    const dayDeadlines = deadlinesForDay(dateStr);
    const heading = dayDeadlines.length === 0
      ? 'Sin clase programada'
      : (dayDeadlines.length === 1 ? 'Fecha comprometida' : 'Fechas comprometidas');
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--space-6)">
        <div>
          <span class="badge badge-primary" style="margin-bottom:var(--space-2)">📅 ${d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h2 style="font-size:var(--font-size-lg);margin-top:var(--space-2)">${heading}</h2>
        </div>
        <button class="btn btn-icon btn-ghost" id="close-panel">✕</button>
      </div>
      ${dayDeadlines.length > 0
        ? `<div style="display:flex;flex-direction:column;gap:var(--space-3)">${dayDeadlines.map(renderDeadlineItem).join('')}</div>
           ${renderDateReminderControls(dateStr)}`
        : `<p style="color:var(--color-text-muted);font-size:var(--font-size-sm)">No hay actividades registradas para esta fecha.</p>`}
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.getElementById('close-panel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    bindDateReminderControls(overlay, dateStr);
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
      ${isWatched(dateStr) ? `<span class="cal-watched-dot" title="Fecha vigilada: recibís aviso anticipado"></span>` : ''}
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
            <span class="cal-legend-item"><span class="cal-watched-dot"></span> Vigilada</span>
            <span class="cal-legend-item today-legend">Hoy</span>
          </div>

          <div class="cal-reminder-summary">
            Aviso anticipado: franja horaria ${TIME_WINDOW_LABELS[timeWindow] || TIME_WINDOW_LABELS.any} ·
            ${watchedCount()} fecha(s) vigilada(s) · ${mutedCount()} sin aviso.
            Abrí un día con fecha comprometida para elegir la antelación de esa fecha.
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
          showDayPanel(dateStr);
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
  // fix #354: every exported event must name its unit so the dates do not land
  // orphaned in the student's own calendar. `activeSubjectId` is a technical id
  // ('arq-software-2026'); the human name comes from the resolved subject list.
  const subjectName = (() => {
    const subjects = user && Array.isArray(user.subjects) ? user.subjects : [];
    const match = subjects.find(s => s && s.id === activeSubjectId);
    return (match && match.name) ? match.name : (activeSubjectId || '');
  })();
  const withUnit = (title) => subjectName ? `${title} · ${subjectName}` : title;
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
      lines.push('SUMMARY:' + escapeIcsText(withUnit(c.title || 'Clase')));
      lines.push('DESCRIPTION:' + escapeIcsText('Clase de ' + subjectName + '. Temas: ' + (c.topics || []).join(', ')));
      lines.push('END:VEVENT');
    });
    deadlines.forEach(d => {
      if (!d.dueDate) return;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${stableUid('deadline', d.id, d.dueDate)}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push('DTSTART;VALUE=DATE:' + toIcsDate(d.dueDate));
      lines.push('DTEND;VALUE=DATE:' + nextDayIcsDate(d.dueDate));
      lines.push('SUMMARY:' + escapeIcsText(withUnit('Entrega: ' + (d.title || 'Tarea'))));
      lines.push('DESCRIPTION:' + escapeIcsText('Entrega de ' + subjectName + ': ' + (d.description || d.title || '')));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  };

  // Next upcoming event across classes + deadlines (today or later).
  const nextUpcomingEvent = () => {
    const today = formatDateStr(new Date());
    const candidates = [
      ...classes.filter(c => c.date).map(c => ({ kind: 'class', date: String(c.date).slice(0, 10), title: withUnit(c.title || 'Clase'), detail: 'Clase de ' + subjectName + '. Temas: ' + (c.topics || []).join(', ') })),
      ...deadlines.filter(d => d.dueDate).map(d => ({ kind: 'deadline', date: String(d.dueDate).slice(0, 10), title: withUnit('Entrega: ' + (d.title || 'Tarea')), detail: 'Entrega de ' + subjectName + ': ' + (d.description || d.title || '') })),
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
