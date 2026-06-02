/* ============================================================
   Director Dashboard — Adoption metrics, cost analytics & early alerts
   ============================================================ */
import { api } from '../../services/api.js';
import { renderHeader } from '../../components/Header.js';

export async function renderDirectorDashboard(container) {
    renderHeader('Panel Directivo');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando datos directivos...</div>`;

    const [data = {}, powerBiMetrics = null, vectorHealth = null] = await Promise.all([
        api.getDirectorStats(),
        api.getDirectorPowerBiMetrics(30),
        api.getVectorHealth(),
    ]);

    const budget = data.budget || {};
    const spikeAlert = data.spikeAlert;
    const costBySubject = data.costBySubject || [];
    const wausBySubject = data.wausBySubject || [];
    const materialUploads = data.materialUploads || { byTeacher: [] };

    const defaultEarlyAlertSummary = {
        totalStudentsAtRisk: 0, highRiskCount: 0, mediumRiskCount: 0,
        lowAttendanceCount: 0, lowGradeCount: 0,
        attendanceBelow60Count: 0, attendance60To75Count: 0, attendanceAbove75Count: 0,
    };
    const earlyAlertSummary = { ...defaultEarlyAlertSummary, ...(data.earlyAlertSummary || {}) };
    const subjectAdoption = data.subjectAdoption || [];
    const powerBiPricing = powerBiMetrics?.pricing || { inputPerMillionTokensUsd: 0.15, outputPerMillionTokensUsd: 0.60, inputPerTokenUsd: 0.00000015, outputPerTokenUsd: 0.0000006 };
    const powerBiSummary = powerBiMetrics?.summary || { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalInteractions: 0, totalCostUsd: 0, avgCostPerInteractionUsd: 0 };

    const safePercentUsed = Number.isFinite(budget.percentUsed) ? budget.percentUsed : 0;
    const safeMonthlyLimit = Number.isFinite(budget.monthlyLimit) ? budget.monthlyLimit : 0;
    const safeProjected = Number.isFinite(budget.projectedEndOfMonth) ? budget.projectedEndOfMonth : 0;
    const budgetBannerClass = budget.warningLevel === 'critical' ? 'budget-banner-critical' : 'budget-banner-warning';
    const budgetIcon = budget.warningLevel === 'critical' ? '🚨' : '⚠️';
    const budgetText = budget.warningLevel === 'critical'
        ? `ALERTA: Se proyecta superar el presupuesto mensual ($${safeProjected.toFixed(2)} de $${safeMonthlyLimit.toFixed(2)})`
        : budget.warningLevel === 'warning'
            ? `Proyectado: ${safePercentUsed.toFixed(1)}% del presupuesto mensual`
            : '';

    const costPerActiveStudent = data.costPerActiveStudent || 0;

    container.innerHTML = `
    ${budget.warningLevel && budget.warningLevel !== 'none' ? `
      <div class="${budgetBannerClass}" style="padding:var(--space-4);margin-bottom:var(--space-6);border-radius:var(--radius-md);font-weight:600;display:flex;align-items:center;gap:var(--space-3)">
        <span>${budgetIcon}</span>
        <span>${budgetText}</span>
      </div>
    ` : ''}

    <!-- KPIs -->
    <div class="grid-4" style="margin-bottom:var(--space-8)">
      <div class="kpi-card">
        <div class="kpi-label">Usuarios activos (hoy)</div>
        <div class="kpi-value">${data.dau || 0}</div>
        <span class="kpi-delta positive">${data.dauDelta || '0%'}</span>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Clases procesadas</div>
        <div class="kpi-value">${data.classesProcessed || 0}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Interacciones RAG</div>
        <div class="kpi-value">${data.ragInteractions || 0}</div>
        <span class="kpi-delta positive">${data.ragDelta || '0%'}</span>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Adopción global</div>
        <div class="kpi-value" style="color:var(--color-primary-light)">${data.adoptionRate || 0}%</div>
        <div class="progress-bar" style="margin-top:var(--space-2)">
          <div class="progress-fill" style="--progress-value:${data.adoptionRate || 0}%"></div>
        </div>
      </div>
    </div>

    <!-- Cost per subject line chart → replaces static Power BI table -->
    <div class="card" id="cost-per-subject-card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('chart')} Costo por Materia (30 días) ${spikeAlert ? `<span class="badge badge-error" style="margin-left:var(--space-3)">Pico de costo detectado: +${spikeAlert.delta}%</span>` : ''}</span>
        <span class="badge badge-info">USD</span>
      </div>
      <p style="margin:0 0 var(--space-4);color:var(--color-text-secondary);font-size:var(--font-size-sm)">
        Fórmulas: Input <strong>$${Number(powerBiPricing.inputPerMillionTokensUsd).toFixed(2)}/1M</strong> · Output <strong>$${Number(powerBiPricing.outputPerMillionTokensUsd).toFixed(2)}/1M</strong>
      </p>
      <div class="grid-4" style="margin-bottom:var(--space-4)">
        <div class="kpi-card">
          <div class="kpi-label">Costo total (USD)</div>
          <div class="kpi-value">$${Number(powerBiSummary.totalCostUsd || 0).toFixed(4)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Costo por interacción</div>
          <div class="kpi-value">$${Number(powerBiSummary.avgCostPerInteractionUsd || 0).toFixed(6)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Costo promedio por alumno activo</div>
          <div class="kpi-value">$${costPerActiveStudent.toFixed(4)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Proyectado fin de mes</div>
          <div class="kpi-value" style="color:${budget.warningLevel === 'critical' ? 'var(--color-error)' : budget.warningLevel === 'warning' ? 'var(--color-warning)' : 'var(--color-text-primary)'}">$${Number(budget.projectedEndOfMonth || 0).toFixed(2)}</div>
        </div>
      </div>
      <div style="position:relative">
        <canvas id="cost-line-chart" style="width:100%;height:300px;display:block"></canvas>
        ${costBySubject.length === 0 ? '<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">Sin datos de costo por materia.</div>' : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-3);margin-top:var(--space-3)">
        ${costBySubject.map((s, i) => `
          <label style="display:inline-flex;align-items:center;gap:var(--space-1);cursor:pointer;font-size:var(--font-size-sm)">
            <input type="checkbox" class="subject-chart-toggle" data-id="${s.subjectId}" checked>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
            ${s.subjectName}
          </label>
        `).join('')}
      </div>
      <small style="display:block;margin-top:var(--space-3);color:var(--color-text-secondary)">Fuente: SessionMetrics · Última actualización: ${powerBiMetrics?.updatedAt || 'n/a'}</small>
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
                <td><strong>${t.teacherId}</strong></td>
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

    <div class="card" id="vector-health-card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('database')} Vector Index Health</span>
        <span class="badge ${vectorHealth ? 'badge-info' : 'badge-warning'}">${vectorHealth ? 'Disponible' : 'Sin datos'}</span>
      </div>
      ${vectorHealth ? `
        <div class="table-wrap">
          <table class="data-table" id="vector-health-table">
            <tbody>
              <tr><td><strong>Provider</strong></td><td>${vectorHealth.provider || 'n/a'}</td></tr>
              <tr><td><strong>Index</strong></td><td>${vectorHealth.indexName || 'n/a'}</td></tr>
              <tr><td><strong>Total Documents</strong></td><td>${Number(vectorHealth?.stats?.totalVectorCount || 0).toLocaleString('es-AR')}</td></tr>
              <tr><td><strong>Index Fullness</strong></td><td>${Math.round(Number(vectorHealth?.stats?.indexFullness || 0) * 10000) / 100}%</td></tr>
            </tbody>
          </table>
        </div>
        <small style="display:block;margin-top:var(--space-3);color:var(--color-text-secondary)">Snapshot: ${vectorHealth.timestamp || 'n/a'}</small>
      ` : `
        <div class="empty-state" style="padding:20px">No se pudo obtener el estado del índice vectorial.</div>
      `}
    </div>

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
      </div>
    </div>
  `;

    // Render cost line chart
    if (costBySubject.length > 0) {
        renderCostLineChart(costBySubject);
        document.querySelectorAll('.subject-chart-toggle').forEach(cb => {
            cb.addEventListener('change', () => renderCostLineChart(costBySubject));
        });
    }

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

    // Window resize handler for charts
    let resizeTimer;
    const onResize = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (costBySubject.length > 0) renderCostLineChart(costBySubject);
            if (wausBySubject.length > 0) renderWausBarChart(wausBySubject);
        }, 200);
    };
    window.addEventListener('resize', onResize);
}

const CHART_COLORS = ['#0077AB', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#38bdf8', '#ec4899'];

function renderCostLineChart(costBySubject) {
    const canvas = document.getElementById('cost-line-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement?.getBoundingClientRect();
    const width = rect?.width || 600;
    if (width <= 0) return;
    canvas.width = width * dpr;
    canvas.height = 300 * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = '300px';
    ctx.scale(dpr, dpr);
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    const toggles = document.querySelectorAll('.subject-chart-toggle');
    const visible = costBySubject.filter((_, i) => toggles[i]?.checked !== false);

    // Clear canvas
    ctx.clearRect(0, 0, W, H);

    if (visible.length === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Selecciona al menos una materia para ver el gráfico', W / 2, H / 2);
        return;
    }

    const allPoints = visible.flatMap(s => s.dailyCost?.map(d => d.cost) || []);
    if (allPoints.length === 0) return;
    const maxCost = Math.max(...allPoints, 0.001);
    const dates = [...new Set(visible.flatMap(s => s.dailyCost?.map(d => d.date) || []))].sort();
    if (dates.length === 0) return;

    const padL = 50, padR = 20, padT = 20, padB = 30;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const xStep = chartW / Math.max(dates.length - 1, 1);

    // Tooltip state
    let tooltip = canvas.parentElement.querySelector('.chart-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        tooltip.style.cssText = 'position:absolute;background:rgba(0,0,0,0.85);color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:10;white-space:nowrap;';
        canvas.parentElement.style.position = 'relative';
        canvas.parentElement.appendChild(tooltip);
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padT + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
    }

    const allDrawnPoints = [];

    visible.forEach((subject, si) => {
        const color = CHART_COLORS[costBySubject.indexOf(subject) % CHART_COLORS.length];
        const points = dates.map(date => {
            const p = (subject.dailyCost || []).find(d => d.date === date);
            return { date, cost: p ? p.cost : 0, subjectName: subject.subjectName };
        });

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((p, i) => {
            const x = padL + i * xStep;
            const y = padT + chartH - (p.cost / maxCost) * chartH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            allDrawnPoints.push({ x, y, date: p.date, cost: p.cost, color, subjectName: p.subjectName });
        });
        ctx.stroke();

        // Dots
        points.forEach((p, i) => {
            const x = padL + i * xStep;
            const y = padT + chartH - (p.cost / maxCost) * chartH;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    });

    // X labels (show 5 evenly spaced)
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(dates.length / 5));
    dates.forEach((d, i) => {
        if (i % labelStep !== 0) return;
        const x = padL + i * xStep;
        ctx.fillText(d.slice(5), x, H - padB + 18);
    });

    // Hover tooltip
    canvas.onmousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        let nearest = null;
        let minDist = Infinity;
        for (const p of allDrawnPoints) {
            const dx = mx - p.x;
            const dy = my - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 12 && dist < minDist) {
                minDist = dist;
                nearest = p;
            }
        }
        if (nearest) {
            tooltip.innerHTML = `<strong>${nearest.subjectName}</strong><br>${nearest.date}: $${nearest.cost.toFixed(4)}`;
            tooltip.style.left = `${Math.min(mx + 12, rect.width - 140)}px`;
            tooltip.style.top = `${Math.max(my - 40, 0)}px`;
            tooltip.style.opacity = '1';
        } else {
            tooltip.style.opacity = '0';
        }
    };
    canvas.onmouseleave = () => { tooltip.style.opacity = '0'; };
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
    const barGap = 16;
    const barW = Math.max(16, ((W - 50 - 20 - (data.length - 1) * barGap) / data.length));
    const maxVal = Math.max(...data.map(d => d.currentWeek), 1);

    ctx.clearRect(0, 0, W, H);
    const padL = 50, padR = 10, padT = 10, padB = 30;

    data.forEach((d, i) => {
        const groupX = 50 + i * (barW + barGap);

        // Current week bar only
        const currH = (d.currentWeek / maxVal) * (H - padT - padB);
        ctx.fillStyle = 'var(--color-accent)';
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

function icon(name) {
    const icons = {
        alert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
        book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
        chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="6"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="5" width="3" height="11"/></svg>',
        database: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
    };
    return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.alert}</span>`;
}
