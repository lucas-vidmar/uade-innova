import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

export async function renderAdminRetention(container) {
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
        <div>
          <label class="form-label" style="font-weight:600">Días para archivo en frío</label>
          <input type="number" class="form-input" id="retention-cold-days" value="730" min="30" max="3650" style="max-width:200px">
          <p class="text-xs text-text-muted" style="margin-top:4px">Archivos no accedidos después de este período se mueven a Cold Storage.</p>
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Días para eliminación permanente</label>
          <input type="number" class="form-input" id="retention-delete-days" value="365" min="30" max="3650" style="max-width:200px">
          <p class="text-xs text-text-muted" style="margin-top:4px">Datos no accedidos después de este período se eliminan permanentemente.</p>
        </div>
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="retention-notify-teachers" checked>
          <span>Notificar a docentes antes de archivar materiales</span>
        </label>
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="retention-auto-delete" checked>
          <span>Eliminación automática al vencer retención</span>
        </label>
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

  document.getElementById('btn-retention-save')?.addEventListener('click', () => {
    toast('success', 'Políticas actualizadas', 'Los cambios en retención se aplicarán en las próximas horas.');
  });

  document.getElementById('btn-retention-export')?.addEventListener('click', () => {
    const policies = [
      { type: 'Transcripciones', retention: '2 años', action: 'Archivo en frío' },
      { type: 'Presentaciones', retention: '2 años', action: 'Archivo en frío' },
      { type: 'Apuntes y bibliografía', retention: '2 años', action: 'Archivo en frío' },
      { type: 'Historial de chat', retention: '1 año', action: 'Eliminación permanente' },
      { type: 'Logs de interacción', retention: '90 días', action: 'Eliminación permanente' },
      { type: 'Notificaciones', retention: '6 meses', action: 'Eliminación permanente' },
    ];
    const csv = 'Tipo,Retención,Acción al vencer\n' + policies.map(p => `${p.type},${p.retention},${p.action}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'retention-policies.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('success', 'Políticas exportadas', 'Archivo CSV descargado.');
  });
}
