import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

function esc(str) { return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

export async function renderDirectorSatAnalytics(container) {
  renderHeader('Analítica SAT por Prompt');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando analítica SAT...</div>`;

  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  try {
    const [satData, classesData] = await Promise.all([
      api.getSatAnalytics({ subjectId: activeSubjectId }),
      api.getClasses(activeSubjectId),
    ]);

    const classes = Array.isArray(classesData) ? classesData : [];
    const segments = satData?.segments || [];
    const total = satData?.total || 0;

    let selectedClassId = '';

    container.innerHTML = `
    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-header">
        <span class="card-title">Filtros</span>
      </div>
      <div style="display:flex;gap:var(--space-4);align-items:end;flex-wrap:wrap">
        <div>
          <label class="form-label">Materia</label>
          <div style="font-weight:600;padding:8px 0">${activeSubjectId}</div>
        </div>
        <div>
          <label class="form-label" for="sat-class-filter">Clase (opcional)</label>
          <select id="sat-class-filter" class="form-select" style="min-width:200px">
            <option value="">Todas las clases</option>
            ${classes.map(c => `<option value="${esc(c.id)}">${esc(c.title || c.id)}</option>`).join('')}
          </select>
        </div>
        <button id="sat-apply-filter" class="btn btn-primary">Filtrar</button>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:var(--space-6)">
      <div class="kpi-card">
        <div class="kpi-label">Total calificaciones</div>
        <div class="kpi-value">${total}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Versiones de prompt</div>
        <div class="kpi-value">${segments.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">SAT global</div>
        <div class="kpi-value" style="color:var(--color-primary-light)">${total > 0 ? Math.round((segments.reduce((s, x) => s + x.positive, 0) / total) * 100) : 0}%</div>
      </div>
    </div>

    <div class="card" id="sat-segments-card">
      <div class="card-header">
        <span class="card-title">Segmentación por versión de prompt</span>
        <span class="badge badge-info">${segments.length} segmentos</span>
      </div>
      ${segments.length === 0 ? `
        <div class="empty-state" style="padding:20px">No hay calificaciones para los filtros seleccionados.</div>
      ` : `
      <div class="table-wrap">
        <table class="data-table" id="sat-segments-table">
          <thead>
            <tr>
              <th>Versión de prompt</th>
              <th>Calificaciones</th>
              <th>Positivas</th>
              <th>SAT Score</th>
              <th>Barra</th>
            </tr>
          </thead>
          <tbody>
            ${segments.map(s => {
      const pct = Math.max(0, Math.min(100, Math.round((s.satScore || 0) * 100)));
      return `
              <tr>
                <td><code>${esc(s.promptVersion)}</code></td>
                <td>${s.rated}</td>
                <td>${s.positive}</td>
                <td><strong>${pct}%</strong></td>
                <td style="width:200px">
                  <div class="progress-bar">
                    <div class="progress-fill" style="--progress-value:${pct}%;background:var(--color-success)"></div>
                  </div>
                </td>
              </tr>
            `;
    }).join('')}
          </tbody>
        </table>
      </div>
      `}
      <small style="display:block;margin-top:var(--space-3);color:var(--color-text-muted)">
        SAT Score = proporción de calificaciones positivas sobre el total.
      </small>
    </div>
    `;

    const classFilter = container.querySelector('#sat-class-filter');
    const applyBtn = container.querySelector('#sat-apply-filter');

    applyBtn.addEventListener('click', async () => {
      selectedClassId = classFilter.value;
      container.querySelector('#sat-segments-card').innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Filtrando...</div>`;
      try {
        const filtered = await api.getSatAnalytics({ subjectId: activeSubjectId, classId: selectedClassId });
        renderSegmentsTable(container, filtered.segments || [], filtered.total || 0);
      } catch (err) {
        console.error('[SAT] Error filtering:', err);
        container.querySelector('#sat-segments-card').innerHTML = `<div class="empty-state" style="padding:20px">Error al filtrar datos SAT.</div>`;
      }
    });
  } catch (err) {
    console.error('[SAT] Error loading analytics:', err);
    container.innerHTML = `
      <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
        <div class="empty-state-icon" aria-hidden="true">📊</div>
        <h2 class="h3">SAT Analytics no disponible</h2>
        <p style="color:var(--color-text-secondary)">No se pudieron cargar los datos. Verificá que el endpoint del backend esté activo.</p>
        <button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar">Reintentar</button>
      </div>
    `;
  }
}

function renderSegmentsTable(container, segments, total) {
  const card = container.querySelector('#sat-segments-card');
  if (!card) return;

  const allKpis = container.querySelector('.grid-3');
  if (allKpis) {
    allKpis.querySelectorAll('.kpi-value')[0].textContent = total;
    allKpis.querySelectorAll('.kpi-value')[1].textContent = segments.length;
    allKpis.querySelectorAll('.kpi-value')[2].textContent = total > 0
      ? Math.round((segments.reduce((s, x) => s + x.positive, 0) / total) * 100) + '%'
      : '0%';
  }

  if (segments.length === 0) {
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">Segmentación por versión de prompt</span>
        <span class="badge badge-info">0 segmentos</span>
      </div>
      <div class="empty-state" style="padding:20px">No hay calificaciones para los filtros seleccionados.</div>
    `;
    return;
  }

  const maxRated = Math.max(...segments.map(s => s.rated), 1);
  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">Segmentación por versión de prompt</span>
      <span class="badge badge-info">${segments.length} segmentos</span>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Versión de prompt</th>
            <th>Calificaciones</th>
            <th>Positivas</th>
            <th>SAT Score</th>
            <th>Barra</th>
          </tr>
        </thead>
        <tbody>
          ${segments.map(s => {
    const pct = Math.max(0, Math.min(100, Math.round((s.satScore || 0) * 100)));
    return `
            <tr>
              <td><code>${esc(s.promptVersion)}</code></td>
              <td>${s.rated}</td>
              <td>${s.positive}</td>
              <td><strong>${pct}%</strong></td>
              <td style="width:200px">
                <div class="progress-bar">
                  <div class="progress-fill" style="--progress-value:${pct}%;background:var(--color-success)"></div>
                </div>
              </td>
            </tr>
          `;
  }).join('')}
        </tbody>
      </table>
    </div>
    <small style="display:block;margin-top:var(--space-3);color:var(--color-text-muted)">
      SAT Score = proporción de calificaciones positivas sobre el total.
    </small>
  `;
}
