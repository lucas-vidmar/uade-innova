import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { showConfirmDialog } from '../../components/Dialog.js';
import { toast } from '../../components/Toast.js';

// ── Panel de costo (UJ-54, decisión a) ──────────────────────────────
// La superficie fija qué se mide y el período, y compara dos períodos con el
// mismo criterio. El estado vive en el módulo para que el re-render de la
// tarjeta no lo pierda; no se persiste en el servidor.
const COST_PERIODS = [7, 14, 30, 60];
const COST_COMPARE_OPTIONS = [
  { value: 'previous-period', label: 'Período anterior de igual duración' },
  { value: 'none', label: 'Sin comparación' },
];
const costView = { days: 30, compare: 'previous-period' };

const fmtUsd = (value, digits = 4) => (Number.isFinite(value) ? `$${Number(value).toFixed(digits)}` : '—');
const fmtInt = (value) => (Number.isFinite(value) ? Number(value).toLocaleString('es-AR') : '—');
const fmtPct = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : '—');

export async function renderAdminDashboard(container) {
  container.innerHTML = `<div class="page-header">
    <h1 class="h2">Panel de Administración Técnica</h1>
    <p class="text-secondary">Costo, infraestructura y salud del sistema.</p>
  </div>
  <div id="cost-section"><div style="padding:24px;color:var(--color-text-secondary)" class="animate-pulse">Cargando el panel de costo...</div></div>
  <div id="budget-section"></div>
  <div id="vector-health-section"><div style="padding:24px;color:var(--color-text-secondary)" class="animate-pulse">Cargando el índice...</div></div>

  <!-- Contenido del índice de conocimiento (por unidad) -->
  <div class="card" style="margin-bottom:var(--space-8)">
    <div class="card-header">
      <span class="card-title">${icon('database')} Contenido del índice de conocimiento</span>
      <span class="badge badge-info" id="vector-index-subject">${auth.getActiveSubjectId?.() || 'sin unidad activa'}</span>
    </div>
    <p style="margin:0 0 var(--space-4);color:var(--color-text-secondary);font-size:var(--font-size-sm)">
      Qué fragmentos responde el índice para la unidad activa y cuáles no coinciden con su registro.
      Entradas en conflicto (sin registro en la unidad o con metadata desactualizada) se pueden sacar del índice.
    </p>
    <button type="button" class="btn btn-secondary" id="vector-index-load">Inspeccionar la unidad</button>
    <div id="vector-index-result" style="margin-top:var(--space-4)"></div>
  </div>`;

  wireVectorIndexSection(container, auth.getActiveSubjectId?.() || null);

  const [rawData, rawMetrics, rawVector] = await Promise.all([
    api.getDirectorStats(costView.days).catch(() => null),
    api.getDirectorPowerBiMetrics(costView.days, { compare: costView.compare }).catch(() => null),
    api.getVectorHealth().catch(() => null),
  ]);

  renderCostSection(container, rawData, rawMetrics);
  renderBudgetSection(container, rawData);
  renderVectorHealthSection(container, rawVector);
}

/**
 * UJ-54: la fuente se puede leer o no. Cuando no se pudo leer, la superficie lo
 * declara en vez de completar con una cifra sin respaldo.
 */
function readState(rawData, powerBiMetrics) {
  const statsReadFailed = rawData === null;
  const metricsReadFailed = !powerBiMetrics
    || powerBiMetrics?.source?.mode === 'fallback'
    || powerBiMetrics?.updatedAt == null;
  return {
    statsReadFailed,
    metricsReadFailed,
    readable: !statsReadFailed && !metricsReadFailed && rawData?.sourceState?.readable !== false,
  };
}

function renderCostSection(container, rawData, rawMetrics) {
  const section = container.querySelector('#cost-section');
  if (!section) return;

  const data = rawData || {};
  const powerBiMetrics = rawMetrics;
  const state = readState(rawData, powerBiMetrics);
  const readable = state.readable;
  const usd = (value, digits = 4) => (readable ? fmtUsd(value, digits) : '—');

  const summary = powerBiMetrics?.summary || {};
  // Compatibilidad: una API sin `period` (versión anterior) sigue mostrando el
  // total del período desde `summary`; lo que no trae se declara ausente.
  const period = powerBiMetrics?.period || (powerBiMetrics ? {
    startDate: null,
    endDate: null,
    days: powerBiMetrics.windowDays ?? costView.days,
    totalCostUsd: summary.totalCostUsd,
    totalTokens: summary.totalTokens,
    ragInteractions: summary.totalInteractions,
    activeUsers: null,
    tokensPerActiveUser: null,
    costPerInteractionUsd: summary.avgCostPerInteractionUsd,
    bySubject: [],
  } : null);
  const comparison = powerBiMetrics?.comparison || null;
  const criterion = powerBiMetrics?.criterion || null;
  const pricing = powerBiMetrics?.pricing || {};
  const attribution = powerBiMetrics?.attribution?.perActiveUser || null;
  const costBySubject = powerBiMetrics?.costBySubject || [];
  const unitRows = period?.bySubject || [];

  const priceLabel = `Input <strong>${fmtUsd(pricing.inputPerMillionTokensUsd, 2)}/1M</strong> · Output <strong>${fmtUsd(pricing.outputPerMillionTokensUsd, 2)}/1M</strong>`;
  const vigencyLabel = pricing.effectiveFrom
    ? `vigente desde <strong>${escapeHtml(pricing.effectiveFrom)}</strong> <span style="color:var(--color-text-secondary)">(${escapeHtml(pricing.effectiveFromSource || 'declarado')})</span>`
    : '<strong style="color:var(--color-warning)">sin fecha de vigencia declarada</strong>';

  const periodLabel = period?.startDate && period?.endDate
    ? `${escapeHtml(period.startDate)} → ${escapeHtml(period.endDate)} · ${period.days ?? costView.days} días`
    : `últimos ${costView.days} días`;
  const compareLabel = comparison ? `${escapeHtml(comparison.startDate)} → ${escapeHtml(comparison.endDate)}` : 'sin comparación';

  const compareRows = [
    { label: 'Costo (USD)', current: period?.totalCostUsd, previous: comparison?.totalCostUsd, delta: comparison?.deltas?.totalCostUsd, money: 4, warnUp: true },
    { label: 'Consumo total (tokens)', current: period?.totalTokens, previous: comparison?.totalTokens, delta: comparison?.deltas?.totalTokens, int: true, warnUp: true },
    { label: 'Interacciones RAG', current: period?.ragInteractions, previous: comparison?.ragInteractions, delta: comparison?.deltas?.ragInteractions, int: true },
    { label: 'Personas activas', current: period?.activeUsers, previous: comparison?.activeUsers, delta: comparison?.deltas?.activeUsers, int: true },
    { label: 'Consumo por persona activa (tokens)', current: period?.tokensPerActiveUser, previous: comparison?.tokensPerActiveUser, delta: comparison?.deltas?.tokensPerActiveUser, int: true },
    { label: 'Costo por interacción (USD)', current: period?.costPerInteractionUsd, previous: comparison?.costPerInteractionUsd, delta: comparison?.deltas?.costPerInteractionUsd, money: 6 },
  ];

  const cellValue = (row, value) => {
    if (!readable || !Number.isFinite(value)) return '—';
    return row.int ? fmtInt(value) : fmtUsd(value, row.money ?? 4);
  };

  const deltaCell = (delta, warnUp) => {
    if (!readable || !comparison) return '<span style="color:var(--color-text-secondary)">—</span>';
    if (!Number.isFinite(delta)) return '<span style="color:var(--color-text-secondary)" title="La base del período de comparación es cero: no hay variación calculable">n/c</span>';
    const color = warnUp && delta > 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)';
    return `<span style="color:${color}">${fmtPct(delta)}</span>`;
  };

  const unitTable = unitRows.length > 0 && readable
    ? `<div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Unidad</th><th>Personas activas</th><th>Interacciones</th><th>Tokens</th><th>Costo (USD)</th><th>% del costo</th></tr></thead>
          <tbody>
            ${unitRows.map((u) => `<tr>
              <td>${escapeHtml(u.subjectName || u.subjectId)}</td>
              <td>${fmtInt(u.activeUsers)}</td>
              <td>${fmtInt(u.ragInteractions)}</td>
              <td>${fmtInt(u.totalTokens)}</td>
              <td>${fmtUsd(u.totalCostUsd, 4)}</td>
              <td>${Number.isFinite(u.costSharePct) ? `${u.costSharePct.toFixed(1)}%` : '—'}</td>
            </tr>`).join('')}
            <tr>
              <td><strong>Total del período</strong></td>
              <td><strong>${fmtInt(period?.activeUsers)}</strong></td>
              <td><strong>${fmtInt(period?.ragInteractions)}</strong></td>
              <td><strong>${fmtInt(period?.totalTokens)}</strong></td>
              <td><strong>${fmtUsd(period?.totalCostUsd, 4)}</strong></td>
              <td><strong>${unitRows.length > 0 ? '100%' : '—'}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>`
    : `<div class="empty-state" style="padding:20px">${readable
      ? `Sin consumo por unidad en el período (${costView.days} días). Las unidades aparecen cuando hay consultas RAG con tokens.`
      : 'No se pudo leer la fuente de consumo (SessionMetrics): el consumo por unidad del período no se pudo medir.'}</div>`;

  const attributionBlock = attribution && attribution.status === 'available'
    ? `<div class="kpi-value">${fmtUsd(attribution.costUsd, 4)}</div>
       <small style="color:var(--color-text-secondary)">${escapeHtml(attribution.formula)}</small>`
    : `<div class="kpi-value" style="font-size:var(--font-size-base);line-height:1.3">requiere Cost Management (bloqueado por #303)</div>
       <small style="color:var(--color-text-secondary)">${escapeHtml(attribution?.reason || 'La atribución de costo real por persona requiere Azure Cost Management API (#303).')}</small>`;

  section.innerHTML = `
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('chart')} Panel de costo</span>
        <span class="badge badge-info">USD</span>
      </div>

      <div style="display:flex;gap:var(--space-4);flex-wrap:wrap;align-items:flex-end;margin-bottom:var(--space-4)">
        <label style="display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--font-size-sm)">
          <span style="color:var(--color-text-secondary)">Período</span>
          <select id="cost-period-select" class="form-select">
            ${COST_PERIODS.map((d) => `<option value="${d}" ${d === costView.days ? 'selected' : ''}>Últimos ${d} días</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:var(--space-1);font-size:var(--font-size-sm)">
          <span style="color:var(--color-text-secondary)">Comparar con</span>
          <select id="cost-compare-select" class="form-select">
            ${COST_COMPARE_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === costView.compare ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>
        <span class="badge badge-info" id="cost-period-badge">${periodLabel}</span>
      </div>

      <p style="margin:0 0 var(--space-2);color:var(--color-text-secondary);font-size:var(--font-size-sm)">
        <strong>Qué se mide:</strong> ${escapeHtml(criterion?.label || 'costo estimado = tokens registrados × precio declarado')}.
        Se aplica igual al período y a su comparación. Fuente: ${escapeHtml(criterion?.source || 'SessionMetrics (token-based)')}.
        <strong>No incluye</strong> infraestructura, storage ni logs: eso requiere Azure Cost Management (#303).
      </p>
      <p style="margin:0 0 var(--space-4);color:var(--color-text-secondary);font-size:var(--font-size-sm)">
        Precio declarado: ${priceLabel} · ${vigencyLabel} · Moneda ${escapeHtml(pricing.currency || 'USD')}
        ${readable ? '' : ' · <strong style="color:var(--color-warning)">fuente no disponible — no se pudo medir el consumo del período</strong>'}
      </p>

      <div class="grid-4" style="margin-bottom:var(--space-4)">
        <div class="kpi-card">
          <div class="kpi-label">Costo total del período</div>
          <div class="kpi-value">${usd(period?.totalCostUsd, 4)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Consumo total</div>
          <div class="kpi-value">${readable ? fmtInt(period?.totalTokens) : '—'}</div>
          <div class="kpi-label" style="margin-top:var(--space-1)">tokens · ${readable ? fmtInt(period?.ragInteractions) : '—'} interacciones</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Personas activas</div>
          <div class="kpi-value">${readable ? fmtInt(period?.activeUsers) : '—'}</div>
          <div class="kpi-label" style="margin-top:var(--space-1)">${readable && Number.isFinite(period?.tokensPerActiveUser) ? `${fmtInt(period.tokensPerActiveUser)} tokens por persona` : 'sin consumo atribuible'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Costo por persona activa</div>
          ${attributionBlock}
        </div>
      </div>

      <h3 class="h4" style="margin:0 0 var(--space-2)">Comparación de períodos (mismo criterio)</h3>
      <div class="table-wrap" style="margin-bottom:var(--space-4)">
        <table class="data-table">
          <thead><tr>
            <th>Criterio</th>
            <th>Período ${periodLabel}</th>
            <th>Comparación ${compareLabel}</th>
            <th>Variación</th>
          </tr></thead>
          <tbody>
            ${compareRows.map((row) => `<tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${cellValue(row, row.current)}</td>
              <td>${comparison ? cellValue(row, row.previous) : '—'}</td>
              <td>${deltaCell(row.delta, row.warnUp)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${comparison ? '' : '<p style="margin:0 0 var(--space-4);color:var(--color-text-secondary);font-size:var(--font-size-sm)">Sin comparación: elegí «Período anterior de igual duración» para medir la variación con el mismo criterio.</p>'}

      <h3 class="h4" style="margin:0 0 var(--space-2)">Por unidad</h3>
      ${unitTable}

      <div style="position:relative;margin-top:var(--space-4)">
        <canvas id="cost-line-chart" style="width:100%;height:260px;display:block"></canvas>
        ${costBySubject.length === 0 ? (readable
          ? `<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px">Sin actividad RAG con tokens en los últimos ${costView.days} días (SessionMetrics vacío). Los costos aparecen tras las primeras consultas.</div>`
          : '<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px">No se pudo leer la fuente de consumo (SessionMetrics). El consumo del período <strong>no se pudo medir</strong>: no se completa con una cifra sin respaldo.</div>') : ''}
      </div>
      <small style="display:block;margin-top:var(--space-3);color:var(--color-text-secondary)">
        Fuente: ${data.costSource?.method === 'azure-cost-api' ? 'Azure Cost Management API' : 'SessionMetrics (token-based)'}
        · Ventana medida: ${data.windowDays ?? costView.days} días
        · Última actualización: ${powerBiMetrics?.updatedAt || 'n/a'}
        ${readable ? '' : ' · <strong style="color:var(--color-warning)">fuente no disponible — no se pudo medir el consumo del período</strong>'}
      </small>
    </div>`;

  if (costBySubject.length > 0) renderCostLineChart(costBySubject);
  wireCostControls(container);
}

function renderBudgetSection(container, rawData) {
  const section = container.querySelector('#budget-section');
  if (!section) return;
  const data = rawData || {};
  const budget = data.budget || {};
  const readable = rawData !== null && data?.sourceState?.readable !== false;
  const usd = (value, digits = 2) => (readable && Number.isFinite(value) ? `$${Number(value).toFixed(digits)}` : '—');
  const safePercentUsed = readable && Number.isFinite(budget.percentUsed) ? budget.percentUsed : 0;
  const safeMonthlyLimit = Number.isFinite(budget.monthlyLimit) ? budget.monthlyLimit : null;

  section.innerHTML = `
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('chart')} Presupuesto Mensual</span>
        <span class="badge badge-info">USD</span>
      </div>
      <div class="grid-4" style="margin-bottom:var(--space-2)">
        <div class="kpi-card">
          <div class="kpi-label">Límite mensual</div>
          <div class="kpi-value">${safeMonthlyLimit != null ? `$${safeMonthlyLimit.toFixed(2)}` : '—'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Gasto actual</div>
          <div class="kpi-value">${usd(budget.currentSpend, 2)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Usado</div>
          <div class="kpi-value">${readable ? `${safePercentUsed.toFixed(1)}%` : '—'}</div>
          <div class="progress-bar" style="margin-top:var(--space-2)">
            <div class="progress-fill ${safePercentUsed > 80 ? 'progress-fill--warning' : ''}" style="--progress-value:${safePercentUsed}%"></div>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Proyectado</div>
          <div class="kpi-value" style="color:${readable && budget.warningLevel === 'critical' ? 'var(--color-error)' : readable && budget.warningLevel === 'warning' ? 'var(--color-warning)' : 'var(--color-text-primary)'}">${usd(budget.projectedEndOfMonth, 2)}</div>
        </div>
      </div>
      <small style="display:block;color:var(--color-text-secondary)">Ventana medida: ${data.windowDays ?? costView.days} días · la misma que el panel de costo.</small>
    </div>`;
}

function renderVectorHealthSection(container, vectorHealth) {
  const section = container.querySelector('#vector-health-section');
  if (!section) return;

  // Index fullness is a 0-1 fraction; keep the historical minimal format
  // (e.g. "8%") for normal values, but show 4 decimals when the value is
  // nonzero yet rounds to 0% (pilot index) instead of a misleading "0%".
  const fullnessRaw = Number(vectorHealth?.stats?.indexFullness || 0);
  const fullnessPct = fullnessRaw * 100;
  const fullnessLabel = fullnessPct === 0 ? '0%' : fullnessPct < 0.01 ? `${fullnessPct.toFixed(4)}%` : `${Math.round(fullnessPct * 100) / 100}%`;
  const metricsSampleCount = Number(vectorHealth?.metricsSampleCount || 0);
  const latencyP50 = vectorHealth?.latencyMs?.p50;
  const latencyP95 = vectorHealth?.latencyMs?.p95;

  section.innerHTML = `
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
    </div>`;
}

function wireCostControls(container) {
  const periodSelect = container.querySelector('#cost-period-select');
  const compareSelect = container.querySelector('#cost-compare-select');
  if (periodSelect) {
    periodSelect.addEventListener('change', () => {
      const days = Number(periodSelect.value);
      if (!Number.isFinite(days) || days === costView.days) return;
      costView.days = days;
      refreshCostView(container);
    });
  }
  if (compareSelect) {
    compareSelect.addEventListener('change', () => {
      if (compareSelect.value === costView.compare) return;
      costView.compare = compareSelect.value === 'none' ? 'none' : 'previous-period';
      refreshCostView(container);
    });
  }
}

async function refreshCostView(container) {
  const section = container.querySelector('#cost-section');
  if (section) section.style.opacity = '0.55';
  const [rawData, rawMetrics] = await Promise.all([
    api.getDirectorStats(costView.days).catch(() => null),
    api.getDirectorPowerBiMetrics(costView.days, { compare: costView.compare }).catch(() => null),
  ]);
  renderCostSection(container, rawData, rawMetrics);
  renderBudgetSection(container, rawData);
}

const VERDICT_LABEL = {
  ok: 'OK',
  orphan: 'Sin registro en la unidad',
  mismatch: 'No coincide con su registro',
  'metadata-incomplete': 'Metadata incompleta',
};

const VERDICT_BADGE = {
  ok: 'badge-info',
  orphan: 'badge-error',
  mismatch: 'badge-warning',
  'metadata-incomplete': 'badge-warning',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Índice de conocimiento por unidad (#452 / UJ-59): acota el daño (qué sirve el
 * índice para esta unidad) y permite sacar de él las entradas en conflicto,
 * mostrando la verificación posterior de la corrida.
 */
function wireVectorIndexSection(container, subjectId) {
  const button = container.querySelector('#vector-index-load');
  const result = container.querySelector('#vector-index-result');
  if (!button || !result) return;

  const render = (payload) => {
    const conflictivas = (payload.groups || []).filter((g) => g.verdict !== 'ok');
    const rows = (payload.groups || []).map((g) => `
      <tr>
        <td>${escapeHtml(g.sourceFilename || g.materialId)}</td>
        <td>${escapeHtml(g.materialType || 'n/a')}</td>
        <td>${escapeHtml((g.classIds && g.classIds.length ? g.classIds.join(', ') : g.classId) || 'n/a')}</td>
        <td>${Number(g.chunkCount || 0)}</td>
        <td><span class="badge ${VERDICT_BADGE[g.verdict] || 'badge-warning'}">${escapeHtml(VERDICT_LABEL[g.verdict] || g.verdict)}</span>${g.quarantined ? ' <span class="badge badge-info">En cuarentena</span>' : ''}</td>
      </tr>`).join('');

    result.innerHTML = `
      <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-3)">
        <span class="badge badge-info">${Number(payload.totalInUnit || 0)} materiales en el índice</span>
        <span class="badge ${conflictivas.length > 0 ? 'badge-warning' : 'badge-info'}">${conflictivas.length} en conflicto</span>
        ${payload.truncated ? '<span class="badge badge-warning">Escaneo truncado: la lista no es completa</span>' : ''}
      </div>
      ${rows ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Material</th><th>Tipo</th><th>Clase</th><th>Fragmentos</th><th>Estado</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<div class="empty-state" style="padding:20px">El índice no tiene fragmentos para esta unidad.</div>'}
      ${conflictivas.length > 0 ? '<div style="margin-top:var(--space-4)"><button type="button" class="btn btn-danger" id="vector-index-quarantine">Sacar del índice las ' + conflictivas.length + ' entradas en conflicto</button></div>' : ''}
    `;

    const quarantineButton = result.querySelector('#vector-index-quarantine');
    if (quarantineButton) {
      quarantineButton.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog({
          title: 'Sacar del índice de conocimiento',
          message: `Se sacan ${conflictivas.length} materiales del índice de esta unidad. Dejan de alimentar las respuestas y la corrida queda registrada con su verificación.`,
          detailsHtml: conflictivas.map((g) => escapeHtml(g.sourceFilename || g.materialId)).join('<br>'),
          confirmText: 'Sacar del índice',
          danger: true,
        });
        if (!confirmed) return;

        quarantineButton.disabled = true;
        quarantineButton.textContent = 'Purgando...';
        try {
          const run = await api.quarantineVectorIndex(subjectId, conflictivas.map((g) => g.materialId));
          toast(run.verification?.verified ? 'success' : 'warning', 'Índice actualizado',
            `${run.applied.length} sacados del índice · verificación: ${run.verification?.verified ? 'confirmada' : `pendiente (${(run.verification?.remaining || []).length})`}`,
            6000, run.auditBlob ? [`Registro: ${run.auditBlob}`] : []);
          const refreshed = await api.getVectorIndex(subjectId);
          render(refreshed);
        } catch (err) {
          quarantineButton.disabled = false;
          quarantineButton.textContent = `Sacar del índice las ${conflictivas.length} entradas en conflicto`;
          toast('error', 'No se pudo purgar', err?.message || 'Error desconocido');
        }
      });
    }
  };

  button.addEventListener('click', async () => {
    if (!subjectId) {
      toast('warning', 'Sin unidad activa', 'Elegí una unidad en el selector de arriba para inspeccionar su índice.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Inspeccionando...';
    result.innerHTML = '<div class="animate-pulse" style="padding:12px;color:var(--color-text-secondary)">Leyendo el índice de la unidad...</div>';
    try {
      render(await api.getVectorIndex(subjectId));
    } catch (err) {
      result.innerHTML = `<div class="empty-state" style="padding:20px">No se pudo leer el índice: ${escapeHtml(err?.message || 'error desconocido')}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Inspeccionar la unidad';
    }
  });
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
  canvas.height = 260 * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = '260px';
  ctx.scale(dpr, dpr);
  const W = width;
  const H = 260;
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
