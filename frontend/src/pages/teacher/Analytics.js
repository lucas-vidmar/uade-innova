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

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  try {
    const [data, alerts, classes, classViews, enrollments] = await Promise.all([
      api.getTeacherAnalytics(activeSubjectId),
      api.getTeacherAlerts(activeSubjectId),
      api.getClasses(activeSubjectId).catch(() => []),
      api.getClassViews(activeSubjectId).catch(() => []),
      api.getEnrollments(activeSubjectId).catch(() => []),
    ]);
    if (!data || !data.topQuestions || !data.frictionTopics) {
      throw new Error('Datos de analítica incompletos');
    }
    const maxCount = Math.max(...data.topQuestions.map(q => q.count));
    const highAlerts = (alerts || []).filter((item) => item.severity === 'high');

    container.innerHTML = `
    <div class="card" id="teacher-alerts-card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">🚨 Alertas docentes (engagement/material)</span>
        <span class="badge ${highAlerts.length > 0 ? 'badge-error' : 'badge-info'}">${(alerts || []).length} activas</span>
      </div>

      ${(alerts || []).length === 0 ? `
        <div class="empty-state" style="padding:20px">No hay alertas críticas para esta materia.</div>
      ` : `
        <div class="table-wrap">
          <table class="data-table" id="teacher-alerts-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Detalle</th>
                <th>Indicadores</th>
                <th>Severidad</th>
                <th>Acción sugerida</th>
              </tr>
            </thead>
            <tbody>
              ${(alerts || []).map((alert) => {
      const isMaterial = alert.type === 'material_report';
      const detailLabel = isMaterial
        ? `Clase ${alert.classId || '-'} · ${(alert.materialType || 'material').toUpperCase()}`
        : `${alert.studentName || alert.studentId || 'Alumno'} · Clase ${alert.classId || '-'}`;
      const indicators = isMaterial
        ? `${alert.reportCount || 0} reportes`
        : `${alert.attendance || 'N/D'} asistencia · Promedio ${typeof alert.avgGrade === 'number' ? alert.avgGrade : 'N/D'}`;
      return `
                <tr>
                  <td><span class="badge ${isMaterial ? 'badge-warning' : 'badge-error'}">${isMaterial ? 'Material reportado' : 'Bajo engagement'}</span></td>
                  <td>
                    <strong>${alert.title}</strong>
                    <div style="color:var(--color-text-secondary);font-size:var(--font-size-xs)">${detailLabel}</div>
                    <div style="color:var(--color-text-secondary);font-size:var(--font-size-xs)">${alert.description || ''}</div>
                  </td>
                  <td>${indicators}</td>
                  <td><span class="badge ${alert.severity === 'high' ? 'badge-error' : 'badge-warning'}">${alert.severity === 'high' ? 'Alta' : 'Media'}</span></td>
                  <td style="font-size:var(--font-size-xs)">${alert.recommendedAction || '-'}</td>
                </tr>
              `;
    }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>

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

    ${renderStudentProgress(classes, classViews, enrollments, escapeHtml)}
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

function renderStudentProgress(classes, classViews, enrollments, escapeHtml) {
  const studentEnrollments = (enrollments || []).filter(e => e.role === 'student' && e.status === 'active');
  const studentIds = [...new Set([...studentEnrollments.map(e => e.userId), ...classViews.map(v => v.studentId)])];

  if (studentIds.length === 0 || !classes || classes.length === 0) {
    return `
      <div class="card" style="margin-bottom:var(--space-8)">
        <div class="card-header">
          <span class="card-title">👥 Progreso de Alumnos</span>
        </div>
        <div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--text-sm)">No hay alumnos inscriptos o clases para mostrar progreso.</div>
      </div>
    `;
  }

  const studentNames = {};
  for (const e of studentEnrollments) {
    studentNames[e.userId] = e.userId;
  }

  const viewsByStudent = {};
  for (const v of classViews) {
    if (!viewsByStudent[v.studentId]) viewsByStudent[v.studentId] = new Set();
    viewsByStudent[v.studentId].add(v.classId);
  }

  const sortedClasses = [...classes].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  return `
    <div class="card" style="margin-bottom:var(--space-8)">
      <div class="card-header">
        <span class="card-title">👥 Progreso de Alumnos</span>
        <span class="badge badge-info">${studentIds.length} alumnos · ${sortedClasses.length} clases</span>
      </div>
      <div style="overflow-x:auto;padding:var(--space-2)">
        <table class="data-table">
          <thead>
            <tr>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);white-space:nowrap;font-weight:600;position:sticky;left:0;background:var(--color-surface);">Alumno</th>
              ${sortedClasses.map(c => `
                <th style="text-align:center;padding:var(--space-2) var(--space-1);white-space:nowrap;font-size:10px;max-width:80px;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.title)}">${escapeHtml(c.title).split('—')[1]?.trim() || escapeHtml(c.title).slice(0, 20)}</th>
              `).join('')}
              <th style="text-align:center;padding:var(--space-2) var(--space-3);white-space:nowrap;font-weight:600;">% Visto</th>
            </tr>
          </thead>
          <tbody>
            ${studentIds.map(sid => {
              const viewed = viewsByStudent[sid] || new Set();
              const viewedCount = sortedClasses.filter(c => c.summaryReady && viewed.has(c.id)).length;
              const availableCount = sortedClasses.filter(c => c.summaryReady).length;
              const pct = availableCount > 0 ? Math.round((viewedCount / availableCount) * 100) : 0;
              return `
                <tr>
                  <td style="padding:var(--space-2) var(--space-3);font-weight:500;white-space:nowrap;position:sticky;left:0;background:var(--color-surface);">${escapeHtml(studentNames[sid] || sid)}</td>
                  ${sortedClasses.map(c => {
                    if (!c.summaryReady) return '<td style="text-align:center;padding:var(--space-2);color:var(--color-text-muted)">—</td>';
                    const seen = viewed.has(c.id);
                    return `
                      <td style="text-align:center;padding:var(--space-2);">
                        <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:${seen ? '#10b981' : 'var(--color-surface-2)'};color:${seen ? 'white' : 'var(--color-text-muted)'};font-size:11px;line-height:18px;font-weight:700;">${seen ? '✓' : '·'}</span>
                      </td>
                    `;
                  }).join('')}
                  <td style="text-align:center;padding:var(--space-2) var(--space-3);font-weight:600;">${pct}%</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:var(--space-2) var(--space-3);font-size:10px;color:var(--color-text-muted);border-top:1px solid var(--color-border);display:flex;gap:var(--space-4);align-items:center;">
        <span>👤 ${studentIds.length} alumnos</span>
        <span>📚 ${sortedClasses.length} clases</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#10b981;"></span> Visto</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--color-surface-2);"></span> No visto</span>
        <span style="display:flex;align-items:center;gap:4px;color:var(--color-text-muted);">— No disponible</span>
      </div>
    </div>
  `;
}
