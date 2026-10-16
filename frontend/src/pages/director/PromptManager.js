import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';
import { showConfirmDialog, showPromptDialog } from '../../components/Dialog.js';
import { apiErrorFeedback } from '../../services/error-feedback.js';

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let state = {
  types: [],
  selectedType: null,
  versions: [],
  editingVersion: null,
  editingField: null,
};

export async function renderDirectorPromptManager(container) {
  renderHeader('Gestión de Prompts');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando prompts...</div>`;

  const activeSubjectId = auth.getActiveSubjectId();
  if (!activeSubjectId) {
    container.innerHTML = `<div class="empty-state">No hay materias vinculadas a tu cuenta.</div>`;
    return;
  }

  try {
    state.types = await api.getPromptTypes();
    renderList(container);
  } catch (err) {
    console.error('[PromptManager] Error loading:', err);
    const feedback = apiErrorFeedback(err, {
      FORBIDDEN: 'Se requiere rol Director o Admin para gestionar prompts.',
      ACCESS_DENIED: 'Tu cuenta no está habilitada en la plataforma. Contactá a administración.',
      auth: 'Tu rol no permite gestionar prompts.',
    });
    container.innerHTML = `
      <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
        <div class="empty-state-icon" aria-hidden="true">⚙️</div>
        <h2 class="h3">${esc(feedback.title)}</h2>
        <p style="color:var(--color-text-secondary)">${esc(feedback.message || 'No se pudieron cargar los tipos de prompt.')}</p>
        ${feedback.hint ? `<p style="color:var(--color-warning);font-weight:600;margin-top:var(--space-2)">${esc(feedback.hint)}</p>` : ''}
        <button class="btn btn-secondary" onclick="window.location.reload()" aria-label="Reintentar">Reintentar</button>
      </div>
    `;
  }
}

function renderList(container) {
  container.innerHTML = `
    <div style="margin-bottom:var(--space-6)">
      <p style="color:var(--color-text-secondary);margin-bottom:var(--space-4)">
        Gestioná todas las versiones de prompts del sistema. Cada tipo de prompt tiene su propia lista de versiones.
        Las versiones activas son las que usa el sistema en tiempo real.
      </p>
    </div>

    <div class="card" style="margin-bottom:var(--space-6)">
      <div class="card-header">
        <span class="card-title">Tipos de Prompt</span>
        <span class="badge badge-info">${state.types.length} tipos</span>
      </div>

      ${state.types.length === 0 ? `
        <div class="empty-state" style="padding:20px">No hay tipos de prompt registrados.</div>
      ` : `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Descripción</th>
              <th>Versión Activa</th>
              <th>Modelo Activo</th>
              <th>Versiones</th>
              <th>Estructura</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${state.types.map(t => `
              <tr>
                <td><code style="font-weight:600">${esc(t.id)}</code></td>
                <td style="max-width:250px;white-space:normal">${esc(t.description)}</td>
                <td>
                  ${t.activeVersion
                    ? `<span class="badge badge-success">${esc(t.activeVersion)}</span>`
                    : `<span class="badge badge-secondary">Sin activa</span>`
                  }
                </td>
                <td><span class="badge" style="background:var(--color-surface-3)">${esc(t.activeModel || 'default')}</span></td>
                <td><span class="badge badge-info">${t.versionCount}</span></td>
                <td style="font-size:0.8rem">
                  ${t.hasSystemPrompt ? '<span class="badge badge-primary">system</span> ' : ''}
                  ${t.hasUserPrompt ? '<span class="badge badge-secondary">user</span>' : ''}
                  ${t.variables.length > 0 ? esc(' {' + t.variables.join(', ') + '}') : ''}
                </td>
                <td>
                  <button class="btn btn-secondary btn-sm" data-action="manage" data-type="${esc(t.id)}" style="white-space:nowrap">
                    Gestionar
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      `}
    </div>
  `;

  container.querySelectorAll('[data-action="manage"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      state.selectedType = type;
      showTypeDetail(container, type);
    });
  });
}

async function showTypeDetail(container, type) {
  const typeMeta = state.types.find(t => t.id === type);
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando versiones de ${type}...</div>`;

  try {
    state.versions = await api.getPromptVersions(type);
    state.selectedType = type;
    renderTypeDetail(container);
  } catch (err) {
    container.innerHTML = `
      <div class="card" style="max-width:480px;margin:var(--space-10) auto;text-align:center">
        <div class="empty-state-icon" aria-hidden="true">⚙️</div>
        <h2 class="h3">Error al cargar versiones</h2>
        <p style="color:var(--color-text-secondary)">${esc(err.message)}</p>
        <button class="btn btn-secondary" onclick="renderDirectorPromptManager(container)">Volver</button>
      </div>
    `;
  }
}

function renderTypeDetail(container) {
  const typeMeta = state.types.find(t => t.id === state.selectedType);

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)">
      <button class="btn btn-ghost" id="back-to-list" style="margin-bottom:var(--space-2)">
        ← Volver a tipos
      </button>
      <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
        <h2 style="margin:0">${esc(typeMeta?.label || state.selectedType)}</h2>
        <code style="font-size:0.85rem;color:var(--color-text-muted)">${esc(state.selectedType)}</code>
        <span class="badge badge-info">${state.versions.length} versiones</span>
      </div>
      <p style="color:var(--color-text-secondary);margin-top:var(--space-2)">${esc(typeMeta?.description || '')}</p>
    </div>

    <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-4);flex-wrap:wrap">
      <button class="btn btn-primary" id="create-new-version">
        + Nueva versión
      </button>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Versiones</span>
      </div>
      ${state.versions.length === 0 ? `
        <div class="empty-state" style="padding:20px">No hay versiones para este tipo de prompt. Creá una nueva.</div>
      ` : `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Versión</th>
              <th>Descripción</th>
              <th>Estado</th>
              <th>Modelo</th>
              <th>Creado</th>
              <th>Actualizado</th>
              <th>Activada / por</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${state.versions.map(v => `
              <tr>
                <td><code style="font-weight:600">${esc(v.versionId)}</code></td>
                <td style="max-width:200px;white-space:normal">
                  ${esc(v.description || '-')}
                  ${v.activationReason ? `<div class="text-xs text-text-muted" style="margin-top:4px">Motivo: ${esc(v.activationReason)}</div>` : ''}
                </td>
                <td>
                  ${v.isActive
                    ? '<span class="badge badge-success">Activa</span>'
                    : '<span class="badge badge-secondary">Inactiva</span>'
                  }
                </td>
                <td><span class="badge" style="background:var(--color-surface-3)">${esc(v.model || 'default')}</span></td>
                <td style="font-size:0.85rem">${formatDate(v.createdAt)}</td>
                <td style="font-size:0.85rem">${formatDate(v.updatedAt)}${v.updatedBy ? `<div class="text-xs text-text-muted">por ${esc(v.updatedBy)}</div>` : ''}</td>
                <td style="font-size:0.85rem">
                  ${v.activatedAt ? `${formatDate(v.activatedAt)}<div class="text-xs text-text-muted">por ${esc(v.activatedBy || '-')}</div>` : '-'}
                </td>
                <td>
                  <div style="display:flex;gap:var(--space-2)">
                    <button class="btn btn-secondary btn-sm" data-action="edit" data-type="${esc(state.selectedType)}" data-version-id="${esc(v.versionId)}">Editar</button>
                    ${!v.isActive ? `
                      <button class="btn btn-primary btn-sm" data-action="activate" data-type="${esc(state.selectedType)}" data-version-id="${esc(v.versionId)}">Activar</button>
                      <button class="btn btn-danger btn-sm" data-action="delete" data-type="${esc(state.selectedType)}" data-version-id="${esc(v.versionId)}">Eliminar</button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      `}
    </div>

    ${renderGovernanceLog()}
  `;

  document.getElementById('back-to-list').addEventListener('click', () => renderList(container));
  document.getElementById('create-new-version').addEventListener('click', () => showEditor(container, null));

  container.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const version = state.versions.find(v => v.versionId === btn.dataset.versionId);
      showEditor(container, version);
    });
  });

  container.querySelectorAll('[data-action="activate"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      const versionId = btn.dataset.versionId;
      // El paso de una versión a otra se asienta con su motivo: sin motivo no se
      // activa, y queda dicho quién y cuándo (UJ-48 pasos 5 y 9).
      const reason = await showPromptDialog({
        title: `Activar ${versionId}`,
        label: 'Motivo de la activación (queda registrado)',
        placeholder: 'Por qué esta versión pasa a regir',
        confirmText: 'Activar',
      });
      if (!reason) return;
      const reemplazada = (state.versions.find(v => v.isActive) || {}).versionId || 'ninguna';
      try {
        btn.disabled = true; // un doble clic no puede disparar dos activaciones
        const record = await api.activatePromptVersion(type, versionId, { reason });
        toast('success', 'Versión activada', `${versionId} rige desde ${formatDate(record?.activatedAt)} (antes regía: ${reemplazada}).`);
        await showTypeDetail(container, type);
      } catch (err) {
        toast('error', 'Error al activar', err.message);
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      const versionId = btn.dataset.versionId;
      const confirmed = await showConfirmDialog({
        title: 'Eliminar versión',
        message: `¿Eliminar la versión "${versionId}" de "${type}"? No se puede deshacer.`,
        confirmText: 'Eliminar',
        danger: true,
      });
      if (!confirmed) return;

      try {
        await api.deletePromptVersion(type, versionId);
        toast('success', 'Versión eliminada', `La versión ${versionId} fue eliminada.`);
        await showTypeDetail(container, type);
      } catch (err) {
        toast('error', 'Error al eliminar', err.message);
      }
    });
  });
}

function showEditor(container, version) {
  const typeMeta = state.types.find(t => t.id === state.selectedType);
  const isNew = !version;
  const v = version || { versionId: '', content: '', systemPrompt: '', userPromptTemplate: '', variables: [], description: '', model: '' };
  const ALLOWED_MODELS = ['deepseek-v4-flash', 'gpt-4o-mini'];

  const hasTwoParts = typeMeta?.hasSystemPrompt && typeMeta?.hasUserPrompt;

  container.innerHTML = `
    <div style="margin-bottom:var(--space-4)">
      <button class="btn btn-ghost" id="back-to-versions" style="margin-bottom:var(--space-2)">
        ← Volver a versiones
      </button>
      <h2 style="margin:0">${isNew ? 'Nueva versión' : `Editar: ${esc(v.versionId)}`}</h2>
      <p style="color:var(--color-text-secondary)">${esc(typeMeta?.label || state.selectedType)}</p>
    </div>

    <div class="card" style="max-width:900px">
      <form id="prompt-editor-form" style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div>
          <label class="form-label" for="pe-description">Descripción</label>
          <input type="text" id="pe-description" class="form-input" value="${esc(v.description)}" placeholder="Ej: Prompt mejorado con tono más empático" style="width:100%">
        </div>
        <div>
          <label class="form-label" for="pe-model">Modelo IA</label>
          <select id="pe-model" class="form-input" style="max-width:300px">
            <option value="" ${!v.model ? 'selected' : ''}>Default (usa modelo global)</option>
            ${ALLOWED_MODELS.map(m => `<option value="${m}" ${v.model===m?'selected':''}>${m}</option>`).join('')}
          </select>
          <p class="text-xs text-text-muted" style="margin-top:4px">Seleccioná el modelo para esta versión. Vacío = fallback a <code>deepseek-v4-flash</code> global.</p>
        </div>

        ${hasTwoParts ? `
          <div>
            <label class="form-label" for="pe-system-prompt">System Prompt</label>
            <textarea id="pe-system-prompt" class="form-input" rows="6" style="width:100%;font-family:monospace;font-size:0.85rem;resize:vertical;white-space:pre-wrap">${esc(v.systemPrompt)}</textarea>
          </div>
          <div>
            <label class="form-label" for="pe-user-template">User Prompt Template</label>
            <div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:var(--space-1)">
              Variables disponibles: ${typeMeta?.variables?.map(vr => `<code>$\{${vr}}</code>`).join(', ') || 'ninguna'}
            </div>
            <textarea id="pe-user-template" class="form-input" rows="10" style="width:100%;font-family:monospace;font-size:0.85rem;resize:vertical;white-space:pre-wrap">${esc(v.userPromptTemplate)}</textarea>
          </div>
        ` : `
          <div>
            <label class="form-label" for="pe-content">Contenido del Prompt</label>
            <textarea id="pe-content" class="form-input" rows="12" style="width:100%;font-family:monospace;font-size:0.85rem;resize:vertical;white-space:pre-wrap">${esc(v.content)}</textarea>
          </div>
        `}

        <div style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap">
          ${isNew ? `
            <button type="submit" class="btn btn-primary">Crear nueva versión</button>
          ` : `
            <button type="submit" class="btn btn-primary">Guardar cambios</button>
            ${!v.isActive ? `
              <button type="button" class="btn btn-primary-outline" id="save-and-activate">Guardar y activar</button>
            ` : ''}
          `}
          <button type="button" class="btn btn-ghost" id="cancel-edit">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  const form = document.getElementById('prompt-editor-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = document.getElementById('pe-description').value.trim();
    const content = document.getElementById('pe-content')?.value || '';
    const systemPrompt = document.getElementById('pe-system-prompt')?.value || '';
    const userPromptTemplate = document.getElementById('pe-user-template')?.value || '';
    const model = document.getElementById('pe-model')?.value || null;

    try {
      if (isNew) {
        await api.createPromptVersion({
          type: state.selectedType,
          content,
          systemPrompt,
          userPromptTemplate,
          variables: typeMeta?.variables || [],
          description: description || 'Nueva versión',
          model: model || null,
        });
        toast('success', 'Versión creada', 'La nueva versión se creó correctamente.');
      } else {
        await api.updatePromptVersion(state.selectedType, v.versionId, {
          content,
          systemPrompt,
          userPromptTemplate,
          variables: typeMeta?.variables || [],
          description: description || v.description,
          model: model || null,
        });
        toast('success', 'Versión actualizada', 'Los cambios se guardaron correctamente.');
      }
      await showTypeDetail(container, state.selectedType);
    } catch (err) {
      toast('error', 'Error', err.message);
    }
  });

  document.getElementById('cancel-edit').addEventListener('click', () => {
    showTypeDetail(container, state.selectedType);
  });

  const saveActivateBtn = document.getElementById('save-and-activate');
  if (saveActivateBtn) {
    saveActivateBtn.addEventListener('click', async () => {
      const description = document.getElementById('pe-description').value.trim();
      const content = document.getElementById('pe-content')?.value || '';
      const systemPrompt = document.getElementById('pe-system-prompt')?.value || '';
      const userPromptTemplate = document.getElementById('pe-user-template')?.value || '';
      const model = document.getElementById('pe-model')?.value || null;

      try {
        await api.updatePromptVersion(state.selectedType, v.versionId, {
          content,
          systemPrompt,
          userPromptTemplate,
          variables: typeMeta?.variables || [],
          description: description || v.description,
          model: model || null,
        });
        await api.activatePromptVersion(state.selectedType, v.versionId);
        toast('success', 'Guardado y activado', `La versión ${v.versionId} se actualizó y activó.`);
        await showTypeDetail(container, state.selectedType);
      } catch (err) {
        toast('error', 'Error', err.message);
      }
    });
  }
}

const GOVERNANCE_LABELS = {
  activate: 'Activada',
  deactivate: 'Dejó de regir',
  edit: 'Contenido editado',
};

/**
 * Historial de la gobernanza del comportamiento: con esto cualquiera puede
 * reconstruir qué versión regía en cada tramo, quién la activó y con qué motivo
 * (UJ-48 pasos 5, 7, 9 y 10).
 */
function renderGovernanceLog() {
  const entries = [];
  for (const version of state.versions) {
    for (const entry of (version.activationHistory || [])) {
      entries.push({ versionId: version.versionId, ...entry });
    }
  }
  entries.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  return `
    <div class="card" style="margin-top:var(--space-6)">
      <div class="card-header">
        <span class="card-title">Historial de activaciones</span>
        <span class="badge badge-info">${entries.length} movimientos</span>
      </div>
      ${entries.length === 0 ? `
        <div class="empty-state" style="padding:20px">Todavía no hay movimientos registrados para este tipo de prompt.</div>
      ` : `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Qué</th>
              <th>Versión</th>
              <th>Quién</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map(entry => `
              <tr>
                <td style="font-size:0.85rem">${formatDate(entry.at)}</td>
                <td style="font-size:0.85rem">${esc(GOVERNANCE_LABELS[entry.action] || entry.action)}</td>
                <td><code>${esc(entry.versionId)}</code></td>
                <td style="font-size:0.85rem">${esc(entry.by || '-')}</td>
                <td style="font-size:0.85rem">${esc(entry.reason || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      `}
    </div>
  `;
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
