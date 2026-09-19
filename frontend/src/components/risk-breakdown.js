/* ============================================================
   risk-breakdown.js — Shared "how is academic risk computed?" explainer
   Mirrors backend computeRisk() in backend/src/functions/interventions-api.js:
   additive score, NOT a weighted average. Threshold values are injected
   dynamically so the help never hardcodes stale numbers (#341).
   ============================================================ */

export const DEFAULT_RISK_THRESHOLDS = {
  attendanceWarning: 60,
  attendanceCritical: 50,
  engagementWarning: 60,
  engagementCritical: 40,
  gradeWarning: 6,
  noLoginDaysLow: 7,
  noLoginDaysMedium: 14,
  noLoginDaysHigh: 21,
  minQueriesMedium: 2,
  minQueriesHigh: 5,
  queryWindowDays: 7,
  queryWindowHighDays: 14,
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Renders the risk-formula explanation HTML for the configured thresholds.
 * @param {object} thresholds Partial threshold config (merged over backend defaults).
 * @param {string|null} scopeLabel Human label of the scope (e.g. subject name/id) or null.
 */
export function renderRiskBreakdownHTML(thresholds = {}, scopeLabel = null) {
  const t = { ...DEFAULT_RISK_THRESHOLDS, ...(thresholds || {}) };
  const low = num(t.noLoginDaysLow, 7);
  const med = num(t.noLoginDaysMedium, 14);
  const high = num(t.noLoginDaysHigh, 21);
  const qMed = num(t.minQueriesMedium, 2);
  const qHigh = num(t.minQueriesHigh, 5);
  const qWin = num(t.queryWindowDays, 7);
  const qWinHigh = num(t.queryWindowHighDays, 14);
  const att = num(t.attendanceWarning, 60);

  return `
      <p style="color:var(--color-text-secondary);margin-bottom:var(--space-4);font-size:0.875rem">
        El puntaje de riesgo es <strong>aditivo</strong>: cada factor suma puntos
        seg&uacute;n los umbrales configurados. A mayor puntaje, mayor riesgo.
        ${scopeLabel ? `<br>Umbrales vigentes para: <strong>${scopeLabel}</strong>` : ''}
      </p>

      <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-4)">
        <h4 style="margin:0 0 var(--space-2);font-size:0.95rem;display:flex;align-items:center;gap:var(--space-2)">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--color-primary);color:#fff;font-size:0.8rem;font-weight:700">1</span>
          Inactividad en plataforma
          <span class="badge badge-info" style="margin-left:auto">hasta +8</span>
        </h4>
        <p style="margin:0;font-size:0.85rem;color:var(--color-text-secondary)">
          D&iacute;as desde el &uacute;ltimo login:
          <br><code>&ge; ${high} d&iacute;as &rarr; +8</code> ·
          <code>&ge; ${med} d&iacute;as &rarr; +5</code> ·
          <code>&ge; ${low} d&iacute;as &rarr; +2</code>
          <br>Sin actividad registrada: <code>+8</code>.
        </p>
      </div>

      <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-4)">
        <h4 style="margin:0 0 var(--space-2);font-size:0.95rem;display:flex;align-items:center;gap:var(--space-2)">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--color-primary);color:#fff;font-size:0.8rem;font-weight:700">2</span>
          Consultas en plataforma
          <span class="badge badge-info" style="margin-left:auto">hasta +4</span>
        </h4>
        <p style="margin:0;font-size:0.85rem;color:var(--color-text-secondary)">
          <code>&lt; ${qMed} consultas en ${qWin} d&iacute;as &rarr; +4</code>
          <br><code>&lt; ${qHigh} consultas en ${qWinHigh} d&iacute;as &rarr; +1</code>
        </p>
      </div>

      <div class="card" style="padding:var(--space-4);margin-bottom:var(--space-4)">
        <h4 style="margin:0 0 var(--space-2);font-size:0.95rem;display:flex;align-items:center;gap:var(--space-2)">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--color-primary);color:#fff;font-size:0.8rem;font-weight:700">3</span>
          Asistencia
          <span class="badge badge-info" style="margin-left:auto">+3</span>
        </h4>
        <p style="margin:0;font-size:0.85rem;color:var(--color-text-secondary)">
          <code>asistencia &lt; ${att}% &rarr; +3</code>
        </p>
      </div>

      <div style="background:var(--color-surface-2);border-radius:var(--radius-md);padding:var(--space-4);margin-bottom:var(--space-3)">
        <h4 style="margin:0 0 var(--space-2);font-size:0.95rem">Puntaje final y niveles</h4>
        <p style="margin:0;font-size:0.85rem;color:var(--color-text-secondary);font-family:monospace">
          score = inactividad + consultas + asistencia
        </p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--space-3)">
        <div class="card" style="padding:var(--space-3);text-align:center;border-left:4px solid var(--color-error)">
          <p style="margin:0;font-weight:700;color:var(--color-error)">Alto</p>
          <p style="margin:var(--space-1) 0 0;font-size:0.8rem;color:var(--color-text-muted)">score &ge; 7</p>
        </div>
        <div class="card" style="padding:var(--space-3);text-align:center;border-left:4px solid var(--color-warning)">
          <p style="margin:0;font-weight:700;color:var(--color-warning)">Medio</p>
          <p style="margin:var(--space-1) 0 0;font-size:0.8rem;color:var(--color-text-muted)">score 4 - 6</p>
        </div>
        <div class="card" style="padding:var(--space-3);text-align:center;border-left:4px solid var(--color-success)">
          <p style="margin:0;font-weight:700;color:var(--color-success)">Bajo</p>
          <p style="margin:var(--space-1) 0 0;font-size:0.8rem;color:var(--color-text-muted)">score &lt; 4</p>
        </div>
      </div>`;
}
