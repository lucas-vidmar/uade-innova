import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';
import { renderRiskBreakdownHTML } from '../../components/risk-breakdown.js';

export async function renderDirectorInterventions(container) {
  renderHeader('Intervenciones');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando intervenciones...</div>`;

  // #341: thresholds are per-subject. Scope reads/saves to the active
  // subject instead of the hardcoded 'default' partition.
  const activeSubjectId = auth.getActiveSubjectId() || 'default';

  const [interventions = [], thresholdsData = null] = await Promise.all([
    api.getInterventions({}),
    api.getRiskThresholds(activeSubjectId),
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
          <button class="btn btn-secondary" id="btn-risk-breakdown" style="display:inline-flex;align-items:center;gap:var(--space-2)">
            <span>&#x2139;</span> ¿Cómo se calcula?
          </button>
          <button class="btn btn-secondary" id="btn-thresholds-config" style="display:inline-flex;align-items:center;gap:var(--space-2)">
            <span>&#x2699;</span> Configurar umbrales
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

      <div id="risk-breakdown-modal" class="modal-overlay" style="display:none">
        <div class="modal-content" style="max-width:640px">
          <div class="modal-header">
            <h3 style="margin:0">¿C&oacute;mo se calcula el Riesgo Acad&eacute;mico?</h3>
            <button class="modal-close" id="risk-breakdown-close">&times;</button>
          </div>
          <div class="modal-body" id="risk-breakdown-body"></div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="risk-breakdown-cancel">Cerrar</button>
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

  // #341: risk help renders the real backend scoring formula with the
  // active subject's configured thresholds — no hardcoded 60%/4.
  function renderRiskBreakdown() {
    const body = document.getElementById('risk-breakdown-body');
    if (!body) return;
    const values = thresholds?.thresholds || {};
    const label = thresholds?.subjectId || activeSubjectId;
    const scopeLabel = thresholds?.source === 'default' && label ? `${label} (valores por defecto)` : label;
    body.innerHTML = renderRiskBreakdownHTML(values, scopeLabel);
  }

  document.getElementById('btn-risk-breakdown').onclick = () => {
    renderRiskBreakdown();
    const modal = document.getElementById('risk-breakdown-modal');
    modal.style.display = 'flex';
  };
  document.getElementById('risk-breakdown-close').onclick = () => {
    document.getElementById('risk-breakdown-modal').style.display = 'none';
  };
  document.getElementById('risk-breakdown-cancel').onclick = () => {
    document.getElementById('risk-breakdown-modal').style.display = 'none';
  };
  document.getElementById('risk-breakdown-modal').onclick = (e) => {
    if (e.target === document.getElementById('risk-breakdown-modal')) {
      document.getElementById('risk-breakdown-modal').style.display = 'none';
    }
  };

  function renderThresholdsModal(data) {
    const modal = document.getElementById('thresholds-modal');
    const body = document.getElementById('thresholds-body');
    const config = data?.thresholds || {};

    const fields = [
      { key: 'noLoginDaysLow', label: 'D&iacute;as de inactividad para riesgo bajo', defaultValue: 7, min: 1, max: 60, step: 1 },
      { key: 'noLoginDaysMedium', label: 'D&iacute;as de inactividad para riesgo medio', defaultValue: 14, min: 1, max: 90, step: 1 },
      { key: 'noLoginDaysHigh', label: 'D&iacute;as de inactividad para riesgo alto', defaultValue: 21, min: 1, max: 120, step: 1 },
      { key: 'minQueriesMedium', label: 'M&iacute;nimo de consultas semanales', defaultValue: 2, min: 1, max: 20, step: 1 },
      { key: 'attendanceWarning', label: '% asistencia m&iacute;nima', defaultValue: 60, min: 0, max: 100, step: 1 },
    ];

    const valueOf = (key, defaultValue) => {
      const raw = String(config[key] ?? '');
      if (raw.trim() === '') return defaultValue;
      const value = Number(raw);
      return Number.isFinite(value) ? value : defaultValue;
    };

    body.innerHTML = `
      <p style="color:var(--color-text-secondary);margin-bottom:var(--space-2);font-size:0.875rem">
        Configurar los umbrales que determinan los niveles de riesgo para la materia
        <strong>${escapeHtml(thresholds?.subjectId || activeSubjectId)}</strong>.
        Los cambios se aplican al pr&oacute;ximo c&aacute;lculo de esta materia.
      </p>
      ${data?.source === 'override'
        ? '<p style="color:var(--color-warning);font-size:0.8rem;margin-bottom:var(--space-3)">Esta materia tiene configuraci&oacute;n personalizada.</p>'
        : '<p style="color:var(--color-text-muted);font-size:0.8rem;margin-bottom:var(--space-3)">Esta materia usa los valores por defecto. Guardar crea una configuraci&oacute;n propia para la materia.</p>'}
      <div id="thresholds-errors" role="alert" style="display:none;color:var(--color-error);font-size:0.85rem;margin-bottom:var(--space-3)"></div>
      <div style="display:grid;gap:var(--space-3)">
        ${fields.map(f => `
          <label style="font-size:0.875rem;color:var(--color-text-secondary)">${f.label} <span style="color:var(--color-text-muted)">(vac&iacute;o = ${f.defaultValue})</span>
            <input id="th-${f.key}" class="input" type="number" value="${valueOf(f.key, f.defaultValue)}" min="${f.min}" max="${f.max}" step="${f.step}" style="width:100%;margin-top:var(--space-1);padding:var(--space-2);border-radius:var(--radius-md);background:var(--color-surface-1);color:var(--color-text-primary);border:1px solid var(--color-border)"></label>
        `).join('')}
      </div>
    `;

    modal.style.display = 'flex';
    document.getElementById('thresholds-modal-close').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('thresholds-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

    document.getElementById('thresholds-save').onclick = async () => {
      // #341: validate inline — never clamp silently. Out-of-range or
      // non-numeric values block the save with an explicit message.
      const errors = [];
      const newConfig = {};
      for (const f of fields) {
        const raw = String(document.getElementById(`th-${f.key}`).value ?? '').trim();
        if (raw === '') {
          newConfig[f.key] = f.defaultValue;
          continue;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          errors.push(`"${f.label}" debe ser un n&uacute;mero (recibido: ${escapeHtml(raw)}).`);
          continue;
        }
        if (value < f.min || value > f.max) {
          errors.push(`"${f.label}" debe estar entre ${f.min} y ${f.max} (recibido: ${value}).`);
          continue;
        }
        newConfig[f.key] = value;
      }
      if (newConfig.noLoginDaysLow > newConfig.noLoginDaysMedium
        || newConfig.noLoginDaysMedium > newConfig.noLoginDaysHigh) {
        errors.push('Los d&iacute;as de inactividad deben cumplir: bajo &le; medio &le; alto.');
      }
      const errorsEl = document.getElementById('thresholds-errors');
      if (errors.length > 0) {
        if (errorsEl) {
          errorsEl.innerHTML = `<strong>Revis&aacute; los valores:</strong><ul style="margin:var(--space-1) 0 0;padding-left:20px;">${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
          errorsEl.style.display = 'block';
        }
        toast('warning', 'Valores inv&aacute;lidos', 'Correg&iacute; los campos marcados antes de guardar.');
        return;
      }
      if (errorsEl) { errorsEl.style.display = 'none'; errorsEl.innerHTML = ''; }
      try {
        const result = await api.updateRiskThresholds(activeSubjectId, newConfig);
        if (result?.success) {
          modal.style.display = 'none';
          if (thresholds) {
            thresholds.thresholds = { ...thresholds.thresholds, ...(result.data?.thresholds || newConfig) };
            thresholds.subjectId = result.data?.subjectId || activeSubjectId;
            thresholds.source = 'override';
          }
          renderRiskBreakdown();
          toast('success', 'Umbrales guardados', `Nuevos umbrales para ${activeSubjectId}; se aplicar&aacute;n al pr&oacute;ximo c&aacute;lculo de riesgo.`);
        } else {
          toast('error', 'Error al guardar', result?.error || 'No se pudieron guardar los umbrales.');
        }
      } catch (err) {
        toast('error', 'Error al guardar', err.message || 'No se pudieron guardar los umbrales.');
      }
    };
  }
}
