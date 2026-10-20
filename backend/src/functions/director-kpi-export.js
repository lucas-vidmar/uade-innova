import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { trackNotificationInteraction } from '../services/telemetry.js';
import { computeClassProcessingStats } from '../services/class-processing.js';
import { logWarn } from '../services/log.js';

const DIRECTOR_ROLES = ['Director'];

// #341: serialization guards. buildCsv/buildHtml run AFTER every data-source
// fallback, so any throw here escapes as a 500 with zero prior logging.
// Coerce defensively: skip null entries, accept only real arrays, coerce
// costs with Number() (string costs concatenate instead of adding, leaving
// a string without .toFixed), and quote CSV cells per RFC 4180.
function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAuthorized(request) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  if (!validateFrontDoorId(request)) return false;
  const principal = parseClientPrincipal(request);
  return principal?.userRoles?.some(r => DIRECTOR_ROLES.includes(r)) === true;
}

function buildCsv(data) {
  const d = isRecord(data) ? data : {};
  const lines = [];

  lines.push('seccion,metrica,valor');
  lines.push(`General,Usuarios activos (hoy),${toNum(d.dau)}`);
  lines.push(`General,Clases cargadas,${toNum(d.classesLoaded)}`);
  lines.push(`General,Clases procesadas,${toNum(d.classesProcessed)}`);
  if (toNum(d.classesNotComputable) > 0) {
    lines.push(`General,Clases procesadas no calculables,${toNum(d.classesNotComputable)}`);
  }
  lines.push('General,Criterio de clases procesadas,' + csvCell(d.classesProcessedCriteria || ''));
  lines.push(`General,Interacciones RAG,${toNum(d.ragInteractions)}`);
  lines.push(`General,Adopcion global,${toNum(d.adoptionRate)}%`);
  lines.push(`General,Costo por alumno activo,$${toNum(d.costPerActiveStudent).toFixed(4)}`);
  lines.push('');

  const budget = isRecord(d.budget) ? d.budget : {};
  lines.push('seccion,metrica,valor');
  lines.push('Budget,Presupuesto mensual,$' + toNum(budget.monthlyLimit).toFixed(2));
  lines.push('Budget,Gasto actual,$' + toNum(budget.currentSpend).toFixed(2));
  lines.push('Budget,Proyectado fin de mes,$' + toNum(budget.projectedEndOfMonth).toFixed(2));
  lines.push('Budget,Porcentaje usado,' + toNum(budget.percentUsed).toFixed(1) + '%');
  lines.push('Budget,Nivel de alerta,' + (budget.warningLevel || 'none'));
  lines.push('');

  const early = isRecord(d.earlyAlertSummary) ? d.earlyAlertSummary : {};
  lines.push('seccion,metrica,valor');
  lines.push('Alertas tempranas,Total en riesgo,' + toNum(early.totalStudentsAtRisk));
  lines.push('Alertas tempranas,Riesgo alto,' + toNum(early.highRiskCount));
  lines.push('Alertas tempranas,Riesgo medio,' + toNum(early.mediumRiskCount));
  // #467: asistencia y promedio no tienen fuente (no hay integración con el
  // sistema académico). Se declara la ausencia en vez de exportar un 0 fijo que
  // se lee como "nadie por debajo del umbral".
  lines.push('Alertas tempranas,Asistencia y promedio,sin fuente');
  lines.push('');

  lines.push('seccion,materia,costo_usd');
  for (const s of asArray(d.costBySubject)) {
    if (!isRecord(s)) continue;
    const costs = asArray(s.dailyCost);
    const totalCost = costs.reduce((sum, entry) => sum + toNum(isRecord(entry) ? entry.cost : entry), 0);
    lines.push(`Costo por materia,${csvCell(s.subjectName || s.subjectId)},${totalCost.toFixed(6)}`);
  }
  lines.push('');

  lines.push('seccion,materia,usuarios_semana_actual');
  for (const s of asArray(d.wausBySubject)) {
    if (!isRecord(s)) continue;
    lines.push(`WAUS por materia,${csvCell(s.subjectName || s.subjectId)},${toNum(s.currentWeek)}`);
  }
  lines.push('');

  // #491 (UJ-43): las tres dimensiones de la lectura de adopción, cada una con
  // su propio total y con las personas que cayeron en el corte «sin declarar».
  // El export lleva los mismos cortes que el panel: mismas dimensiones, mismo
  // cuadro.
  const adoption = isRecord(d.adoptionByDimension) ? d.adoptionByDimension : null;
  if (adoption) {
    lines.push('seccion,dimension,corte,cohorte,personas_con_uso,tasa_pct,fuente');
    for (const name of ['subject', 'campus', 'track']) {
      const dimension = isRecord(adoption[name]) ? adoption[name] : null;
      if (!dimension) continue;
      for (const row of asArray(dimension.rows)) {
        if (!isRecord(row)) continue;
        const sources = isRecord(row.sources) ? Object.keys(row.sources).join('+') : '';
        lines.push([
          'Adopcion',
          csvCell(dimension.label || name),
          csvCell(row.label || row.key),
          toNum(row.cohort),
          toNum(row.active),
          row.rate === null || row.rate === undefined ? 'no calculable' : toNum(row.rate),
          csvCell(sources || 'sin dato'),
        ].join(','));
      }
      const total = isRecord(dimension.total) ? dimension.total : null;
      if (total) {
        lines.push([
          'Adopcion',
          csvCell(dimension.label || name),
          'TOTAL',
          toNum(total.cohort),
          toNum(total.active),
          total.rate === null || total.rate === undefined ? 'no calculable' : toNum(total.rate),
          csvCell(''),
        ].join(','));
      }
    }
    lines.push('');
    lines.push('seccion,hueco,motivo,personas_o_unidades,detalle');
    for (const gap of asArray(d.adoptionGaps)) {
      if (!isRecord(gap)) continue;
      lines.push(`Huecos de la lectura,${csvCell(gap.reason || '')},${csvCell(gap.dimension || '')},${toNum(gap.count)},${csvCell(gap.detail || '')}`);
    }
    lines.push('');
    lines.push(`criterio_adopcion,${csvCell(d.adoptionCriteria || '')}`);
  }
  lines.push('');

  lines.push('seccion,docente,transcripciones,presentaciones,apuntes,bibliografia,total');
  const byTeacher = asArray(isRecord(d.materialUploads) ? d.materialUploads.byTeacher : []);
  for (const t of byTeacher) {
    if (!isRecord(t)) continue;
    lines.push(`Carga de materiales,${csvCell(t.teacherId)},${toNum(t.transcripts)},${toNum(t.presentations)},${toNum(t.notes)},${toNum(t.bibliography)},${toNum(t.total)}`);
  }

  lines.push('');
  lines.push(`cost_source,${csvCell(d.costSource || 'token-based-fallback')}`);
  lines.push(`generado_en,${new Date().toISOString()}`);
  return lines.join('\n');
}

function buildHtml(data) {
  const d = isRecord(data) ? data : {};
  const t = (v) => escHtml(v ?? '');
  const num = (v, digits) => toNum(v).toFixed(digits);
  const budget = isRecord(d.budget) ? d.budget : {};
  const earlyAlert = isRecord(d.earlyAlertSummary) ? d.earlyAlertSummary : {};
  const costRows = asArray(d.costBySubject).filter(isRecord).map(s => {
    const costs = asArray(s.dailyCost);
    const totalCost = costs.reduce((sum, entry) => sum + toNum(isRecord(entry) ? entry.cost : entry), 0);
    return `<tr><td>${t(s.subjectName || s.subjectId)}</td><td>$${totalCost.toFixed(6)}</td></tr>`;
  }).join('');
  const wausRows = asArray(d.wausBySubject).filter(isRecord).map(s =>
    `<tr><td>${t(s.subjectName || s.subjectId)}</td><td>${toNum(s.currentWeek)}</td></tr>`
  ).join('');
  // #491 (UJ-43): el reporte imprimible lleva los mismos tres cortes que el panel.
  const adoptionDimension = (name) => {
    const adoptionMap = isRecord(d.adoptionByDimension) ? d.adoptionByDimension : {};
    const dimension = isRecord(adoptionMap[name]) ? adoptionMap[name] : null;
    if (!dimension) return '';
    const rows = asArray(dimension.rows).filter(isRecord).map(row =>
      `<tr><td>${t(row.label || row.key)}</td><td>${toNum(row.cohort)}</td><td>${toNum(row.active)}</td><td>${row.rate === null || row.rate === undefined ? 'no calculable' : toNum(row.rate) + '%'}</td></tr>`
    ).join('');
    const total = isRecord(dimension.total) ? dimension.total : null;
    const totalRow = total
      ? `<tr><th>Total por ${t(String(dimension.label || name).toLowerCase())}</th><th>${toNum(total.cohort)}</th><th>${toNum(total.active)}</th><th>${total.rate === null || total.rate === undefined ? 'no calculable' : toNum(total.rate) + '%'}</th></tr>`
      : '';
    return `<h2>Adopci&oacute;n por ${t(String(dimension.label || name).toLowerCase())}</h2>
  <table><thead><tr><th>Corte</th><th>Cohorte</th><th>Personas con uso</th><th>Tasa</th></tr></thead>
  <tbody>${rows}${totalRow}</tbody></table>`;
  };
  const adoptionGaps = asArray(d.adoptionGaps).filter(isRecord).map(gap =>
    `<li><strong>${t(gap.dimension)}</strong> — ${t(gap.detail || gap.reason)}</li>`
  ).join('');
  const byTeacher = asArray(isRecord(d.materialUploads) ? d.materialUploads.byTeacher : []);
  const materialRows = byTeacher.filter(isRecord).map(tm =>
    `<tr><td>${t(tm.teacherId)}</td><td>${toNum(tm.transcripts)}</td><td>${toNum(tm.presentations)}</td><td>${toNum(tm.notes)}</td><td>${toNum(tm.bibliography)}</td><td>${toNum(tm.total)}</td></tr>`
  ).join('');

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
  .kpi-note { font-size: 7.5pt; color: #64748b; margin-top: 2px; max-width: 220px; }
  .footer { margin-top: 24px; font-size: 9pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
</style></head>
<body>
  <h1>Dashboard Directivo — KPIs</h1>
  <p>Generado: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} &mdash; Datos anonimizados, sin PII</p>

  <h2>M&eacute;tricas Generales</h2>
  <div class="kpi-grid">
    <div class="kpi-item"><div class="kpi-value">${t(d.dau)}</div><div class="kpi-label">Usuarios activos (hoy)</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(d.classesLoaded)}</div><div class="kpi-label">Clases cargadas</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(d.classesProcessed)}</div><div class="kpi-label">Clases procesadas</div><div class="kpi-note">${t(d.classesProcessedCriteria)}</div>${toNum(d.classesNotComputable) > 0 ? `<div class="kpi-note">${toNum(d.classesNotComputable)} sin dato suficiente: no calculables</div>` : ''}</div>
    <div class="kpi-item"><div class="kpi-value">${t(d.ragInteractions)}</div><div class="kpi-label">Interacciones RAG</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(d.adoptionRate)}%</div><div class="kpi-label">Adopci&oacute;n global</div></div>
    <div class="kpi-item"><div class="kpi-value">$${num(d.costPerActiveStudent, 4)}</div><div class="kpi-label">Costo por alumno activo</div></div>
  </div>

  <h2>Presupuesto</h2>
  <table><thead><tr><th>M&eacute;trica</th><th>Valor</th></tr></thead>
  <tbody>
    <tr><td>Presupuesto mensual</td><td>$${num(budget.monthlyLimit, 2)}</td></tr>
    <tr><td>Gasto actual</td><td>$${num(budget.currentSpend, 2)}</td></tr>
    <tr><td>Proyectado fin de mes</td><td>$${num(budget.projectedEndOfMonth, 2)}</td></tr>
    <tr><td>Porcentaje usado</td><td>${num(budget.percentUsed, 1)}%</td></tr>
  </tbody></table>

  <h2>Alertas Tempranas</h2>
  <table><thead><tr><th>M&eacute;trica</th><th>Valor</th></tr></thead>
  <tbody>
    <tr><td>Total en riesgo</td><td>${t(earlyAlert.totalStudentsAtRisk)}</td></tr>
    <tr><td>Riesgo alto</td><td>${t(earlyAlert.highRiskCount)}</td></tr>
    <tr><td>Riesgo medio</td><td>${t(earlyAlert.mediumRiskCount)}</td></tr>
    <tr><td>Asistencia y promedio</td><td>sin fuente</td></tr>
  </tbody></table>

  <h2>Costo por Materia (30 d&iacute;as)</h2>
  <table><thead><tr><th>Materia</th><th>Costo (USD)</th></tr></thead>
  <tbody>${costRows || '<tr><td colspan="2">Sin datos</td></tr>'}</tbody></table>

  <h2>Usuarios Activos Semanales</h2>
  <table><thead><tr><th>Materia</th><th>Semana actual</th></tr></thead>
  <tbody>${wausRows || '<tr><td colspan="2">Sin datos</td></tr>'}</tbody></table>

  <h2>Carga de Materiales por Docente</h2>
  <table><thead><tr><th>Docente</th><th>Transcripciones</th><th>Presentaciones</th><th>Apuntes</th><th>Bibliograf&iacute;a</th><th>Total</th></tr></thead>
  <tbody>${materialRows || '<tr><td colspan="6">Sin datos</td></tr>'}</tbody></table>

  ${adoptionDimension('subject')}
  ${adoptionDimension('campus')}
  ${adoptionDimension('track')}
  ${adoptionGaps ? `<h2>Huecos de la lectura</h2><ul style="font-size:9pt;color:#64748b">${adoptionGaps}</ul>` : ''}
  ${d.adoptionCriteria ? `<p class="kpi-note">${t(d.adoptionCriteria)}</p>` : ''}

  <div class="footer">Este informe contiene datos agregados y anonimizados. No incluye informaci&oacute;n personal identificable (PII).</div>
</body></html>`;
}

app.http('get-director-kpi-export', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'director/kpi-export',
  handler: withCorrelation(withAuth(async (request, context) => {
    const start = Date.now();

    if (!isAuthorized(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
    }

    try {
      const format = request.query.get('format') || 'csv';
      if (!['csv', 'pdf'].includes(format)) {
        return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Unsupported format. Use 'csv' or 'pdf'" }) };
      }

      const { computeDirectorMetrics, computeBudgetProjection, loadEarlyAlertSummary, POWERBI_DEFAULT_DAYS } = await import('./classes-api.js');
      const { getAzureCostForBudget, computeBudgetProjection: computeBudgetProjectionV2 } = await import('../services/azure-cost.js');

      // #341: each data source degrades independently. An authorized export
      // must never 500 because one source (cost API, subjects, classes
      // count) is empty or unavailable — fall back to safe defaults.
      let metrics = null;
      try {
        metrics = await computeDirectorMetrics(context, POWERBI_DEFAULT_DAYS);
      } catch (err) {
        logWarn(context, `[KpiExport] computeDirectorMetrics failed, using empty metrics: ${err.message}`);
        metrics = null;
      }
      const safeMetrics = metrics || {};
      const latest = safeMetrics.latest || { dau: 0, ragInteractions: 0 };
      const totals = safeMetrics.totals || { uniqueActiveUsers: 0, totalCost: 0 };
      const daily = Array.isArray(safeMetrics.daily) ? safeMetrics.daily : [];

      let azureCost = null;
      try {
        azureCost = await getAzureCostForBudget(context);
      } catch (err) {
        logWarn(context, `[KpiExport] Azure Cost query failed, using token-based fallback: ${err.message}`);
        azureCost = null;
      }
      const useAzureCost = azureCost?.success === true;
      let budget;
      try {
        budget = useAzureCost
          ? computeBudgetProjectionV2(azureCost.daily || [], {
            currentMonthSpend: azureCost.currentMonthSpend,
            costSource: 'azure-cost-api',
          })
          : computeBudgetProjection(daily);
      } catch (err) {
        logWarn(context, `[KpiExport] Budget projection failed, using empty budget: ${err.message}`);
        budget = { monthlyLimit: 0, currentSpend: 0, projectedEndOfMonth: 0, percentUsed: 0, warningLevel: 'none' };
      }
      const uniqueActiveUsers = totals.uniqueActiveUsers || 0;
      const effectiveTotalCost = useAzureCost ? (azureCost.currentMonthSpend || 0) : (totals.totalCost || 0);
      const costPerActiveStudent = uniqueActiveUsers > 0 ? Number((effectiveTotalCost / uniqueActiveUsers).toFixed(6)) : 0;

      // #419 (UJ-43): la exportación usaba el mismo conteo de filas de la tabla
      // de clases para "Clases procesadas". Ahora usa el criterio compartido:
      // cargadas = clases registradas; procesadas = con al menos un derivado
      // avalado por el docente; el resto se informa como no calculable.
      let classProcessing = { totalClasses: 0, processedClasses: 0, notComputableClasses: 0, criteria: '' };
      try {
        classProcessing = await computeClassProcessingStats(context);
      } catch (err) {
        context.log.warn(`[KpiExport] Could not compute class processing: ${err.message}`);
      }

      // #491 (UJ-43): la exportación usa la misma lectura que el panel para que
      // el cuadro exportado tenga las mismas dimensiones (unidad, sede, carrera)
      // con sus propios totales y los huecos declarados.
      let adoption = null;
      try {
        const classesApi = await import('./classes-api.js');
        const subjects = typeof classesApi.loadSubjects === 'function'
          ? ((await classesApi.loadSubjects()) || [])
          : [];
        if (typeof classesApi.buildDirectorAdoptionReading === 'function') {
          adoption = await classesApi.buildDirectorAdoptionReading(context, { metrics: safeMetrics, subjects });
        }
      } catch (err) {
        logWarn(context, `[KpiExport] Could not build adoption reading: ${err.message}`);
      }
      const adoptionDimensions = adoption?.dimensions || null;
      const adoptionRate = adoptionDimensions?.subject?.total?.rate ?? null;
      const adoptionCohort = adoptionDimensions?.subject?.total?.cohort ?? 0;

      const earlyAlertSummary = await loadEarlyAlertSummary(context).catch((err) => {
        logWarn(context, `[KpiExport] Could not load early-alert summary: ${err.message}`);
        return {
          totalStudentsAtRisk: 0, highRiskCount: 0, mediumRiskCount: 0,
        };
      });

      const data = {
        dau: latest.dau || 0,
        classesLoaded: classProcessing.totalClasses,
        classesProcessed: classProcessing.processedClasses,
        classesNotComputable: classProcessing.notComputableClasses,
        classesProcessedCriteria: classProcessing.criteria,
        ragInteractions: latest.ragInteractions || 0,
        adoptionRate,
        adoptionCohort,
        adoptionByDimension: adoptionDimensions,
        adoptionGaps: adoption?.gaps || [],
        adoptionCriteria: adoption?.criteria || '',
        adoptionIntegrity: adoption?.integrity || null,
        costPerActiveStudent,
        earlyAlertSummary: earlyAlertSummary || {},
        budget: budget || {},
        costBySubject: Array.isArray(safeMetrics.costBySubject) ? safeMetrics.costBySubject : [],
        wausBySubject: Array.isArray(safeMetrics.wausBySubject) ? safeMetrics.wausBySubject : [],
        materialUploads: safeMetrics.materialUploads || { byTeacher: [] },
        costSource: useAzureCost ? 'azure-cost-api' : 'token-based-fallback',
      };

      const userId = parseClientPrincipal(request)?.userId || 'anonymous';
      trackNotificationInteraction({
        action: 'kpi_export',
        status: 'success',
        userId,
        subjectId: 'director',
        notificationId: `kpi-export-${format}-${Date.now()}`,
      }).catch(err => context.error('[KpiExport] Telemetry error:', err));

      const generatedAt = new Date().toISOString();

      // #341: serialization is the last unguarded step — a malformed row must
      // degrade to a minimal report, never to the 500 above.
      if (format === 'csv') {
        let csv;
        try {
          csv = buildCsv(data);
        } catch (err) {
          logWarn(context, `[KpiExport] CSV build failed, using minimal fallback: ${err.message}`);
          csv = `seccion,metrica,valor\nGeneral,Usuarios activos (hoy),${toNum(data?.dau)}\ncost_source,${data?.costSource || 'token-based-fallback'}\ngenerado_en,${generatedAt}`;
        }
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="kpi-snapshot-${generatedAt.slice(0, 10)}.csv"`,
          },
          body: csv,
        };
      }

      let html;
      try {
        html = buildHtml(data);
      } catch (err) {
        logWarn(context, `[KpiExport] HTML build failed, using minimal fallback: ${err.message}`);
        html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>KPIs - Dashboard Directivo</title></head><body><h1>Dashboard Directivo — KPIs</h1><p>Generado: ${generatedAt}</p><p>Informe parcial: detalle no disponible.</p></body></html>`;
      }
      return {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `inline; filename="kpi-snapshot-${generatedAt.slice(0, 10)}.html"`,
        },
        body: html,
      };
    } catch (err) {
      context.error('[KpiExport] Error:', err.message);
      const userId = parseClientPrincipal(request)?.userId || 'anonymous';
      trackNotificationInteraction({
        action: 'kpi_export',
        status: 'error',
        userId,
        subjectId: 'director',
        notificationId: `kpi-export-error-${Date.now()}`,
      }).catch(e => context.error('[KpiExport] Telemetry error:', e));
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error al exportar KPIs' }) };
    }
  })),
});
