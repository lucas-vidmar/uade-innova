import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

export async function renderAdminSettings(container) {
  let config = {
    retentionDays: 90,
    containerName: 'class-materials',
    maxFileSizeMb: 50,
    autoCleanup: true,
    optimizeImages: true,
  };

  async function loadConfig() {
    try {
      const result = await api.getAdminConfig('technical');
      if (result?.data) config = { ...config, ...result.data };
    } catch (err) {
      console.warn('[Settings] No se pudo cargar la configuración técnica:', err);
    }
  }

  await loadConfig();

  const apiBaseUrl = api.BASE_URL || '/api';

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
          <input type="number" class="form-input" id="setting-retention-days" value="${config.retentionDays}" min="1" max="365" style="max-width:200px">
          <p class="text-xs text-text-muted" style="margin-top:4px">Los archivos eliminados se pueden recuperar hasta 30 días después.</p>
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Contenedor de materiales</label>
          <input type="text" class="form-input" id="setting-container-name" value="${config.containerName}" disabled style="max-width:300px;opacity:0.7">
          <p class="text-xs text-text-muted" style="margin-top:4px">Fijo (prototipo). El contenedor se define en <code>infra/modules/storage.bicep</code> y no se puede cambiar desde esta interfaz.</p>
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Límite de tamaño por archivo (MB)</label>
          <input type="number" class="form-input" id="setting-max-file-size" value="${config.maxFileSizeMb}" min="1" max="500" style="max-width:200px">
        </div>
      </div>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Endpoint de API</h3>
      <div style="display:grid;gap:var(--space-4)">
        <div>
          <label class="form-label" style="font-weight:600">URL Base de la API</label>
          <input type="text" class="form-input" id="setting-api-url" value="${apiBaseUrl}" disabled style="max-width:400px;opacity:0.7;font-family:monospace;font-size:0.85rem">
          <p class="text-xs text-text-muted" style="margin-top:4px">Valor efectivo de <code>BASE_URL</code> resuelto por el cliente (proxy <code>/api</code> en producción). Solo lectura.</p>
        </div>
      </div>
    </div>

    <div class="card animate-in">
      <h3 style="margin-bottom:var(--space-4)">Preferencias de Sistema</h3>
      <div style="display:grid;gap:var(--space-4)">
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="setting-auto-cleanup" ${config.autoCleanup ? 'checked' : ''}>
          <span>Limpiar archivos temporales automáticamente</span>
        </label>
        <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
          <input type="checkbox" id="setting-optimize-images" ${config.optimizeImages ? 'checked' : ''}>
          <span>Optimizar imágenes en materiales subidos</span>
        </label>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-6)">
      <button class="btn btn-secondary" id="btn-settings-reset">Restablecer</button>
      <button class="btn btn-primary" id="btn-settings-save">Guardar Configuración</button>
    </div>
  `;

  function renderValues() {
    document.getElementById('setting-retention-days').value = config.retentionDays;
    document.getElementById('setting-max-file-size').value = config.maxFileSizeMb;
    document.getElementById('setting-auto-cleanup').checked = config.autoCleanup;
    document.getElementById('setting-optimize-images').checked = config.optimizeImages;
  }

  function readValues() {
    return {
      retentionDays: Number(document.getElementById('setting-retention-days').value),
      maxFileSizeMb: Number(document.getElementById('setting-max-file-size').value),
      autoCleanup: document.getElementById('setting-auto-cleanup').checked,
      optimizeImages: document.getElementById('setting-optimize-images').checked,
    };
  }

  document.getElementById('btn-settings-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-settings-save');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      const result = await api.saveAdminConfig('technical', readValues());
      if (result?.data) {
        config = { ...config, ...result.data };
        renderValues();
      }
      toast('success', 'Configuración guardada', 'Los cambios se aplicarán en la próxima actualización.');
    } catch (err) {
      toast('error', 'Error al guardar la configuración', err.message || 'No se pudo persistir la configuración.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Configuración';
    }
  });

  document.getElementById('btn-settings-reset')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-settings-reset');
    btn.disabled = true;
    try {
      const result = await api.resetAdminConfig('technical');
      if (result?.data) {
        config = { ...config, ...result.data };
        renderValues();
      }
      toast('success', 'Valores restablecidos', 'Se restauraron los valores por defecto.');
    } catch (err) {
      toast('error', 'Error al restablecer', err.message || 'No se pudieron restablecer los valores.');
    } finally {
      btn.disabled = false;
    }
  });
}
