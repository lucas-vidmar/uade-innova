import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { renderBottomNav } from '../../components/BottomNav.js';
import { toast } from '../../components/Toast.js';

const STATUS_LABELS = {
  pending: 'Pendiente',
  resolved: 'Resuelto',
  verified: 'Verificado',
};

const STATUS_BADGE = {
  pending: 'badge-error',
  resolved: 'badge-success',
  verified: 'badge-primary',
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function renderStudentReports(container) {
  renderHeader('Mis Reportes');
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando reportes...</div>';

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();

  if (!activeSubjectId) {
    container.innerHTML = '<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>';
    return;
  }

  let reports = [];
  try {
    reports = await api.getStudentReports(activeSubjectId);
  } catch (err) {
    console.error('[StudentReports] Failed to load:', err);
    toast('error', 'Error', 'No se pudieron cargar los reportes.');
  }

  const pendingCount = reports.filter(r => r.status === 'pending').length;
  const resolvedCount = reports.filter(r => r.status === 'resolved' || r.status === 'verified').length;

  container.innerHTML = `
    <div class="settings-page" style="max-width:800px;margin:0 auto;padding:var(--space-6)">
      <h2 class="h3" style="margin-bottom:var(--space-2)">Mis Reportes de Calidad IA</h2>
      <p style="color:var(--color-text-secondary);margin-bottom:var(--space-8)">
        Los reportes que enviaste sobre respuestas incorrectas del asistente.
      </p>

      <div class="grid-2" style="margin-bottom:var(--space-6)">
        <div class="kpi-card">
          <div class="kpi-label">Pendientes</div>
          <div class="kpi-value" style="color:var(--color-error)">${pendingCount}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Resueltos</div>
          <div class="kpi-value" style="color:var(--color-success)">${resolvedCount}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Reportes enviados</span>
          <span class="badge badge-neutral">${reports.length}</span>
        </div>
        ${reports.length === 0
          ? '<div class="empty-state" style="padding:32px">No enviaste reportes todavía. Si una respuesta del asistente no es correcta, podés reportarla usando el botón "Reportar respuesta incorrecta" en el chat.</div>'
          : `<div class="class-list">
              ${reports.map(r => {
                const date = r.createdAt
                  ? new Date(r.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : '---';
                const isResolved = r.status === 'resolved' || r.status === 'verified';

                return `
                  <div class="class-list-item" style="align-items:flex-start">
                    <div class="class-list-date" style="min-width:40px">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--color-warning)">
                        <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/>
                        <path d="M12 9v4"/><path d="M12 17h.01"/>
                      </svg>
                    </div>
                    <div class="class-list-info">
                      <div class="class-list-title"><strong>${escapeHtml(r.question || 'Consulta sin título')}</strong></div>
                      <div class="class-list-topics">${escapeHtml(r.issueDetail || 'Sin detalle')}</div>
                      ${isResolved && r.comments ? `<div class="class-list-files" style="margin-top:var(--space-2);padding:var(--space-2);background:var(--color-surface-2);border-radius:var(--radius-sm)"><strong>Respuesta del profesor:</strong> ${escapeHtml(r.comments)}</div>` : ''}
                      <div class="class-list-files" style="margin-top:4px">Enviado ${date} ${isResolved ? `· Resuelto ${r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : ''}` : ''}</div>
                    </div>
                    <div class="class-list-actions" style="gap:var(--space-2)">
                      <span class="badge ${STATUS_BADGE[r.status] || 'badge-neutral'}">${STATUS_LABELS[r.status] || r.status}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>`}
      </div>
    </div>
  `;

  renderBottomNav();
}
