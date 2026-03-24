/* ============================================================
   Director Dashboard — Adoption metrics & early alerts
   ============================================================ */
import { api } from '../../services/api.js';
import { renderHeader } from '../../components/Header.js';

export async function renderDirectorDashboard(container) {
    renderHeader('Panel Directivo');
    container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando datos directivos...</div>`;

    const [data = {}, earlyAlerts = []] = await Promise.all([
        api.getDirectorStats(),
        api.getEarlyAlerts()
    ]);
    
    // Inject early alerts into the data object for compatibility with the existing template
    data.earlyAlerts = earlyAlerts || [];
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

    <div class="grid-2">
      <!-- Adoption by subject -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">📚 Adopción por Materia</span>
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
          <span class="card-title">⚠️ Alertas Tempranas</span>
          <span class="badge badge-error">${data.earlyAlerts.length} alumnos</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Alumno</th><th>Materia</th><th>Asistencia</th><th>Promedio</th><th>Riesgo</th></tr>
            </thead>
            <tbody>
              ${data.earlyAlerts.length > 0 ? data.earlyAlerts.map(a => `
                <tr>
                  <td><strong>${a.name}</strong></td>
                  <td style="color:var(--color-text-secondary);font-size:var(--font-size-xs)">${a.subject}</td>
                  <td>${a.attendance}</td>
                  <td style="color:${parseFloat(a.avgGrade) >= 6 ? 'var(--color-success)' : 'var(--color-error)'}">${a.avgGrade}</td>
                  <td><span class="badge ${a.risk === 'high' ? 'badge-error' : 'badge-warning'}">${a.risk === 'high' ? '🔴 Alto' : '🟡 Medio'}</span></td>
                </tr>
              `).join('') : '<tr><td colspan="5" style="text-align:center;padding:20px">No hay alertas tempranas activas.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div style="margin-top:var(--space-4)">
          <button class="btn btn-secondary btn-sm">📥 Exportar listado</button>
        </div>
      </div>
    </div>
  `;
}
