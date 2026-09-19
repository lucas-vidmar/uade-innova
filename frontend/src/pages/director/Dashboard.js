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

    const defaultEarlyAlertSummary = {
        totalStudentsAtRisk: 0, highRiskCount: 0, mediumRiskCount: 0,
        lowAttendanceCount: 0, lowGradeCount: 0,
        attendanceBelow60Count: 0, attendance60To75Count: 0, attendanceAbove75Count: 0,
    };
    const earlyAlertSummary = { ...defaultEarlyAlertSummary, ...(data.earlyAlertSummary || {}) };
    _kpiData = data;

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
        <div class="kpi-value">${data.totalClasses || 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Adopción global</div>
        <div class="kpi-value" style="color:var(--color-primary-light)">${data.adoptionRate || 0}%</div>
        <div class="progress-bar" style="margin-top:var(--space-2)">
          <div class="progress-fill" style="--progress-value:${data.adoptionRate || 0}%"></div>
        </div>
      </div>
    </div>

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
              <div class="kpi-value" id="kpi-classes-viewed">-</div>
            </div>
            <div class="kpi-card" style="margin:0">
              <div class="kpi-label">Alumnos que vieron</div>
              <div class="kpi-value" id="kpi-students-viewed">-</div>
            </div>
            <div class="kpi-card" style="margin:0;grid-column:1/-1">
              <div class="kpi-label">Clases por alumno (promedio)</div>
              <div class="kpi-value" id="kpi-avg-per-student">-</div>
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
              <tr><td>Asistencia &lt; 60%</td><td>${earlyAlertSummary.attendanceBelow60Count}</td></tr>
              <tr><td>Asistencia 60% - 75%</td><td>${earlyAlertSummary.attendance60To75Count}</td></tr>
              <tr><td>Asistencia &gt; 75%</td><td>${earlyAlertSummary.attendanceAbove75Count}</td></tr>
              <tr><td>Baja asistencia (total)</td><td>${earlyAlertSummary.lowAttendanceCount}</td></tr>
              <tr><td>Bajo promedio (total)</td><td>${earlyAlertSummary.lowGradeCount}</td></tr>
            </tbody>
          </table>
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

    document.getElementById('btn-risk-breakdown-dashboard')?.addEventListener('click', () => {
      document.getElementById('risk-breakdown-dashboard-modal').style.display = 'flex';
      refreshRiskBreakdownBody();
    });

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
async function loadAndRenderClassViews(data, container) {
  let subjects = (auth.getUser().subjects || []).filter(s => s.id);
  if (subjects.length === 0) {
    try { subjects = (await api.getSubjects()) || []; } catch (e) { /* ignore */ }
  }
  if (subjects.length === 0) {
    const kpis = ['kpi-classes-viewed', 'kpi-students-viewed', 'kpi-avg-per-student'];
    kpis.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    });
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

    document.getElementById('kpi-classes-viewed').textContent = totalViewedClasses;
    document.getElementById('kpi-students-viewed').textContent = allStudents.size;
    const avg = allStudents.size > 0 ? (totalViewedClasses / allStudents.size).toFixed(1) : '-';
    document.getElementById('kpi-avg-per-student').textContent = avg;
  } catch (err) {
    console.error('[Director Dashboard] Error loading class views:', err);
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
  push('General','Clases procesadas', data.totalClasses || 0);
  push('General','Interacciones RAG', data.ragInteractions || 0);
  push('General','Adopcion global', (data.adoptionRate || 0) + '%');
  lines.push('');
  const ea = data.earlyAlertSummary || {};
  push('Alertas','Total en riesgo', ea.totalStudentsAtRisk || 0);
  push('Alertas','Riesgo alto', ea.highRiskCount || 0);
  push('Alertas','Riesgo medio', ea.mediumRiskCount || 0);
  lines.push('');
  lines.push('seccion,materia,semana_actual');
  (data.wausBySubject || []).forEach(s => push('WAUS', s.subjectName || s.subjectId, s.currentWeek || 0));
  lines.push('');
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
    <div class="kpi-item"><div class="kpi-value">${t(data.totalClasses)}</div><div class="kpi-label">Clases procesadas</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.ragInteractions)}</div><div class="kpi-label">Interacciones RAG</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.adoptionRate)}%</div><div class="kpi-label">Adopci&oacute;n global</div></div>
  </div>
  <h2>Alertas Tempranas</h2>
  <table><thead><tr><th>M&eacute;trica</th><th>Valor</th></tr></thead>
  <tbody>
    <tr><td>Total en riesgo</td><td>${t(ea.totalStudentsAtRisk)}</td></tr>
    <tr><td>Riesgo alto</td><td>${t(ea.highRiskCount)}</td></tr>
    <tr><td>Riesgo medio</td><td>${t(ea.mediumRiskCount)}</td></tr>
    <tr><td>Asistencia &lt; 60%</td><td>${t(ea.attendanceBelow60Count)}</td></tr>
    <tr><td>Asistencia 60-75%</td><td>${t(ea.attendance60To75Count)}</td></tr>
  </tbody></table>
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
