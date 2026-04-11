/* ============================================================
   Director Dashboard — Adoption metrics & early alerts
   ============================================================ */
import { api } from '../../services/api.js';
import { renderHeader } from '../../components/Header.js';

export async function renderDirectorDashboard(container) {
    renderHeader('Panel Directivo');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando datos directivos...</div>`;

    const [data = {}, powerBiMetrics = null, vectorHealth = null] = await Promise.all([
        api.getDirectorStats(),
        api.getDirectorPowerBiMetrics(14),
        api.getVectorHealth(),
    ]);

    const defaultEarlyAlertSummary = {
        totalStudentsAtRisk: 0,
        highRiskCount: 0,
        mediumRiskCount: 0,
        lowAttendanceCount: 0,
        lowGradeCount: 0,
        attendanceBelow60Count: 0,
        attendance60To75Count: 0,
        attendanceAbove75Count: 0,
    };
    const earlyAlertSummary = { ...defaultEarlyAlertSummary, ...(data.earlyAlertSummary || {}) };
    const subjectAdoption = data.subjectAdoption || [];
    const maxRate = subjectAdoption.length > 0 ? Math.max(...subjectAdoption.map(s => s.rate)) : 0;

    container.innerHTML = `
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

    <div class="card" id="powerbi-card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">${icon('chart')} Power BI — DAU y Consumo de Tokens</span>
        <span class="badge badge-info">${(powerBiMetrics?.source?.mode || 'continuous-export-db').replace('-', ' ')}</span>
      </div>
      <p style="margin:0 0 var(--space-4);color:var(--color-text-secondary)">
        Fuente: ${powerBiMetrics?.source?.storage || 'Azure Table Storage'} · Tabla ${powerBiMetrics?.source?.table || 'SessionMetrics'} · Ventana ${powerBiMetrics?.windowDays || 14} días
      </p>
      <div class="table-wrap">
        <table class="data-table" id="powerbi-metrics-table">
          <thead>
            <tr><th>Fecha</th><th>DAU</th><th>Tokens</th><th>Interacciones RAG</th></tr>
          </thead>
          <tbody>
            ${(Array.isArray(powerBiMetrics?.daily) && powerBiMetrics.daily.length > 0)
                ? powerBiMetrics.daily.map((item) => `
                    <tr>
                      <td>${item.date}</td>
                      <td><strong>${item.dau}</strong></td>
                      <td>${Number(item.totalTokens || 0).toLocaleString('es-AR')}</td>
                      <td>${item.ragInteractions}</td>
                    </tr>
                  `).join('')
                : '<tr><td colspan="4" style="text-align:center;padding:20px">Sin datos para exportar a Power BI.</td></tr>'}
          </tbody>
        </table>
      </div>
      <small style="display:block;margin-top:var(--space-3);color:var(--color-text-secondary)">Última actualización: ${powerBiMetrics?.updatedAt || 'n/a'}</small>
    </div>

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
      <!-- Adoption by subject -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">${icon('book')} Adopción por Materia</span>
          <span class="badge badge-info">Piloto 2026-1</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-5)">
          ${subjectAdoption.length > 0 ? subjectAdoption.map(s => `
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
                <span style="font-size:var(--font-size-sm);font-weight:600">${s.name}</span>
                <span style="font-size:var(--font-size-sm);font-weight:700;color:${s.rate >= 70 ? 'var(--color-success)' : s.rate >= 50 ? 'var(--color-warning)' : 'var(--color-error)'}">${s.rate}%</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="--progress-value:${s.rate}%;background:${s.rate >= 70 ? 'var(--color-success)' : s.rate >= 50 ? 'var(--color-warning)' : 'var(--color-error)'}"></div>
              </div>
            </div>
          `).join('') : '<div class="empty-state">No hay datos de adopción.</div>'}
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
            <thead>
              <tr><th>Métrica</th><th>Valor</th></tr>
            </thead>
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
        <div style="margin-top:var(--space-4)">
          <button class="btn btn-secondary btn-sm">Exportar listado</button>
        </div>
      </div>
    </div>
  `;
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
