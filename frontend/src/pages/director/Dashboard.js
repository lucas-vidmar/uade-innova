/* ============================================================
   Director Dashboard — Academic metrics, adoption & early alerts
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { renderRiskBreakdownHTML } from '../../components/risk-breakdown.js';

let _ragChartWindow = 30;

export async function renderDirectorDashboard(container) {
    renderHeader('Panel Directivo');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando datos directivos...</div>`;
    let _kpiData = null;

    const [rawData, rawMetrics, rawSafety] = await Promise.all([
        api.getDirectorStats().catch(() => null),
        api.getDirectorPowerBiMetrics(60).catch(() => null),
        api.getSafetyRate(null, 30).catch(() => null),
    ]);
    const data = rawData || {};
    const powerBiMetrics = rawMetrics;
    const safetyRate = rawSafety;

    const wausBySubject = data.wausBySubject || [];
    const materialUploads = data.materialUploads || { byTeacher: [] };
    const totalInteractions = data.ragInteractions || 0;
    const ragDailyData = (powerBiMetrics?.daily || []).map(d => ({
        date: d.date,
        count: d.ragInteractions || 0,
    })).sort((a, b) => a.date.localeCompare(b.date));

    // #467: sólo los conteos de riesgo. Los cortes de asistencia y promedio no
    // tienen fuente (la integración con el sistema académico no existe) y ya no
    // se muestran: un 0 fijo se leía como "nadie en riesgo".
    const defaultEarlyAlertSummary = {
        totalStudentsAtRisk: 0, highRiskCount: 0, mediumRiskCount: 0,
    };
    const earlyAlertSummary = { ...defaultEarlyAlertSummary, ...(data.earlyAlertSummary || {}) };
    _kpiData = data;

    // #419 (UJ-43): "Clases cargadas" y "Clases procesadas" informaban el mismo
    // número (totalClasses) y la segunda métrica no distinguía nada. El conteo
    // de procesadas sale del criterio acordado y se declara junto al número; si
    // el servidor no lo informa, se dice que no es calculable en vez de repetir
    // el total.
    const processedClasses = Number.isFinite(Number(data.processedClasses)) ? Number(data.processedClasses) : null;
    const processedClassesKnown = processedClasses !== null;
    const processedClassesNotComputable = Number.isFinite(Number(data.processedClassesNotComputable))
        ? Number(data.processedClassesNotComputable)
        : 0;
    const processedClassesCriteria = data.processedClassesCriteria
        || 'Clase procesada: tiene al menos una síntesis o un mapa avalado por el docente. Una clase con material cargado pero sin derivado avalado cuenta como cargada, no como procesada.';

    // #491 (UJ-43 / DI-01): lectura de adopción desagregada por unidad, sede y
    // carrera. Cada dimensión llega con su propio total desde el servidor; acá
    // sólo se pinta. Si el servidor no la informa, se declara — no se rellena.
    const adoptionDimensions = data.adoptionByDimension || null;
    const adoptionGaps = Array.isArray(data.adoptionGaps) ? data.adoptionGaps : [];
    const adoptionCriteria = data.adoptionCriteria || '';
    const adoptionIntegrity = data.adoptionIntegrity || null;
    const adoptionRateKnown = data.adoptionRate !== null && data.adoptionRate !== undefined;
    const adoptionCohort = Number.isFinite(Number(data.adoptionCohort)) ? Number(data.adoptionCohort) : null;

    container.innerHTML = `
    <!-- Export controls -->
    <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-bottom:var(--space-4)" id="kpi-export-bar">
      <button class="btn btn-secondary btn-sm" id="btn-export-csv" style="display:inline-flex;align-items:center;gap:var(--space-2)">
        <span>&#x2193;</span> Exportar CSV
      </button>
      <button class="btn btn-secondary btn-sm" id="btn-export-pdf" style="display:inline-flex;align-items:center;gap:var(--space-2)">
        <span>&#x2193;</span> Exportar PDF
      </button>
    </div>

    <!-- Tasa Fallo Seguro card -->
    <div class="card" id="safety-rate-card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('shield')} Tasa Fallo Seguro</span>
        <span class="badge ${safetyRate?.status === 'red' ? 'badge-error' : safetyRate?.status === 'yellow' ? 'badge-warning' : 'badge-success'}">${safetyRate?.status ? statusLabel(safetyRate.status) : 'Sin datos'}</span>
      </div>
      <div class="grid-4" style="margin-bottom:var(--space-2)">
        <div class="kpi-card" id="safety-rate-percent">
          <div class="kpi-label">Completado seguro</div>
          <div class="kpi-value" style="color:${safetyColor(safetyRate?.safetyRatePercent)}">${safetyRate ? formatPercent(safetyRate.safetyRatePercent) : '-'}</div>
          ${renderTrendArrow(safetyRate?.trend)}
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Solicitudes RAG</div>
          <div class="kpi-value">${safetyRate?.totalRequests ?? '-'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Bloqueos por seguridad</div>
          <div class="kpi-value">${safetyRate?.blockedBySafety ?? '-'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Fallos categorizados</div>
          <div class="kpi-value">${safetyRate?.errorCategorizedFailures ?? '-'}</div>
        </div>
      </div>
      <small style="display:block;color:var(--color-text-secondary)">
        Fuente: SessionMetrics + RAGErrorEvents · Ventana 30d · Actualizado: ${safetyRate?.updatedAt ? new Date(safetyRate.updatedAt).toLocaleString('es-AR') : 'n/a'}
      </small>
    </div>

    <!-- KPIs row -->
    <div class="grid-4" style="margin-bottom:var(--space-4)">
      <div class="kpi-card">
        <div class="kpi-label">Usuarios activos (hoy)</div>
        <div class="kpi-value">${data.dau || 0}</div>
        <span class="kpi-delta positive">${data.dauDelta || '0%'}</span>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Clases cargadas</div>
        <div class="kpi-value">${data.totalClasses || 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Clases procesadas</div>
        <div class="kpi-value">${processedClassesKnown ? processedClasses : '—'}</div>
        <small id="kpi-classes-processed-criteria" style="display:block;margin-top:var(--space-2);font-size:11px;line-height:1.4;color:var(--color-text-secondary)">${escapeHtml(processedClassesCriteria)}</small>
        ${processedClassesKnown ? '' : '<small style="display:block;margin-top:var(--space-1);font-size:11px;color:var(--color-warning)">El servidor no informa este conteo: no calculable.</small>'}
        ${processedClassesNotComputable > 0 ? `<small style="display:block;margin-top:var(--space-1);font-size:11px;color:var(--color-text-muted)">${processedClassesNotComputable} clase(s) sin dato suficiente: no se cuentan.</small>` : ''}
      </div>
      <div class="kpi-card" id="kpi-adopcion-global">
        <div class="kpi-label">Adopción global</div>
        <div class="kpi-value" style="color:var(--color-primary-light)">${adoptionRateKnown ? `${data.adoptionRate}%` : '—'}</div>
        ${adoptionRateKnown ? `
        <div class="progress-bar" style="margin-top:var(--space-2)">
          <div class="progress-fill" style="--progress-value:${data.adoptionRate}%"></div>
        </div>` : `
        <small style="display:block;margin-top:var(--space-2);font-size:11px;color:var(--color-warning)">Sin cohorte sobre la que calcular: no calculable.</small>`}
        ${adoptionCohort !== null ? `<small style="display:block;margin-top:var(--space-1);font-size:11px;color:var(--color-text-secondary)">Cohorte: ${adoptionCohort} matrícula(s) activa(s)</small>` : ''}
      </div>
    </div>

    <!-- #491 (UJ-43): lectura de adopción desagregada por unidad, sede y carrera -->
    ${renderAdoptionDimensions({
        dimensions: adoptionDimensions,
        gaps: adoptionGaps,
        criteria: adoptionCriteria,
        integrity: adoptionIntegrity,
        windowDays: data.adoptionWindowDays,
        rateKnown: adoptionRateKnown,
    })}

    <!-- Class views summary row -->
    <div class="grid-2" style="margin-bottom:var(--space-8)">
      <div class="card">
        <div class="card-header">
          <span class="card-title">${icon('book')} Visualización de Clases</span>
          <span class="badge badge-info">Resumen</span>
        </div>
        <div style="padding:var(--space-4)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)">
            <div class="kpi-card" style="margin:0">
              <div class="kpi-label">Clases vistas</div>
              <div class="kpi-value" id="kpi-classes-viewed" title="Sin datos de visualización en el período.">s/d</div>
            </div>
            <div class="kpi-card" style="margin:0">
              <div class="kpi-label">Alumnos que vieron</div>
              <div class="kpi-value" id="kpi-students-viewed" title="Sin datos de visualización en el período.">s/d</div>
            </div>
            <div class="kpi-card" style="margin:0;grid-column:1/-1">
              <div class="kpi-label">Clases por alumno (promedio)</div>
              <div class="kpi-value" id="kpi-avg-per-student" title="Sin datos de visualización en el período.">s/d</div>
            </div>
          </div>
        </div>
      </div>

      <!-- RAG interactions temporal chart -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">${icon('chart')} Interacciones RAG</span>
          <span class="badge badge-info">${totalInteractions} totales</span>
        </div>
        <div style="padding:var(--space-3)">
          <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3)" id="rag-chart-filters">
            <button class="btn btn-sm ${_ragChartWindow === 7 ? 'btn-primary' : 'btn-secondary'}" data-rag-window="7">7 d&iacute;as</button>
            <button class="btn btn-sm ${_ragChartWindow === 15 ? 'btn-primary' : 'btn-secondary'}" data-rag-window="15">15 d&iacute;as</button>
            <button class="btn btn-sm ${_ragChartWindow === 30 ? 'btn-primary' : 'btn-secondary'}" data-rag-window="30">30 d&iacute;as</button>
            <button class="btn btn-sm ${_ragChartWindow === 60 ? 'btn-primary' : 'btn-secondary'}" data-rag-window="60">60 d&iacute;as</button>
          </div>
          <div style="position:relative">
            <canvas id="rag-interactions-chart" style="width:100%;height:200px;display:block"></canvas>
          </div>
        </div>
      </div>
    </div>

    <!-- Material upload frequency by teacher -->
    ${materialUploads.byTeacher.length > 0 ? `
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('book')} Actividad Docente — Carga de Materiales</span>
        <span class="badge badge-info">${materialUploads.byTeacher.length} docentes</span>
      </div>
      <div class="table-wrap">
        <table class="data-table" id="teacher-uploads-table">
          <thead>
            <tr>
              <th data-sort="teacherId">Docente</th>
              <th data-sort="transcripts" class="sortable">Transcripciones</th>
              <th data-sort="presentations" class="sortable">Presentaciones</th>
              <th data-sort="notes" class="sortable">Apuntes</th>
              <th data-sort="bibliography" class="sortable">Bibliografía</th>
              <th data-sort="total" class="sortable">Total</th>
            </tr>
          </thead>
          <tbody id="teacher-uploads-body">
            ${materialUploads.byTeacher.sort((a, b) => b.total - a.total).map(t => `
              <tr>
                <td><strong>${escapeHtml(t.teacherId)}</strong></td>
                <td>${t.transcripts}</td>
                <td>${t.presentations}</td>
                <td>${t.notes}</td>
                <td>${t.bibliography}</td>
                <td><strong>${t.total}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    <div class="grid-2">
      <!-- Weekly active users by subject (bar chart) -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">${icon('book')} Usuarios Activos Semanales por Materia</span>
          <span class="badge badge-info">Piloto 2026-1</span>
        </div>
        <div style="position:relative">
          <canvas id="waus-bar-chart" style="width:100%;height:250px;display:block"></canvas>
          ${wausBySubject.length === 0 ? '<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">Sin datos semanales.</div>' : ''}
        </div>
        <div style="display:flex;gap:var(--space-4);margin-top:var(--space-3);font-size:var(--font-size-sm)">
          <span><span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:var(--color-accent);margin-right:var(--space-1)"></span>Usuarios activos esta semana</span>
        </div>
      </div>

      <!-- Early alerts -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">${icon('alert')} Alertas Tempranas (Agregado)</span>
          <span class="badge badge-error">${earlyAlertSummary.totalStudentsAtRisk} en riesgo</span>
        </div>
        <div class="table-wrap">
          <table class="data-table" id="director-alerts-aggregate-table">
            <thead><tr><th>Métrica</th><th>Valor</th></tr></thead>
            <tbody>
              <tr><td><strong>Riesgo alto</strong></td><td>${earlyAlertSummary.highRiskCount}</td></tr>
              <tr><td><strong>Riesgo medio</strong></td><td>${earlyAlertSummary.mediumRiskCount}</td></tr>
            </tbody>
          </table>
        </div>
        <!-- #467: las filas de asistencia y promedio salieron de esta tabla. No hay
             fuente que las alimente (la integración con el sistema académico no
             existe); se mostraban como 0 fijo y se leían como "nadie en riesgo". -->
        <div id="director-alerts-unsourced" style="margin-top:var(--space-3);padding:var(--space-3);border-radius:var(--radius-md);background:var(--color-surface-2);font-size:var(--font-size-xs);color:var(--color-text-secondary)">
          <strong>Asistencia y promedio: sin fuente.</strong>
          El tablero todavía no lee calificaciones ni asistencia del sistema académico, así
          que no se muestran esos cortes. Los niveles de riesgo de arriba salen sólo de
          inactividad, consultas y engagement medidos en la plataforma.
        </div>
        <small style="display:block;margin-top:var(--space-3);color:var(--color-text-secondary)">
          Vista anonimizada: no se muestran datos personales de estudiantes.
        </small>
        <div style="margin-top:var(--space-2);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
          <button class="btn btn-ghost btn-sm" id="btn-risk-breakdown-dashboard" style="font-size:0.8rem;color:var(--color-text-secondary);text-decoration:underline;cursor:pointer;border:none;background:none;padding:0;">
            &#x2139; ¿C&oacute;mo se calcula el riesgo?
          </button>
          <div style="display:flex;gap:var(--space-3)">
            <a href="#/director/interventions" style="color:var(--color-accent);text-decoration:none;font-size:0.875rem">
              Ver detalle de intervenciones &rarr;
            </a>
            <a href="#/director/compliance" style="color:var(--color-accent);text-decoration:none;font-size:0.875rem">
              Cumplimiento &rarr;
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

    // Load class views and render
    loadAndRenderClassViews(data, container);

    // Render RAG interactions chart
    renderRagInteractionChart(ragDailyData, totalInteractions);

    // Render WAUS bar chart
    if (wausBySubject.length > 0) {
        renderWausBarChart(wausBySubject);
    }

    // Table sort handlers
    const table = document.getElementById('teacher-uploads-table');
    if (table) {
        const tbody = document.getElementById('teacher-uploads-body');
        table.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                const rows = Array.from(tbody.querySelectorAll('tr'));
                const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
                table.querySelectorAll('th.sortable').forEach(h => delete h.dataset.dir);
                th.dataset.dir = dir;
                rows.sort((a, b) => {
                    const av = Number(a.querySelector(`td:nth-child(${th.cellIndex + 1})`)?.textContent || 0);
                    const bv = Number(b.querySelector(`td:nth-child(${th.cellIndex + 1})`)?.textContent || 0);
                    return dir === 'asc' ? av - bv : bv - av;
                });
                rows.forEach(r => tbody.appendChild(r));
            });
        });
    }

    // Risk breakdown modal (#341): populated with the real scoring formula
    // and the active subject's configured thresholds — never a placeholder.
    // Idempotent: renderDirectorDashboard runs on every data refresh, so drop
    // any previous instance first — otherwise duplicate IDs pile up and the
    // open-button listener ends up bound to a detached node (dead button).
    document.getElementById('risk-breakdown-dashboard-modal')?.remove();
    const riskModal = document.createElement('div');
    riskModal.className = 'modal-overlay';
    riskModal.id = 'risk-breakdown-dashboard-modal';
    riskModal.style.display = 'none';
    riskModal.innerHTML = `
      <div class="modal-content" style="max-width:640px">
        <div class="modal-header">
          <h3 style="margin:0">¿C&oacute;mo se calcula el Riesgo Acad&eacute;mico?</h3>
          <button type="button" class="btn btn-ghost btn-sm risk-breakdown-dashboard-close" aria-label="Cerrar">&times;</button>
        </div>
        <div class="modal-body" id="risk-breakdown-dashboard-body"><div class="animate-pulse">Cargando umbrales...</div></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary risk-breakdown-dashboard-close">Cerrar</button>
        </div>
      </div>
    `;
    document.body.appendChild(riskModal);

    const closeRiskModal = () => { riskModal.style.display = 'none'; };
    riskModal.querySelectorAll('.risk-breakdown-dashboard-close').forEach(btn => {
      btn.addEventListener('click', closeRiskModal);
    });
    riskModal.addEventListener('click', (e) => { if (e.target === riskModal) closeRiskModal(); });

    async function refreshRiskBreakdownBody() {
      const body = document.getElementById('risk-breakdown-dashboard-body');
      if (!body) return;
      let thresholds = {};
      let scopeLabel = null;
      try {
        const activeSubjectId = auth.getActiveSubjectId();
        const res = await api.getRiskThresholds(activeSubjectId || undefined);
        const payload = res?.success ? res.data : null;
        // getRiskThresholds returns { subjectId, thresholds, source } when a
        // subjectId is given, or { thresholds: {...all}, defaults } without it.
        thresholds = payload?.thresholds && !Array.isArray(payload.thresholds)
          && typeof payload.thresholds === 'object' && !payload.defaults
          ? payload.thresholds
          : (payload?.defaults || {});
        scopeLabel = payload?.subjectId || activeSubjectId || null;
        if (payload?.source === 'default' && scopeLabel) scopeLabel += ' (valores por defecto)';
      } catch {
        thresholds = {};
      }
      body.innerHTML = renderRiskBreakdownHTML(thresholds, scopeLabel);
    }

    // Delegated (registered once): the dashboard container re-renders on data
    // refresh, which would detach a directly-bound button listener.
    if (!window.__riskBreakdownDashboardDelegated) {
      window.__riskBreakdownDashboardDelegated = true;
      document.addEventListener('click', (e) => {
        if (e.target?.closest?.('#btn-risk-breakdown-dashboard')) {
          document.getElementById('risk-breakdown-dashboard-modal').style.display = 'flex';
          refreshRiskBreakdownBody();
        }
      });
    }

    // RAG chart filter buttons
    document.querySelectorAll('[data-rag-window]').forEach(btn => {
      btn.addEventListener('click', () => {
        _ragChartWindow = parseInt(btn.dataset.ragWindow, 10);
        document.querySelectorAll('[data-rag-window]').forEach(b => b.className = `btn btn-sm btn-secondary`);
        btn.className = `btn btn-sm btn-primary`;
        renderRagInteractionChart(ragDailyData, totalInteractions);
      });
    });

    // Export button handlers
    document.getElementById('btn-export-csv')?.addEventListener('click', () => handleExportCsv(_kpiData));
    document.getElementById('btn-export-pdf')?.addEventListener('click', () => handleExportPdf(_kpiData));
}

// ── Load class view data and update KPIs ─────────────────────
// Fix #346: the KPI showed a bare "-" when the period had no views (or the
// read failed), which reads as a broken value. The rest of the product uses
// "s/d" (sin datos); the value now says that and carries the reason.
const NO_DATA_VALUE = 's/d';
const NO_DATA_HINT = 'Sin datos de visualización en el período.';

function setClassViewKpi(id, value, hint = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  if (hint) {
    el.setAttribute('title', hint);
    el.setAttribute('aria-label', `${hint} ${value}`);
  } else {
    el.removeAttribute('title');
    el.removeAttribute('aria-label');
  }
}

async function loadAndRenderClassViews(data, container) {
  let subjects = (auth.getUser().subjects || []).filter(s => s.id);
  if (subjects.length === 0) {
    try { subjects = (await api.getSubjects()) || []; } catch (e) { /* ignore */ }
  }
  if (subjects.length === 0) {
    setClassViewKpi('kpi-classes-viewed', NO_DATA_VALUE, NO_DATA_HINT);
    setClassViewKpi('kpi-students-viewed', NO_DATA_VALUE, NO_DATA_HINT);
    setClassViewKpi('kpi-avg-per-student', NO_DATA_VALUE, NO_DATA_HINT);
    return;
  }

  try {
    const results = await Promise.allSettled(
      subjects.map(s => api.getClassViews(s.id || s.subjectId).catch(() => []))
    );

    let totalViewedClasses = 0;
    const allStudents = new Set();
    const allClassIds = new Set();

    results.forEach((result) => {
      const views = result.status === 'fulfilled' ? result.value : [];
      views.forEach(v => {
        if (v.studentId) allStudents.add(v.studentId);
        if (v.classId) allClassIds.add(v.classId);
      });
    });
    totalViewedClasses = allClassIds.size;

    setClassViewKpi('kpi-classes-viewed', totalViewedClasses);
    setClassViewKpi('kpi-students-viewed', allStudents.size);
    const avg = allStudents.size > 0 ? (totalViewedClasses / allStudents.size).toFixed(1) : null;
    setClassViewKpi('kpi-avg-per-student', avg ?? NO_DATA_VALUE, avg ? null : NO_DATA_HINT);
  } catch (err) {
    console.error('[Director Dashboard] Error loading class views:', err);
    setClassViewKpi('kpi-avg-per-student', NO_DATA_VALUE, 'No se pudieron leer las visualizaciones.');
  }
}

// ── Render RAG Interaction temporal chart (Canvas) ──────────
function renderRagInteractionChart(ragDailyData, totalInteractions) {
  const canvas = document.getElementById('rag-interactions-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement?.getBoundingClientRect();
  const width = rect?.width || 400;
  if (width <= 0) return;
  canvas.width = width * dpr;
  canvas.height = 220 * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = '220px';
  ctx.scale(dpr, dpr);
  const W = width;
  const H = 220;

  const days = _ragChartWindow;
  const padL = 48, padR = 12, padT = 24, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Build daily values from real data within the window
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);

  const points = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const match = ragDailyData.find(r => r.date === dateStr);
    points.push(match ? match.count : 0);
  }

  const maxVal = Math.max(...points, 1);

  ctx.clearRect(0, 0, W, H);

  // Grid lines (horizontal, 4 lines)
  ctx.strokeStyle = 'rgba(128,128,128,0.12)';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const y = padT + (chartH / 3) * i;
    const val = Math.round(maxVal - (maxVal / 3) * i);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    // Y-axis label
    ctx.fillStyle = 'rgba(128,128,128,0.5)';
    ctx.fillText(String(val), padL - 4, y + 3);
  }

  // Y-axis title
  ctx.save();
  ctx.translate(8, padT + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(128,128,128,0.45)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Cantidad de consultas', 0, 0);
  ctx.restore();

  // Line chart
  ctx.strokeStyle = '#0077AB';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((val, i) => {
    const x = padL + (i / Math.max(days - 1, 1)) * chartW;
    const y = padT + chartH - (val / maxVal) * chartH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill area under the line
  const lastIdx = points.length - 1;
  ctx.lineTo(padL + (lastIdx / Math.max(days - 1, 1)) * chartW, padT + chartH);
  ctx.lineTo(padL, padT + chartH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,119,171,0.08)';
  ctx.fill();

  // Dots + x-axis date labels
  const labelStep = Math.max(1, Math.floor(days / 6));
  points.forEach((val, i) => {
    const x = padL + (i / Math.max(days - 1, 1)) * chartW;
    const y = padT + chartH - (val / maxVal) * chartH;
    ctx.fillStyle = '#0077AB';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (i % labelStep === 0) {
      const d = new Date(cutoff);
      d.setDate(d.getDate() + i);
      const label = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
      ctx.fillStyle = 'rgba(128,128,128,0.6)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, H - padB + 14);
    }
  });

}

// ── KPI Export handlers ─────────────────────────────────────
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildKpiCsv(data) {
  const lines = [];
  const push = (s, m, v) => lines.push(`${s},${m},${v}`);
  lines.push('seccion,metrica,valor');
  push('General','Usuarios activos (hoy)', data.dau || 0);
  push('General','Clases cargadas', data.totalClasses || 0);
  // #419: cada tarjeta con su propio número, y el criterio declarado en el archivo.
  push('General','Clases procesadas', Number.isFinite(Number(data.processedClasses)) ? Number(data.processedClasses) : 'no calculable');
  if (Number(data.processedClassesNotComputable) > 0) {
    push('General','Clases procesadas no calculables', Number(data.processedClassesNotComputable));
  }
  push('General','Criterio de clases procesadas', '"' + String(data.processedClassesCriteria || '').replace(/"/g, '""') + '"');
  push('General','Interacciones RAG', data.ragInteractions || 0);
  push('General','Adopcion global', (data.adoptionRate || 0) + '%');
  lines.push('');
  const ea = data.earlyAlertSummary || {};
  push('Alertas','Total en riesgo', ea.totalStudentsAtRisk || 0);
  push('Alertas','Riesgo alto', ea.highRiskCount || 0);
  push('Alertas','Riesgo medio', ea.mediumRiskCount || 0);
  // #467: asistencia y promedio no tienen fuente; no se exportan cortes vacíos.
  push('Alertas','Asistencia y promedio','sin fuente');
  lines.push('');
  lines.push('seccion,materia,semana_actual');
  (data.wausBySubject || []).forEach(s => push('WAUS', s.subjectName || s.subjectId, s.currentWeek || 0));
  lines.push('');
  // #491 (UJ-43): mismas dimensiones que el panel, cada una con su total.
  const dimensions = data.adoptionByDimension || null;
  if (dimensions) {
    lines.push('seccion,dimension,corte,cohorte,con_uso,tasa_pct');
    for (const name of ['subject', 'campus', 'track']) {
      const dimension = dimensions[name];
      if (!dimension) continue;
      (dimension.rows || []).forEach(row => {
        const rate = row.rate === null || row.rate === undefined ? 'no calculable' : `${row.rate}%`;
        lines.push(`Adopcion,${dimension.label || name},"${String(row.label || row.key).replace(/"/g, '""')}",${row.cohort},${row.active},${rate}`);
      });
      if (dimension.total) {
        const rate = dimension.total.rate === null || dimension.total.rate === undefined ? 'no calculable' : `${dimension.total.rate}%`;
        lines.push(`Adopcion,${dimension.label || name},TOTAL,${dimension.total.cohort},${dimension.total.active},${rate}`);
      }
    }
    lines.push('');
    lines.push('seccion,hueco,detalle');
    (data.adoptionGaps || []).forEach(gap => lines.push(`Huecos de la lectura,${gap.reason || ''},"${String(gap.detail || '').replace(/"/g, '""')}"`));
    lines.push('');
  }
  lines.push('seccion,docente,transcripciones,presentaciones,apuntes,bibliografia,total');
  (data.materialUploads?.byTeacher || []).forEach(t => {
    push('Carga de materiales', t.teacherId, `${t.transcripts||0},${t.presentations||0},${t.notes||0},${t.bibliography||0},${t.total||0}`);
  });
  lines.push('');
  lines.push(`generado_en,${new Date().toISOString()}`);
  return lines.join('\n');
}

async function handleExportCsv(data) {
  const btn = document.getElementById('btn-export-csv');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span>&#x21bb;</span> Exportando...';
  try {
    const blob = await api.getDirectorKpiExport('csv');
    if (blob) {
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `kpi-snapshot-${date}.csv`);
    } else {
      const csv = buildKpiCsv(data);
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `kpi-snapshot-${new Date().toISOString().slice(0, 10)}.csv`);
    }
  } catch (err) {
    console.error('[Dashboard] CSV export error:', err);
    const csv = buildKpiCsv(data);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `kpi-snapshot-${new Date().toISOString().slice(0, 10)}.csv`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>&#x2193;</span> Exportar CSV';
  }
}

async function handleExportPdf(data) {
  const btn = document.getElementById('btn-export-pdf');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span>&#x21bb;</span> Exportando...';
  const filename = `kpi-snapshot-${new Date().toISOString().slice(0, 10)}.html`;
  try {
    // #341: never use window.open + print() here — popup blockers and the
    // Orca embedded browser hang on the orphaned tab. The backend answers
    // format=pdf with a printable HTML report, so download it as a file
    // (the user prints it to PDF from the browser) instead of opening a tab.
    const blob = await api.getDirectorKpiExport('pdf');
    if (blob) {
      downloadBlob(blob, filename);
    } else {
      downloadBlob(new Blob([buildPrintHtml(data)], { type: 'text/html;charset=utf-8' }), filename);
    }
  } catch (err) {
    console.error('[Dashboard] PDF export error:', err);
    downloadBlob(new Blob([buildPrintHtml(data)], { type: 'text/html;charset=utf-8' }), filename);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>&#x2193;</span> Exportar PDF';
  }
}

function buildPrintHtml(data) {
  const t = (v) => String(v ?? '');
  const ea = data.earlyAlertSummary || {};
  // #491 (UJ-43): el reporte imprimible lleva los mismos tres cortes del panel.
  const admissionRate = (value) => (value === null || value === undefined ? 'no calculable' : `${value}%`);
  const adoptionSection = (() => {
    const dimensions = data.adoptionByDimension;
    if (!dimensions) return '';
    return ['subject', 'campus', 'track'].map((name) => {
      const dimension = dimensions[name];
      if (!dimension) return '';
      const rows = (dimension.rows || []).map((row) =>
        `<tr><td>${t(row.label)}${row.unassigned ? ' (sin dato)' : ''}</td><td>${row.cohort}</td><td>${row.active}</td><td>${admissionRate(row.rate)}</td></tr>`
      ).join('');
      const total = dimension.total
        ? `<tr><th>${t(dimension.total.label || 'Total')}</th><th>${dimension.total.cohort}</th><th>${dimension.total.active}</th><th>${admissionRate(dimension.total.rate)}</th></tr>`
        : '';
      return `<h2>Adopci&oacute;n por ${t(String(dimension.label || name).toLowerCase())}</h2>
        <table><thead><tr><th>Corte</th><th>Cohorte</th><th>Con uso</th><th>Tasa</th></tr></thead><tbody>${rows}${total}</tbody></table>`;
    }).join('');
  })();
  const adoptionGaps = (data.adoptionGaps || []).map((gap) =>
    `<li><strong>${t(gap.dimension)}</strong>: ${t(gap.detail || gap.reason)}</li>`
  ).join('');
  const wausRows = (data.wausBySubject || []).map(s =>
    `<tr><td>${t(s.subjectName || s.subjectId)}</td><td>${s.currentWeek || 0}</td></tr>`
  ).join('');
  const materialRows = (data.materialUploads?.byTeacher || []).map(tm =>
    `<tr><td>${t(tm.teacherId)}</td><td>${tm.transcripts||0}</td><td>${tm.presentations||0}</td><td>${tm.notes||0}</td><td>${tm.bibliography||0}</td><td>${tm.total||0}</td></tr>`
  ).join('');

  // Client-side printable report (#341 fallback): returned as a string so the
  // caller downloads it as a file. No window.open — popup-based printing
  // hangs the Orca embedded browser.
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>KPIs - Dashboard Directivo</title>
<style>
  @page { margin: 15mm; }
  body { font-family: helvetica, arial, sans-serif; font-size: 11pt; color: #1a1a2e; }
  h1 { font-size: 18pt; border-bottom: 2px solid #0077AB; padding-bottom: 4px; }
  h2 { font-size: 14pt; margin-top: 20px; color: #0077AB; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { text-align: left; padding: 4px 8px; border: 1px solid #ccc; }
  th { background: #f0f4f8; font-weight: 600; font-size: 10pt; }
  td { font-size: 10pt; }
  .kpi-grid { display: flex; gap: 12px; flex-wrap: wrap; margin: 10px 0; }
  .kpi-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 14px; min-width: 140px; }
  .kpi-value { font-size: 16pt; font-weight: 700; color: #0077AB; }
  .kpi-label { font-size: 9pt; color: #64748b; }
  .footer { margin-top: 24px; font-size: 9pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
</style></head>
<body>
  <h1>Dashboard Directivo — KPIs</h1>
  <p>Generado: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</p>
  <h2>M&eacute;tricas Generales</h2>
  <div class="kpi-grid">
    <div class="kpi-item"><div class="kpi-value">${t(data.dau)}</div><div class="kpi-label">Usuarios activos (hoy)</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.totalClasses)}</div><div class="kpi-label">Clases cargadas</div></div>
    <div class="kpi-item"><div class="kpi-value">${Number.isFinite(Number(data.processedClasses)) ? t(data.processedClasses) : 'no calculable'}</div><div class="kpi-label">Clases procesadas</div><div class="kpi-note">${t(data.processedClassesCriteria || '')}</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.ragInteractions)}</div><div class="kpi-label">Interacciones RAG</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.adoptionRate)}%</div><div class="kpi-label">Adopci&oacute;n global</div></div>
  </div>
  <h2>Alertas Tempranas</h2>
  <table><thead><tr><th>M&eacute;trica</th><th>Valor</th></tr></thead>
  <tbody>
    <tr><td>Total en riesgo</td><td>${t(ea.totalStudentsAtRisk)}</td></tr>
    <tr><td>Riesgo alto</td><td>${t(ea.highRiskCount)}</td></tr>
    <tr><td>Riesgo medio</td><td>${t(ea.mediumRiskCount)}</td></tr>
    <tr><td>Asistencia y promedio</td><td>sin fuente</td></tr>
  </tbody></table>
  ${adoptionSection}
  ${adoptionGaps ? `<h2>Huecos de la lectura</h2><ul style="font-size:9pt;color:#64748b">${adoptionGaps}</ul>` : ''}
  <div class="footer">Datos anonimizados, sin PII.</div>
</body></html>`;
}

function renderWausBarChart(wausBySubject) {
    const canvas = document.getElementById('waus-bar-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement?.getBoundingClientRect();
    const width = rect?.width || 400;
    if (width <= 0) return;
    canvas.width = width * dpr;
    canvas.height = 250 * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = '250px';
    ctx.scale(dpr, dpr);
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    const data = wausBySubject;
    const barGap = data.length > 10 ? 6 : data.length > 5 ? 10 : 16;
    const barW = Math.max(8, ((W - 50 - 20 - (data.length - 1) * barGap) / data.length));
    const maxVal = Math.max(...data.map(d => d.currentWeek), 1);

    ctx.clearRect(0, 0, W, H);
    const padL = 50, padR = 10, padT = 10, padB = 30;

    data.forEach((d, i) => {
        const groupX = 50 + i * (barW + barGap);

        // Current week bar only
        const currH = (d.currentWeek / maxVal) * (H - padT - padB);
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#6366f1';
        ctx.fillStyle = accentColor;
        ctx.fillRect(groupX, H - padB - currH, barW, currH);

        // Value on top of bar
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(d.currentWeek), groupX + barW / 2, H - padB - currH - 4);

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px monospace';
        const name = d.subjectName?.length > 14 ? d.subjectName?.slice(0, 12) + '...' : d.subjectName || d.subjectId;
        ctx.fillText(name, groupX + barW / 2, H - 4);
    });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

/**
 * #491 (UJ-43 / DI-01): pintado de la lectura de adopción por unidad, sede y
 * carrera. Cada dimensión trae su propio total del servidor y se muestra tal
 * cual: la fila «sin declarar» no se esconde y los huecos se listan debajo.
 */
function renderAdoptionDimensions({ dimensions, gaps = [], criteria = '', integrity = null, windowDays = null, rateKnown = true } = {}) {
  const label = 'Adopción por unidad, sede y carrera';
  if (!dimensions) {
    return `
    <div class="card" id="director-adoption-dimensions" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('chart')} ${label}</span>
        <span class="badge badge-warning">Sin datos</span>
      </div>
      <div style="padding:var(--space-4);color:var(--color-text-secondary);font-size:var(--font-size-sm)">
        El servidor no informa la lectura desagregada por unidad, sede y carrera: no hay corte que mostrar.
      </div>
    </div>`;
  }

  const order = ['subject', 'campus', 'track'];
  const dimensionCard = (key) => {
    const dimension = dimensions[key];
    if (!dimension) return '';
    const rows = Array.isArray(dimension.rows) ? dimension.rows : [];
    const total = dimension.total || null;
    const rate = (value) => (value === null || value === undefined ? '—' : `${value}%`);
    const body = rows.length === 0
      ? `<tr><td colspan="4" style="color:var(--color-text-secondary)">Sin cortes en esta dimensión.</td></tr>`
      : rows.map((row) => `
          <tr data-adoption-row="${escapeHtml(row.key)}"${row.unassigned ? ' class="adoption-unassigned"' : ''}>
            <td>${escapeHtml(row.label)}${row.unassigned ? ' <span class="badge badge-warning" style="font-size:10px">sin dato</span>' : ''}</td>
            <td style="text-align:right">${row.cohort}</td>
            <td style="text-align:right">${row.active}</td>
            <td style="text-align:right">${rate(row.rate)}</td>
          </tr>`).join('');
    const totalRow = total ? `
          <tr data-adoption-total="${escapeHtml(key)}" style="font-weight:600;border-top:2px solid var(--color-border)">
            <td>${escapeHtml(total.label || `Total por ${dimension.label}`)}</td>
            <td style="text-align:right">${total.cohort}</td>
            <td style="text-align:right">${total.active}</td>
            <td style="text-align:right">${rate(total.rate)}</td>
          </tr>` : '';
    return `
      <div data-testid="adoption-dimension-${key}">
        <h4 style="margin:0 0 var(--space-2);font-size:var(--font-size-sm);color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em">${escapeHtml(dimension.label || key)}</h4>
        <div class="table-wrap">
          <table class="data-table" data-adoption-dimension="${key}">
            <thead><tr><th>Corte</th><th style="text-align:right">Cohorte</th><th style="text-align:right">Con uso</th><th style="text-align:right">Tasa</th></tr></thead>
            <tbody>${body}${totalRow}</tbody>
          </table>
        </div>
      </div>`;
  };

  const gapList = gaps.length > 0
    ? `<ul style="margin:var(--space-2) 0 0;padding-left:var(--space-4);font-size:11px;color:var(--color-text-secondary)">
        ${gaps.map((gap) => `<li><strong>${escapeHtml(gap.dimension)}</strong>: ${escapeHtml(gap.detail || gap.reason)}</li>`).join('')}
      </ul>`
    : '<p style="margin:var(--space-2) 0 0;font-size:11px;color:var(--color-text-secondary)">Sin huecos declarados en esta lectura.</p>';

  const integrityNote = integrity && (integrity.orphanPeople > 0)
    ? `<p style="margin:var(--space-2) 0 0;font-size:11px;color:var(--color-warning)">${integrity.orphanPeople} persona(s) de la cohorte no cayeron en ningún corte: la lectura está incompleta.</p>`
    : '';

  return `
    <div class="card" id="director-adoption-dimensions" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('chart')} ${label}</span>
        <span class="badge badge-info">${windowDays ? `${Number(windowDays)} días` : 'Ventana de la lectura'}</span>
      </div>
      <div style="padding:var(--space-4)">
        <p style="margin:0 0 var(--space-4);font-size:11px;color:var(--color-text-secondary)">
          ${escapeHtml(criteria || 'Uso: persona con al menos una interacción en la ventana. Cohorte: matrículas activas de rol alumno. Cada dimensión tiene su propio total.')}
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--space-4)">
          ${order.map(dimensionCard).join('')}
        </div>
        ${gapList}
        ${integrityNote}
        ${!rateKnown ? '<p style="margin:var(--space-2) 0 0;font-size:11px;color:var(--color-warning)">Adopción global no calculable: no hay cohorte activa sobre la que leer.</p>' : ''}
      </div>
    </div>`;
}

function statusLabel(status) {
  if (status === 'green') return 'Saludable';
  if (status === 'yellow') return 'En observación';
  if (status === 'red') return 'Crítico';
  return 'Desconocido';
}

function safetyColor(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 'var(--color-text-muted)';
  if (value >= 99) return '#10b981';
  if (value >= 95) return '#f59e0b';
  return '#ef4444';
}

function formatPercent(percent) {
  return `${Number(percent).toFixed(1)}%`;
}

function renderTrendArrow(trend) {
  if (!trend) return '';
  const seven = Number(trend['7d']);
  const thirty = Number(trend['30d']);
  if (!Number.isFinite(seven) || !Number.isFinite(thirty)) return '';
  const diff = Math.round((seven - thirty) * 10) / 10;
  const direction = diff > 0 ? 'positive' : diff < 0 ? 'negative' : '';
  const arrow = diff > 0 ? '&#9650;' : diff < 0 ? '&#9660;' : '&#9650;';
  return `<span class="kpi-delta ${direction}" title="Trend: 7d vs 30d">${arrow} ${Math.abs(diff).toFixed(1)}pts</span>`;
}

function icon(name) {
    const icons = {
        alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
        book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
        chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="6"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="5" width="3" height="11"/></svg>',
        database: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
        shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
    };
    return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.alert}</span>`;
}
