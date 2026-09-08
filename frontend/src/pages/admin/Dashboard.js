import { api } from '../../services/api.js';

export async function renderAdminDashboard(container) {
  container.innerHTML = `<div class="page-header">
    <h1 class="h2">Panel de Administración Técnica</h1>
    <p class="text-secondary">Costo, infraestructura y salud del sistema.</p>
  </div>
  <div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando datos...</div>`;

  const [rawData, rawMetrics, rawVector] = await Promise.all([
    api.getDirectorStats().catch(() => null),
    api.getDirectorPowerBiMetrics(30).catch(() => null),
    api.getVectorHealth().catch(() => null),
  ]);

  const data = rawData || {};
  const powerBiMetrics = rawMetrics;
  const vectorHealth = rawVector;
  const budget = data.budget || {};
  const spikeAlert = data.spikeAlert;
  const costBySubject = data.costBySubject || [];
  const rawPricing = powerBiMetrics?.pricing;
  const powerBiPricing = {
    inputPerMillionTokensUsd: Number(rawPricing?.inputPerMillionTokensUsd) || 0.15,
    outputPerMillionTokensUsd: Number(rawPricing?.outputPerMillionTokensUsd) || 0.60,
  };
  const powerBiSummary = powerBiMetrics?.summary || {};
  const costPerActiveStudent = data.costPerActiveStudent || 0;

  const safePercentUsed = Number.isFinite(budget.percentUsed) ? budget.percentUsed : 0;
  // Default 10000 matches backend CONFIG.budget.monthlyUsd / DIRECTOR_BUDGET_MONTHLY_USD
  // (infra/modules/functions.bicep). Avoids showing $0.00 limit when /director/stats
  // is unreachable (403/404) and budget={}.
  const safeMonthlyLimit = Number.isFinite(budget.monthlyLimit) ? budget.monthlyLimit : 10000;
  const safeProjected = Number.isFinite(budget.projectedEndOfMonth) ? budget.projectedEndOfMonth : 0;

  // Index fullness is a 0-1 fraction; with a pilot index (hundreds of vectors)
  // the 2-decimal % rounds to 0%. Show higher precision instead of a misleading 0%.
  const fullnessRaw = Number(vectorHealth?.stats?.indexFullness || 0);
  const fullnessPct = fullnessRaw * 100;
  const fullnessLabel = fullnessPct === 0 ? '0%' : fullnessPct < 0.01 ? `${fullnessPct.toFixed(4)}%` : `${(Math.round(fullnessPct * 100) / 100).toFixed(2)}%`;
  const metricsSampleCount = Number(vectorHealth?.metricsSampleCount || 0);
  const latencyP50 = vectorHealth?.latencyMs?.p50;
  const latencyP95 = vectorHealth?.latencyMs?.p95;

  container.innerHTML = `
    <!-- Cost per subject -->
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('chart')} Costo por Materia (30 días) ${spikeAlert ? `<span class="badge badge-error" style="margin-left:var(--space-3)">Pico: +${spikeAlert.delta}%</span>` : ''}</span>
        <span class="badge badge-info">USD</span>
      </div>
      <p style="margin:0 0 var(--space-4);color:var(--color-text-secondary);font-size:var(--font-size-sm)">
        Input <strong>$${powerBiPricing.inputPerMillionTokensUsd.toFixed(2)}/1M</strong> · Output <strong>$${powerBiPricing.outputPerMillionTokensUsd.toFixed(2)}/1M</strong>
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
          <div class="kpi-label">Costo promedio por alumno</div>
          <div class="kpi-value">$${costPerActiveStudent.toFixed(4)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Proyectado fin de mes</div>
          <div class="kpi-value" style="color:${budget.warningLevel === 'critical' ? 'var(--color-error)' : 'var(--color-text-primary)'}">$${Number(budget.projectedEndOfMonth || 0).toFixed(2)}</div>
        </div>
      </div>
      <div style="position:relative">
        <canvas id="cost-line-chart" style="width:100%;height:300px;display:block"></canvas>
        ${costBySubject.length === 0 ? '<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px">Sin actividad RAG con tokens en los últimos 30 días (SessionMetrics vacío). Los costos aparecen tras las primeras consultas.</div>' : ''}
      </div>
      <small style="display:block;margin-top:var(--space-3);color:var(--color-text-secondary)">
        Fuente: ${data.costSource?.method === 'azure-cost-api' ? 'Azure Cost Management API' : 'SessionMetrics (token-based)'}
        · Última actualización: ${powerBiMetrics?.updatedAt || 'n/a'}
      </small>
    </div>

    <!-- Vector Index Health -->
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('database')} Vector Index Health</span>
        <span class="badge ${vectorHealth ? 'badge-info' : 'badge-warning'}">${vectorHealth ? 'Disponible' : 'Sin datos'}</span>
      </div>
      ${vectorHealth ? `
        <div class="table-wrap">
          <table class="data-table">
            <tbody>
              <tr><td><strong>Provider</strong></td><td>${vectorHealth.provider || 'n/a'}</td></tr>
              <tr><td><strong>Index</strong></td><td>${vectorHealth.indexName || 'n/a'}</td></tr>
              <tr><td><strong>Total Documents</strong></td><td>${Number(vectorHealth?.stats?.totalVectorCount || 0).toLocaleString('es-AR')}</td></tr>
              <tr><td><strong>Index Fullness</strong></td><td>${fullnessLabel}</td></tr>
              <tr><td><strong>Latency p50</strong></td><td>${latencyP50 != null ? latencyP50 + ' ms' : 'n/a (sin operaciones recientes)'}</td></tr>
              <tr><td><strong>Latency p95</strong></td><td>${latencyP95 != null ? latencyP95 + ' ms' : 'n/a (sin operaciones recientes)'}</td></tr>
              ${vectorHealth.failureRatio != null ? `
              <tr><td><strong>Failure Ratio</strong></td><td>${(vectorHealth.failureRatio * 100).toFixed(1)}%</td></tr>
              ` : ''}
              <tr><td><strong>Muestras (ventana ${vectorHealth.metricsWindow || 5} min)</strong></td><td>${metricsSampleCount}</td></tr>
            </tbody>
          </table>
        </div>
        <small style="display:block;margin-top:var(--space-3);color:var(--color-text-secondary)">Snapshot: ${vectorHealth.timestamp || 'n/a'}</small>
      ` : `
        <div class="empty-state" style="padding:20px">No se pudo obtener el estado del índice vectorial.</div>
      `}
    </div>

    <!-- Presupuesto -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">${icon('chart')} Presupuesto Mensual</span>
        <span class="badge badge-info">USD</span>
      </div>
      <div class="grid-4" style="margin-bottom:var(--space-2)">
        <div class="kpi-card">
          <div class="kpi-label">Límite mensual</div>
          <div class="kpi-value">$${safeMonthlyLimit.toFixed(2)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Gasto actual</div>
          <div class="kpi-value">$${Number(budget.currentSpend || 0).toFixed(2)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Usado</div>
          <div class="kpi-value">${safePercentUsed.toFixed(1)}%</div>
          <div class="progress-bar" style="margin-top:var(--space-2)">
            <div class="progress-fill ${safePercentUsed > 80 ? 'progress-fill--warning' : ''}" style="--progress-value:${safePercentUsed}%"></div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Proyectado</div>
          <div class="kpi-value" style="color:${budget.warningLevel === 'critical' ? 'var(--color-error)' : budget.warningLevel === 'warning' ? 'var(--color-warning)' : 'var(--color-text-primary)'}">$${safeProjected.toFixed(2)}</div>
        </div>
      </div>
    </div>
  `;

  // Render cost chart
  if (costBySubject.length > 0) {
    renderCostLineChart(costBySubject);
  }
}

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
  const W = width;
  const H = 300;
  const padL = 50, padR = 20, padT = 20, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const allPoints = costBySubject.flatMap(s => s.dailyCost?.map(d => d.cost) || []);
  if (allPoints.length === 0) return;
  const maxCost = Math.max(...allPoints, 0.001);
  const dates = [...new Set(costBySubject.flatMap(s => s.dailyCost?.map(d => d.date) || []))].sort();
  if (dates.length === 0) return;
  const xStep = chartW / Math.max(dates.length - 1, 1);

  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(128,128,128,0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }

  const COLORS = ['#0077AB', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#38bdf8'];
  costBySubject.forEach((subject, si) => {
    const color = COLORS[si % COLORS.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    dates.forEach((date, i) => {
      const p = (subject.dailyCost || []).find(d => d.date === date);
      const cost = p ? p.cost : 0;
      const x = padL + i * xStep;
      const y = padT + chartH - (cost / maxCost) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Dots
    dates.forEach((date, i) => {
      const p = (subject.dailyCost || []).find(d => d.date === date);
      const cost = p ? p.cost : 0;
      const x = padL + i * xStep;
      const y = padT + chartH - (cost / maxCost) * chartH;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });
  });

  ctx.fillStyle = 'rgba(128,128,128,0.5)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  const labelStep = Math.max(1, Math.floor(dates.length / 5));
  dates.forEach((d, i) => {
    if (i % labelStep !== 0) return;
    ctx.fillText(d.slice(5), padL + i * xStep, H - padB + 18);
  });
}

function icon(name) {
  const icons = {
    chart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="6"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="5" width="3" height="11"/></svg>',
    database: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>',
  };
  return `<span class="ui-icon" aria-hidden="true">${icons[name] || icons.chart}</span>`;
}
