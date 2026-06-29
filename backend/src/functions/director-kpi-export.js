import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
import { trackNotificationInteraction } from '../services/telemetry.js';
import { getTableClient } from '../services/storage.js';

const DIRECTOR_ROLES = ['Director'];

function isAuthorized(request) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  if (!validateFrontDoorId(request)) return false;
  const principal = parseClientPrincipal(request);
  return principal?.userRoles?.some(r => DIRECTOR_ROLES.includes(r)) === true;
}

function buildCsv(data) {
  const lines = [];

  lines.push('seccion,metrica,valor');
  lines.push(`General,Usuarios activos (hoy),${data.dau || 0}`);
  lines.push(`General,Clases procesadas,${data.classesProcessed || 0}`);
  lines.push(`General,Interacciones RAG,${data.ragInteractions || 0}`);
  lines.push(`General,Adopcion global,${data.adoptionRate || 0}%`);
  lines.push(`General,Costo por alumno activo,$${Number(data.costPerActiveStudent || 0).toFixed(4)}`);
  lines.push('');

  lines.push('seccion,metrica,valor');
  lines.push('Budget,Presupuesto mensual,$' + Number(data.budget?.monthlyLimit || 0).toFixed(2));
  lines.push('Budget,Gasto actual,$' + Number(data.budget?.currentSpend || 0).toFixed(2));
  lines.push('Budget,Proyectado fin de mes,$' + Number(data.budget?.projectedEndOfMonth || 0).toFixed(2));
  lines.push('Budget,Porcentaje usado,' + Number(data.budget?.percentUsed || 0).toFixed(1) + '%');
  lines.push('Budget,Nivel de alerta,' + (data.budget?.warningLevel || 'none'));
  lines.push('');

  lines.push('seccion,metrica,valor');
  lines.push('Alertas tempranas,Total en riesgo,' + (data.earlyAlertSummary?.totalStudentsAtRisk || 0));
  lines.push('Alertas tempranas,Riesgo alto,' + (data.earlyAlertSummary?.highRiskCount || 0));
  lines.push('Alertas tempranas,Riesgo medio,' + (data.earlyAlertSummary?.mediumRiskCount || 0));
  lines.push('Alertas tempranas,Asistencia < 60%,' + (data.earlyAlertSummary?.attendanceBelow60Count || 0));
  lines.push('Alertas tempranas,Asistencia 60-75%,' + (data.earlyAlertSummary?.attendance60To75Count || 0));
  lines.push('');

  lines.push('seccion,materia,costo_usd');
  (data.costBySubject || []).forEach(s => {
    const totalCost = (s.dailyCost || []).reduce((sum, d) => sum + (d.cost || 0), 0);
    lines.push(`Costo por materia,${s.subjectName || s.subjectId},${totalCost.toFixed(6)}`);
  });
  lines.push('');

  lines.push('seccion,materia,usuarios_semana_actual');
  (data.wausBySubject || []).forEach(s => {
    lines.push(`WAUS por materia,${s.subjectName || s.subjectId},${s.currentWeek || 0}`);
  });
  lines.push('');

  lines.push('seccion,docente,transcripciones,presentaciones,apuntes,bibliografia,total');
  (data.materialUploads?.byTeacher || []).forEach(t => {
    lines.push(`Carga de materiales,${t.teacherId},${t.transcripts || 0},${t.presentations || 0},${t.notes || 0},${t.bibliography || 0},${t.total || 0}`);
  });

  lines.push('');
  lines.push(`cost_source,${data.costSource || 'token-based-fallback'}`);
  lines.push(`generado_en,${new Date().toISOString()}`);
  return lines.join('\n');
}

function buildHtml(data) {
  const t = (v) => String(v ?? '');
  const budget = data.budget || {};
  const earlyAlert = data.earlyAlertSummary || {};
  const costRows = (data.costBySubject || []).map(s => {
    const totalCost = (s.dailyCost || []).reduce((sum, d) => sum + (d.cost || 0), 0);
    return `<tr><td>${t(s.subjectName || s.subjectId)}</td><td>$${totalCost.toFixed(6)}</td></tr>`;
  }).join('');
  const wausRows = (data.wausBySubject || []).map(s =>
    `<tr><td>${t(s.subjectName || s.subjectId)}</td><td>${s.currentWeek || 0}</td></tr>`
  ).join('');
  const materialRows = (data.materialUploads?.byTeacher || []).map(tm =>
    `<tr><td>${t(tm.teacherId)}</td><td>${tm.transcripts || 0}</td><td>${tm.presentations || 0}</td><td>${tm.notes || 0}</td><td>${tm.bibliography || 0}</td><td>${tm.total || 0}</td></tr>`
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
    <div class="kpi-item"><div class="kpi-value">${t(data.dau)}</div><div class="kpi-label">Usuarios activos (hoy)</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.classesProcessed)}</div><div class="kpi-label">Clases procesadas</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.ragInteractions)}</div><div class="kpi-label">Interacciones RAG</div></div>
    <div class="kpi-item"><div class="kpi-value">${t(data.adoptionRate)}%</div><div class="kpi-label">Adopci&oacute;n global</div></div>
    <div class="kpi-item"><div class="kpi-value">$${Number(data.costPerActiveStudent || 0).toFixed(4)}</div><div class="kpi-label">Costo por alumno activo</div></div>
  </div>

  <h2>Presupuesto</h2>
  <table><thead><tr><th>M&eacute;trica</th><th>Valor</th></tr></thead>
  <tbody>
    <tr><td>Presupuesto mensual</td><td>$${Number(budget.monthlyLimit || 0).toFixed(2)}</td></tr>
    <tr><td>Gasto actual</td><td>$${Number(budget.currentSpend || 0).toFixed(2)}</td></tr>
    <tr><td>Proyectado fin de mes</td><td>$${Number(budget.projectedEndOfMonth || 0).toFixed(2)}</td></tr>
    <tr><td>Porcentaje usado</td><td>${Number(budget.percentUsed || 0).toFixed(1)}%</td></tr>
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
  handler: withCorrelation(async (request, context) => {
    const start = Date.now();

    if (!isAuthorized(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Director access required' }) };
    }

    try {
      const format = request.query.get('format') || 'csv';
      if (!['csv', 'pdf'].includes(format)) {
        return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: "Unsupported format. Use 'csv' or 'pdf'" }) };
      }

      const { computeDirectorMetrics, computeBudgetProjection, computeCostSpikeAlert, loadEarlyAlertSummary, POWERBI_DEFAULT_DAYS } = await import('./classes-api.js');
      const { getAzureCostForBudget, computeBudgetProjection: computeBudgetProjectionV2 } = await import('../services/azure-cost.js');

      const metrics = await computeDirectorMetrics(context, POWERBI_DEFAULT_DAYS);
      const azureCost = await getAzureCostForBudget(context);
      const useAzureCost = azureCost?.success;
      const budget = useAzureCost
          ? computeBudgetProjectionV2(azureCost.daily, {
              currentMonthSpend: azureCost.currentMonthSpend,
              costSource: 'azure-cost-api',
          })
          : computeBudgetProjection(metrics.daily);
      const uniqueActiveUsers = metrics.totals.uniqueActiveUsers;
      const effectiveTotalCost = useAzureCost ? azureCost.currentMonthSpend : metrics.totals.totalCost;
      const costPerActiveStudent = uniqueActiveUsers > 0 ? Number((effectiveTotalCost / uniqueActiveUsers).toFixed(6)) : 0;

      let classesCount = 0;
      try {
        const classesClient = getTableClient(process.env.AZURE_TABLE_CLASSES || 'classes');
        for await (const _ of classesClient.listEntities()) {
          classesCount++;
        }
      } catch (err) {
        context.log.warn(`[KpiExport] Could not count classes: ${err.message}`);
      }

      let totalEnrolled = 0;
      try {
        const { loadSubjects } = await import('./classes-api.js');
        const allSubjects = await loadSubjects();
        totalEnrolled = allSubjects.reduce((sum, s) => sum + (s.enrolledCount || 60), 60);
      } catch (err) {
        context.log.warn(`[KpiExport] Could not load subjects: ${err.message}`);
        totalEnrolled = 60;
      }
      const adoptionRate = uniqueActiveUsers > 0 ? Math.min(100, Math.round(uniqueActiveUsers / totalEnrolled * 100)) : 0;

      const earlyAlertSummary = await loadEarlyAlertSummary(context);

      const data = {
        dau: metrics.latest.dau,
        classesProcessed: classesCount,
        ragInteractions: metrics.latest.ragInteractions,
        adoptionRate,
        costPerActiveStudent,
        earlyAlertSummary,
        budget,
        costBySubject: metrics.costBySubject,
        wausBySubject: metrics.wausBySubject,
        materialUploads: metrics.materialUploads,
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

      if (format === 'csv') {
        const csv = buildCsv(data);
        return {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="kpi-snapshot-${generatedAt.slice(0, 10)}.csv"`,
          },
          body: csv,
        };
      }

      const html = buildHtml(data);
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
  }),
});
