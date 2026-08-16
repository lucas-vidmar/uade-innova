import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

export async function renderAdminRetention(container) {
  // QA-006: defaults must be consistent — permanent deletion (deleteDays)
  // occurs AFTER cold archiving (archiveDays), so deleteDays > archiveDays.
  let config = {
    archiveEnabled: true,
    archiveDays: 730,
    deleteEnabled: true,
    deleteDays: 1095,
    notifyTeachers: true,
    autoDelete: true,
  };

  async function loadPolicy() {
    try {
      const policy = await api.getRetentionPolicy();
      if (policy) {
        config = {
          ...config,
          archiveEnabled: policy.archiveEnabled ?? config.archiveEnabled,
          archiveDays: policy.archiveDays ?? config.archiveDays,
          deleteEnabled: policy.deleteEnabled ?? config.deleteEnabled,
          deleteDays: policy.deleteDays ?? config.deleteDays,
          notifyTeachers: policy.notifyTeachers ?? config.notifyTeachers,
          autoDelete: policy.autoDelete ?? config.autoDelete,
        };
      }
    } catch (err) {
      console.warn('[Retention] No se pudo cargar la política de retención:', err);
    }
  }

  await loadPolicy();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="h2">Políticas de Retención</h1>
      <p class="text-secondary">Configuración de retención de datos y cumplimiento normativo.</p>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Políticas Activas</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tipo de dato</th>
              <th>Período de retención</th>
              <th>Acción al vencer</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Transcripciones de clase</strong></td>
              <td>2 años</td>
              <td>Archivo en frío (Cold Storage)</td>
              <td><span class="badge badge-success">Activo</span></td>
            </tr>
            <tr>
              <td><strong>Presentaciones</strong></td>
              <td>2 años</td>
              <td>Archivo en frío (Cold Storage)</td>
              <td><span class="badge badge-success">Activo</span></td>
            </tr>
            <tr>
              <td><strong>Apuntes y bibliografía</strong></td>
              <td>2 años</td>
              <td>Archivo en frío (Cold Storage)</td>
              <td><span class="badge badge-success">Activo</span></td>
            </tr>
            <tr>
              <td><strong>Historial de chat</strong></td>
              <td>1 año</td>
              <td>Eliminación permanente</td>
              <td><span class="badge badge-warning">Pendiente</span></td>
            </tr>
            <tr>
              <td><strong>Logs de interacción</strong></td>
              <td>90 días</td>
              <td>Eliminación permanente</td>
              <td><span class="badge badge-success">Activo</span></td>
            </tr>
            <tr>
              <td><strong>Notifications</strong></td>
              <td>6 meses</td>
              <td>Eliminación permanente</td>
              <td><span class="badge badge-success">Activo</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Configuración de Archivado</h3>
      <div style="display:grid;gap:var(--space-4)">
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="retention-archive-enabled" ${config.archiveEnabled ? 'checked' : ''}>
          <span>Habilitar archivo en frío (Cold Storage)</span>
        </label>
        <div>
          <label class="form-label" style="font-weight:600">Días para archivo en frío</label>
          <input type="number" class="form-input" id="retention-cold-days" value="${config.archiveDays}" min="1" max="3650" style="max-width:200px">
          <p class="text-xs text-text-muted" style="margin-top:4px">Archivos no accedidos después de este período se mueven a Cold Storage.</p>
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Días para eliminación permanente</label>
          <input type="number" class="form-input" id="retention-delete-days" value="${config.deleteDays}" min="1" max="3650" style="max-width:200px">
          <p class="text-xs text-text-muted" style="margin-top:4px">Datos no accedidos después de este período se eliminan permanentemente. Debe ser mayor que el archivo en frío.</p>
        </div>
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="retention-notify-teachers" ${config.notifyTeachers ? 'checked' : ''}>
          <span>Notificar a docentes antes de archivar materiales</span>
        </label>
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="retention-auto-delete" ${config.autoDelete ? 'checked' : ''}>
          <span>Eliminación automática al vencer retención</span>
        </label>
        <div id="retention-validation-error" style="display:none;padding:var(--space-3);background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.5);border-radius:var(--radius-md);color:var(--color-error, #ef4444);font-size:0.85rem"></div>
      </div>
    </div>

    <div class="card animate-in">
      <h3 style="margin-bottom:var(--space-4)">Cumplimiento Normativo</h3>
      <div style="display:grid;gap:var(--space-4)">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3);background:var(--color-surface-2);border-radius:var(--radius-md)">
          <div>
            <strong>Política de Retención</strong>
            <p class="text-xs text-text-muted" style="margin:2px 0 0">Última revisión: 01/01/2026</p>
          </div>
          <span class="badge badge-success">Vigente</span>
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-6)">
      <button class="btn btn-secondary" id="btn-retention-export">Exportar Políticas</button>
      <button class="btn btn-primary" id="btn-retention-save">Guardar Cambios</button>
    </div>
  `;

  function renderValues() {
    document.getElementById('retention-archive-enabled').checked = config.archiveEnabled;
    document.getElementById('retention-cold-days').value = config.archiveDays;
    document.getElementById('retention-delete-days').value = config.deleteDays;
    document.getElementById('retention-notify-teachers').checked = config.notifyTeachers;
    document.getElementById('retention-auto-delete').checked = config.autoDelete;
  }

  function readValues() {
    return {
      archiveEnabled: document.getElementById('retention-archive-enabled').checked,
      archiveDays: Number(document.getElementById('retention-cold-days').value),
      deleteEnabled: config.deleteEnabled,
      deleteDays: Number(document.getElementById('retention-delete-days').value),
      notifyTeachers: document.getElementById('retention-notify-teachers').checked,
      autoDelete: document.getElementById('retention-auto-delete').checked,
    };
  }

  function showValidationError(message) {
    const el = document.getElementById('retention-validation-error');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }

  function clearValidationError() {
    const el = document.getElementById('retention-validation-error');
    if (el) el.style.display = 'none';
  }

  document.getElementById('btn-retention-save')?.addEventListener('click', async () => {
    clearValidationError();
    const values = readValues();

    // Client-side cross-field validation (AC #2): archive enabled + delete <= archive
    if (values.archiveEnabled && values.deleteDays <= values.archiveDays) {
      const message = `deleteDays (${values.deleteDays}) debe ser mayor que archiveDays (${values.archiveDays}) cuando el archivado está habilitado.`;
      showValidationError(message);
      toast('error', 'Configuración inválida', message);
      return;
    }

    const btn = document.getElementById('btn-retention-save');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      const result = await api.saveRetentionPolicy(values);
      if (result) config = { ...config, ...result };
      renderValues();
      toast('success', 'Políticas actualizadas', 'Los cambios en retención se aplicarán en las próximas horas.');
    } catch (err) {
      const message = err.message || 'No se pudo guardar la política de retención.';
      showValidationError(message);
      toast('error', 'Error al guardar la política', message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Cambios';
    }
  });

  document.getElementById('btn-retention-export')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-retention-export');
    btn.disabled = true;
    try {
      const blob = await api.getRetentionExport('csv');
      if (!blob) {
        toast('error', 'No se pudo exportar', 'El servidor no devolvió el archivo CSV.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `retention-policies-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('success', 'Políticas exportadas', 'Archivo CSV descargado desde la política persistida.');
    } catch (err) {
      console.error('[Retention] Export error:', err);
      toast('error', 'No se pudo exportar', 'Ocurrió un error al exportar las políticas.');
    } finally {
      btn.disabled = false;
    }
  });
}
