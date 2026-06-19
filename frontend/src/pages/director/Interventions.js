import { api } from '../../services/api.js';
import { renderHeader } from '../../components/Header.js';

export async function renderDirectorInterventions(container) {
  renderHeader('Intervenciones');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando intervenciones...</div>`;

  const [interventions = [], thresholdsData = null] = await Promise.all([
    api.getInterventions({}),
    api.getRiskThresholds(),
  ]);

  const thresholds = thresholdsData?.success ? thresholdsData.data : null;

  container.innerHTML = `
    <div style="padding:var(--space-6);max-width:1400px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-6)">
        <div>
          <h2 style="margin:0;color:var(--color-text-primary);font-size:1.5rem">Estudiantes en Riesgo</h2>
          <p style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:0.875rem">
            ${interventions.length} estudiantes requieren atenci&oacute;n
          </p>
        </div>
        <div style="display:flex;gap:var(--space-3)">
          <button class="btn btn-secondary" id="btn-refresh-interventions" style="display:inline-flex;align-items:center;gap:var(--space-2)">
            <span>&#x21bb;</span> Recalcular
          </button>
          <button class="btn btn-secondary" id="btn-thresholds-config" style="display:inline-flex;align-items:center;gap:var(--space-2)">
            <span>&#x2699;</span> Umbrales
          </button>
        </div>
      </div>

      <div id="interventions-filters" style="display:flex;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap">
        <select id="filter-state" class="input" style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)">
          <option value="">Todos los estados</option>
          <option value="assigned">Asignado</option>
          <option value="contacted">Contactado</option>
          <option value="resolved">Resuelto</option>
        </select>
        <select id="filter-risk" class="input" style="padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)">
          <option value="">Todos los niveles</option>
          <option value="high">Alto</option>
          <option value="medium">Medio</option>
          <option value="low">Bajo</option>
        </select>
        <button class="btn btn-primary btn-sm" id="btn-apply-filters">Filtrar</button>
      </div>

      <div id="interventions-list" class="card" style="overflow:hidden">
        ${interventions.length === 0 ? `
          <div style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">
            <p style="font-size:1.125rem;margin-bottom:var(--space-2)">No hay intervenciones activas</p>
            <p style="font-size:0.875rem">Todos los estudiantes presentan actividad normal.</p>
          </div>
        ` : `
          <table class="data-table" id="interventions-table">
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>RIESGO</th>
                <th>Puntaje</th>
                <th>Motivo</th>
                <th>ESTADO</th>
                <th>Creado</th>
                <th>&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              ${interventions.map((item, idx) => `
                <tr class="intervention-row" data-index="${idx}" style="cursor:pointer">
                  <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(item.studentId || item.id)}</td>
                  <td><span class="badge ${item.risk === 'high' ? 'badge-error' : item.risk === 'medium' ? 'badge-warning' : 'badge-success'}">${item.risk === 'high' ? 'Alto' : item.risk === 'medium' ? 'Medio' : 'Bajo'}</span></td>
                  <td>${item.score}</td>
                  <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.reason)}</td>
                  <td><span class="badge ${item.state === 'resolved' ? 'badge-success' : item.state === 'contacted' ? 'badge-warning' : 'badge-info'}">${item.state === 'assigned' ? 'Asignado' : item.state === 'contacted' ? 'Contactado' : 'Resuelto'}</span></td>
                  <td style="font-size:0.8rem;color:var(--color-text-muted)">${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '-'}</td>
                  <td><button class="btn btn-sm btn-primary" data-action="view" data-idx="${idx}">Detalle</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      <div id="intervention-detail-modal" class="modal-overlay" style="display:none">
        <div class="modal-content" style="max-width:600px">
          <div class="modal-header">
            <h3 id="detail-student-id" style="margin:0;font-family:monospace"></h3>
            <button class="modal-close" id="detail-modal-close">&times;</button>
          </div>
          <div class="modal-body" id="detail-body"></div>
          <div class="modal-footer" id="detail-footer"></div>
        </div>
      </div>

      <div id="thresholds-modal" class="modal-overlay" style="display:none">
        <div class="modal-content" style="max-width:600px">
          <div class="modal-header">
            <h3 style="margin:0">Configuraci&oacute;n de Umbrales de Riesgo</h3>
            <button class="modal-close" id="thresholds-modal-close">&times;</button>
          </div>
          <div class="modal-body" id="thresholds-body"></div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="thresholds-cancel">Cancelar</button>
            <button class="btn btn-primary" id="thresholds-save">Guardar Cambios</button>
          </div>
        </div>
      </div>
    </div>
  `;

  let currentInterventions = [...interventions];
  let detailOpen = false;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function getStateLabel(state) {
    const labels = { assigned: 'Asignado', contacted: 'Contactado', resolved: 'Resuelto' };
    return labels[state] || state;
  }

  function renderDetail(item) {
    const detailEl = document.getElementById('intervention-detail-modal');
    document.getElementById('detail-student-id').textContent = `Estudiante: ${item.studentId || item.id}`;

    const notes = Array.isArray(item.notes) ? item.notes : [];

    document.getElementById('detail-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-bottom:var(--space-4)">
        <div class="card" style="padding:var(--space-3)">
          <p style="margin:0;font-size:0.75rem;color:var(--color-text-muted);text-transform:uppercase">Riesgo</p>
          <p style="margin:var(--space-1) 0 0;font-size:1.125rem;font-weight:600;color:${item.risk === 'high' ? 'var(--color-error)' : item.risk === 'medium' ? 'var(--color-warning)' : 'var(--color-success)'}">${item.risk === 'high' ? 'Alto' : item.risk === 'medium' ? 'Medio' : 'Bajo'}</p>
        </div>
        <div class="card" style="padding:var(--space-3)">
          <p style="margin:0;font-size:0.75rem;color:var(--color-text-muted);text-transform:uppercase">Puntaje</p>
          <p style="margin:var(--space-1) 0 0;font-size:1.125rem;font-weight:600">${item.score}/10</p>
        </div>
      </div>
      <div class="card" style="padding:var(--space-3);margin-bottom:var(--space-4)">
        <p style="margin:0;font-size:0.75rem;color:var(--color-text-muted);text-transform:uppercase">Motivo</p>
        <p style="margin:var(--space-1) 0 0">${escapeHtml(item.reason)}</p>
      </div>
      <div class="card" style="padding:var(--space-3);margin-bottom:var(--space-4)">
        <p style="margin:0 0 var(--space-2);font-size:0.75rem;color:var(--color-text-muted);text-transform:uppercase">Estado Actual</p>
        <span class="badge ${item.state === 'resolved' ? 'badge-success' : item.state === 'contacted' ? 'badge-warning' : 'badge-info'}" style="font-size:0.875rem">${getStateLabel(item.state)}</span>
      </div>
      <div style="margin-bottom:var(--space-4)">
        <p style="margin:0 0 var(--space-2);font-size:0.75rem;color:var(--color-text-muted);text-transform:uppercase">Cambiar Estado</p>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          ${['assigned', 'contacted', 'resolved'].filter(s => s !== item.state).map(s => `
            <button class="btn btn-sm ${s === 'resolved' ? 'btn-success' : s === 'contacted' ? 'btn-warning' : 'btn-primary'}" data-action="transition" data-state="${s}">${getStateLabel(s)}</button>
          `).join('')}
        </div>
        <textarea id="transition-note" class="input" style="width:100%;margin-top:var(--space-2);padding:var(--space-2);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border);min-height:60px;resize:vertical" placeholder="Nota opcional sobre esta transici&oacute;n..."></textarea>
      </div>
      ${notes.length > 0 ? `
        <div>
          <p style="margin:0 0 var(--space-2);font-size:0.75rem;color:var(--color-text-muted);text-transform:uppercase">Historial</p>
          ${notes.map(n => `
            <div style="padding:var(--space-2);border-left:2px solid var(--color-border);margin-bottom:var(--space-2);padding-left:var(--space-3)">
              <p style="margin:0;font-size:0.8rem;color:var(--color-text-secondary)">${escapeHtml(n.action)}</p>
              <p style="margin:var(--space-1) 0 0;font-size:0.75rem;color:var(--color-text-muted)">${n.note ? escapeHtml(n.note) : ''} ${n.timestamp ? '— ' + new Date(n.timestamp).toLocaleString() : ''}</p>
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    document.getElementById('detail-footer').innerHTML = `
      <button class="btn btn-secondary" id="detail-close-btn">Cerrar</button>
    `;

    detailEl.style.display = 'flex';
    detailOpen = true;

    document.getElementById('detail-modal-close').onclick = () => { detailEl.style.display = 'none'; detailOpen = false; };
    document.getElementById('detail-close-btn').onclick = () => { detailEl.style.display = 'none'; detailOpen = false; };
    detailEl.onclick = (e) => { if (e.target === detailEl) { detailEl.style.display = 'none'; detailOpen = false; } };
    document.addEventListener('keydown', closeOnEscape);
    function closeOnEscape(e) { if (e.key === 'Escape' && detailOpen) { detailEl.style.display = 'none'; detailOpen = false; document.removeEventListener('keydown', closeOnEscape); } }

    document.querySelectorAll('[data-action="transition"]').forEach(btn => {
      btn.onclick = async () => {
        const newState = btn.dataset.state;
        const note = document.getElementById('transition-note').value;
        const result = await api.updateIntervention(item.id, item.subjectId, newState, note);
        if (result?.success) {
          item.state = newState;
          renderDetail(item);
          await reloadInterventions();
        }
      };
    });
  }

  async function reloadInterventions(filterState, filterRisk) {
    const result = await api.getInterventions({ state: filterState || undefined, risk: filterRisk || undefined });
    if (result?.length !== undefined) {
      currentInterventions = result;
      const tbody = document.querySelector('#interventions-table tbody');
      if (!tbody) return;
      tbody.innerHTML = currentInterventions.map((item, idx) => `
        <tr class="intervention-row" data-index="${idx}" style="cursor:pointer">
          <td style="font-family:monospace;font-size:0.8rem">${escapeHtml(item.studentId || item.id)}</td>
          <td><span class="badge ${item.risk === 'high' ? 'badge-error' : item.risk === 'medium' ? 'badge-warning' : 'badge-success'}">${item.risk === 'high' ? 'Alto' : item.risk === 'medium' ? 'Medio' : 'Bajo'}</span></td>
          <td>${item.score}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.reason)}</td>
          <td><span class="badge ${item.state === 'resolved' ? 'badge-success' : item.state === 'contacted' ? 'badge-warning' : 'badge-info'}">${getStateLabel(item.state)}</span></td>
          <td style="font-size:0.8rem;color:var(--color-text-muted)">${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '-'}</td>
          <td><button class="btn btn-sm btn-primary" data-action="view" data-idx="${idx}">Detalle</button></td>
        </tr>
      `).join('');
      bindRowClicks();
    }
  }

  function bindRowClicks() {
    document.querySelectorAll('[data-action="view"]').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const item = currentInterventions[idx];
        if (item) renderDetail(item);
      };
    });
  }
  bindRowClicks();

  document.getElementById('btn-refresh-interventions').onclick = async () => {
    document.getElementById('btn-refresh-interventions').disabled = true;
    await api.computeInterventions();
    await reloadInterventions();
    document.getElementById('btn-refresh-interventions').disabled = false;
  };

  document.getElementById('btn-apply-filters').onclick = () => {
    const state = document.getElementById('filter-state').value;
    const risk = document.getElementById('filter-risk').value;
    reloadInterventions(state, risk);
  };

  document.getElementById('btn-thresholds-config').onclick = () => renderThresholdsModal(thresholds);

  function renderThresholdsModal(data) {
    const modal = document.getElementById('thresholds-modal');
    const body = document.getElementById('thresholds-body');
    const config = data?.thresholds || {};

    body.innerHTML = `
      <p style="color:var(--color-text-secondary);margin-bottom:var(--space-4);font-size:0.875rem">
        Configurar los umbrales que determinan los niveles de riesgo. Los cambios se aplican inmediatamente al pr&oacute;ximo c&aacute;lculo.
      </p>
      ${data?.source === 'override' ? '<p style="color:var(--color-warning);font-size:0.8rem;margin-bottom:var(--space-3)">Esta materia tiene configuraci&oacute;n personalizada.</p>' : ''}
      <div style="display:grid;gap:var(--space-3)">
        <label style="font-size:0.875rem;color:var(--color-text-secondary)">D&iacute;as sin login - Riesgo Bajo
          <input id="th-no-login-low" class="input" type="number" value="${config.noLoginDaysLow || 7}" style="width:100%;margin-top:var(--space-1);padding:var(--space-2);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)"></label>
        <label style="font-size:0.875rem;color:var(--color-text-secondary)">D&iacute;as sin login - Riesgo Medio
          <input id="th-no-login-medium" class="input" type="number" value="${config.noLoginDaysMedium || 14}" style="width:100%;margin-top:var(--space-1);padding:var(--space-2);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)"></label>
        <label style="font-size:0.875rem;color:var(--color-text-secondary)">D&iacute;as sin login - Riesgo Alto
          <input id="th-no-login-high" class="input" type="number" value="${config.noLoginDaysHigh || 21}" style="width:100%;margin-top:var(--space-1);padding:var(--space-2);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)"></label>
        <label style="font-size:0.875rem;color:var(--color-text-secondary)">M&iacute;n. consultas en 7d (Riesgo Medio)
          <input id="th-min-queries-medium" class="input" type="number" value="${config.minQueriesMedium || 2}" style="width:100%;margin-top:var(--space-1);padding:var(--space-2);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)"></label>
        <label style="font-size:0.875rem;color:var(--color-text-secondary)">M&iacute;n. consultas en 14d (Riesgo Alto)
          <input id="th-min-queries-high" class="input" type="number" value="${config.minQueriesHigh || 5}" style="width:100%;margin-top:var(--space-1);padding:var(--space-2);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)"></label>
      </div>
    `;

    modal.style.display = 'flex';
    document.getElementById('thresholds-modal-close').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('thresholds-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    document.getElementById('thresholds-save').onclick = async () => {
      const newConfig = {
        noLoginDaysLow: parseInt(document.getElementById('th-no-login-low').value, 10) || 7,
        noLoginDaysMedium: parseInt(document.getElementById('th-no-login-medium').value, 10) || 14,
        noLoginDaysHigh: parseInt(document.getElementById('th-no-login-high').value, 10) || 21,
        minQueriesMedium: parseInt(document.getElementById('th-min-queries-medium').value, 10) || 2,
        minQueriesHigh: parseInt(document.getElementById('th-min-queries-high').value, 10) || 5,
      };
      const result = await api.updateRiskThresholds('default', newConfig);
      if (result?.success) {
        modal.style.display = 'none';
      }
    };
  }
}
