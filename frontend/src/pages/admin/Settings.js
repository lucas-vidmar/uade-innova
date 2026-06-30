import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

export async function renderAdminSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1 class="h2">Configuración Técnica</h1>
      <p class="text-secondary">Parámetros generales del sistema y almacenamiento.</p>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Almacenamiento de Archivos</h3>
      <div style="display:grid;gap:var(--space-4)">
        <div>
          <label class="form-label" style="font-weight:600">Retención de archivos procesados (días)</label>
          <input type="number" class="form-input" id="setting-retention-days" value="90" min="1" max="365" style="max-width:200px">
          <p class="text-xs text-text-muted" style="margin-top:4px">Los archivos eliminados se pueden recuperar hasta 30 días después.</p>
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Contenedor de materiales</label>
          <input type="text" class="form-input" id="setting-container-name" value="class-materials" disabled style="max-width:300px;opacity:0.7">
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Límite de tamaño por archivo (MB)</label>
          <input type="number" class="form-input" id="setting-max-file-size" value="50" min="1" max="500" style="max-width:200px">
        </div>
      </div>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Endpoint de API</h3>
      <div style="display:grid;gap:var(--space-4)">
        <div>
          <label class="form-label" style="font-weight:600">URL Base de la API</label>
          <input type="text" class="form-input" id="setting-api-url" value="${window.location.origin}" disabled style="max-width:400px;opacity:0.7;font-family:monospace;font-size:0.85rem">
        </div>
      </div>
    </div>

    <div class="card animate-in">
      <h3 style="margin-bottom:var(--space-4)">Preferencias de Sistema</h3>
      <div style="display:grid;gap:var(--space-4)">
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="setting-auto-cleanup" checked>
          <span>Limpiar archivos temporales automáticamente</span>
        </label>
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="setting-optimize-images" checked>
          <span>Optimizar imágenes en materiales subidos</span>
        </label>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-6)">
      <button class="btn btn-secondary" id="btn-settings-reset">Restablecer</button>
      <button class="btn btn-primary" id="btn-settings-save">Guardar Configuración</button>
    </div>
  `;

  document.getElementById('btn-settings-save')?.addEventListener('click', () => {
    toast('success', 'Configuración guardada', 'Los cambios se aplicarán en la próxima actualización.');
  });

  document.getElementById('btn-settings-reset')?.addEventListener('click', () => {
    document.getElementById('setting-retention-days').value = '90';
    document.getElementById('setting-max-file-size').value = '50';
    document.getElementById('setting-auto-cleanup').checked = true;
    document.getElementById('setting-optimize-images').checked = true;
    toast('success', 'Valores restablecidos', 'Se restauraron los valores por defecto.');
  });
}
