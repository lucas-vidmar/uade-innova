/* ============================================================
   Teacher Analytics — Query insights & friction topics
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

export async function renderTeacherAnalytics(container) {
  renderHeader('Analítica Pedagógica');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando analítica...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  try {
    const data = await api.getTeacherAnalytics(activeSubjectId);
    if (!data || !data.topQuestions || !data.frictionTopics) {
      throw new Error('Datos de analítica incompletos');
    }
    const maxCount = Math.max(...data.topQuestions.map(q => q.count));

    container.innerHTML = `
    <div class="grid-2" style="margin-bottom:var(--space-8)">
      <!-- Top Questions -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">💬 Consultas más frecuentes</span>
          <span class="badge badge-info">Últimos 30 días</span>
        </div>
        <div class="word-cloud">
          ${data.topQuestions.map(q => {
    const size = 11 + Math.round((q.count / maxCount) * 14);
    const opacity = 0.5 + (q.count / maxCount) * 0.5;
    return `<span class="word-cloud-word" style="font-size:${size}px;opacity:${opacity}">${q.text}</span>`;
  }).join('')}
        </div>
      </div>

      <!-- Friction Topics -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">🔥 Temas con más fricción</span>
          <span class="badge badge-warning">Priorizar en clase</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-4)">
          ${data.frictionTopics.map((t, i) => {
    const pct = Math.round((t.unresolved / t.queries) * 100);
    return `
              <div class="friction-item">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
                  <span style="font-size:var(--font-size-sm);font-weight:600">${i + 1}. ${t.topic}</span>
                  <span class="badge badge-error">${pct}% sin resolver</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="--progress-value:${pct}%"></div>
                </div>
                <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:4px">${t.queries} consultas · ${t.unresolved} sin respuesta satisfactoria</div>
              </div>
            `;
  }).join('')}
        </div>
      </div>
    </div>

    <!-- Queries over time (simple bar chart) -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">📈 Frecuencia de consultas por tema</span>
      </div>
      <div class="bar-chart">
        ${data.topQuestions.map(q => `
          <div class="bar-chart-item">
            <div class="bar-chart-bar-wrap">
              <div class="bar-chart-bar" style="--bar-height:${Math.round((q.count / maxCount) * 100)}%" title="${q.count} consultas"></div>
            </div>
            <div class="bar-chart-label">${q.text.split(' ')[0]}</div>
            <div class="bar-chart-val">${q.count}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  } catch (err) {
    console.error('Error loading analytics:', err);
    container.innerHTML = `
      <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
        <div class="empty-state-icon" aria-hidden="true">📊</div>
        <h2 class="h3">Analítica no disponible</h2>
        <p style="color:var(--color-text-secondary)">No se pudieron cargar los datos de analítica. Posiblemente el endpoint del backend no está activo.</p>
        <button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar cargar la página">Reintentar</button>
      </div>
    `;
  }
}
