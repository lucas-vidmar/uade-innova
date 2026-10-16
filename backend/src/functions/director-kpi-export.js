import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { trackNotificationInteraction } from '../services/telemetry.js';
import { getTableClient } from '../services/storage.js';
import { CONFIG } from '../services/config.js';
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
  lines.push(`General,Clases procesadas,${toNum(d.classesProcessed)}`);
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
  lines.push('Alertas tempranas,Asistencia < 60%,' + toNum(early.attendanceBelow60Count));
  lines.push('Alertas tempranas,Asistencia 60-75%,' + toNum(early.attendance60To75Count));
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
  .footer { margin-top: 24px; font-size: 9pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
</style></head>
<body>
  <h1>Dashboard Directivo — KPIs</h1>
  <p>Generado: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} &mdash; Datos anonimizados, sin PII</p>

  <h2>M&eacute;tricas Generales</h2>
  <div class="kpi-grid">
    <div class="kpi-item"><div class="kpi-value">${t(d.dau)}</div><div class="kpi-label">Usuarios activos (hoy)</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(d.classesProcessed)}</div><div class="kpi-label">Clases procesadas</div></div>
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
    <tr><td>Asistencia &lt; 60%</td><td>${t(earlyAlert.attendanceBelow60Count)}</td></tr>
    <tr><td>Asistencia 60-75%</td><td>${t(earlyAlert.attendance60To75Count)}</td></tr>
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

      let classesCount = 0;
      try {
        const classesClient = getTableClient(CONFIG.tables.classes);
        for await (const _ of classesClient.listEntities()) {
          classesCount++;
        }
      } catch (err) {
        logWarn(context, `[KpiExport] Could not count classes: ${err.message}`);
      }

      // #341: loadSubjects is module-private inside classes-api.js (not
      // exported), so resolve it defensively instead of throwing a TypeError
      // on every export. Falls back to the 60-student default when absent.
      let totalEnrolled = 0;
      try {
        const classesApi = await import('./classes-api.js');
        const allSubjects = typeof classesApi.loadSubjects === 'function'
          ? ((await classesApi.loadSubjects()) || [])
          : [];
        totalEnrolled = allSubjects.reduce((sum, s) => sum + (toNum(s?.enrolledCount, 60) || 60), 60);
        if (totalEnrolled <= 0) totalEnrolled = 60;
      } catch (err) {
        logWarn(context, `[KpiExport] Could not load subjects: ${err.message}`);
        totalEnrolled = 60;
      }
      const adoptionRate = uniqueActiveUsers > 0 ? Math.min(100, Math.round(uniqueActiveUsers / totalEnrolled * 100)) : 0;

      const earlyAlertSummary = await loadEarlyAlertSummary(context).catch((err) => {
        logWarn(context, `[KpiExport] Could not load early-alert summary: ${err.message}`);
        return {
          totalStudentsAtRisk: 0, highRiskCount: 0, mediumRiskCount: 0,
          lowAttendanceCount: 0, lowGradeCount: 0,
          attendanceBelow60Count: 0, attendance60To75Count: 0, attendanceAbove75Count: 0,
        };
      });

      const data = {
        dau: latest.dau || 0,
        classesProcessed: classesCount,
        ragInteractions: latest.ragInteractions || 0,
        adoptionRate,
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
