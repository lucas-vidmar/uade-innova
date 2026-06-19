import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

export async function renderStudentSettings(container) {
  renderHeader('Configuración');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando configuración...</div>`;

  const prefs = await api.getReminderPreferences();
  const state = {
    enabled: prefs?.enabled !== false,
    cadence: prefs?.cadence || 'both',
    saving: false,
  };

  function render() {
    container.innerHTML = `
      <div class="settings-page" style="max-width:600px;margin:0 auto;padding:var(--space-6)">
        <h2 class="h3" style="margin-bottom:var(--space-2)">Preferencias de Recordatorios</h2>
        <p style="color:var(--color-text-secondary);margin-bottom:var(--space-8)">
          Configurá cómo y cuándo recibís recordatorios de vencimientos de entregas.
        </p>

        <div class="card" style="padding:var(--space-6)">
          <div class="setting-row" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-6)">
            <div>
              <div class="setting-label" style="font-weight:600;margin-bottom:var(--space-1)">Recordatorios de vencimientos</div>
              <div class="setting-desc" style="font-size:var(--fs-sm);color:var(--color-text-secondary)">
                Recibí notificaciones cuando se acerque la fecha de entrega de trabajos prácticos y parciales.
              </div>
            </div>
            <label class="toggle-switch" aria-label="Activar recordatorios de vencimientos">
              <input type="checkbox" id="reminder-toggle" ${state.enabled ? 'checked' : ''} ${state.saving ? 'disabled' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div id="cadence-section" style="${state.enabled ? '' : 'opacity:0.5;pointer-events:none'}">
            <div style="font-weight:600;margin-bottom:var(--space-3)">Frecuencia de recordatorios</div>
            <div class="cadence-options" style="display:flex;flex-direction:column;gap:var(--space-3)">
              <label class="radio-row" style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer;padding:var(--space-3);border-radius:var(--radius);border:1px solid var(--color-border);transition:border-color 0.2s" data-selected="${state.cadence === 'both'}">
                <input type="radio" name="cadence" value="both" ${state.cadence === 'both' ? 'checked' : ''} ${state.saving ? 'disabled' : ''}>
                <div>
                  <div style="font-weight:500">48 horas y 24 horas</div>
                  <div style="font-size:var(--fs-sm);color:var(--color-text-secondary)">Recibí ambos recordatorios: a 2 días y a 1 día del vencimiento.</div>
                </div>
              </label>
              <label class="radio-row" style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer;padding:var(--space-3);border-radius:var(--radius);border:1px solid var(--color-border);transition:border-color 0.2s" data-selected="${state.cadence === '48h'}">
                <input type="radio" name="cadence" value="48h" ${state.cadence === '48h' ? 'checked' : ''} ${state.saving ? 'disabled' : ''}>
                <div>
                  <div style="font-weight:500">Solo 48 horas</div>
                  <div style="font-size:var(--fs-sm);color:var(--color-text-secondary)">Recibí un único recordatorio 2 días antes del vencimiento.</div>
                </div>
              </label>
              <label class="radio-row" style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer;padding:var(--space-3);border-radius:var(--radius);border:1px solid var(--color-border);transition:border-color 0.2s" data-selected="${state.cadence === '24h'}">
                <input type="radio" name="cadence" value="24h" ${state.cadence === '24h' ? 'checked' : ''} ${state.saving ? 'disabled' : ''}>
                <div>
                  <div style="font-weight:500">Solo 24 horas</div>
                  <div style="font-size:var(--fs-sm);color:var(--color-text-secondary)">Recibí un único recordatorio 1 día antes del vencimiento.</div>
                </div>
              </label>
            </div>
          </div>

          <button class="btn btn-primary" id="save-settings-btn" style="margin-top:var(--space-6);width:100%" ${state.saving ? 'disabled' : ''}>
            ${state.saving ? 'Guardando...' : 'Guardar preferencias'}
          </button>
        </div>
      </div>
    `;

    container.querySelector('#reminder-toggle')?.addEventListener('change', (e) => {
      state.enabled = e.target.checked;
      render();
    });

    container.querySelectorAll('input[name="cadence"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          state.cadence = e.target.value;
          render();
        }
      });
    });

    container.querySelector('#save-settings-btn')?.addEventListener('click', async () => {
      state.saving = true;
      render();
      try {
        await api.saveReminderPreferences({ enabled: state.enabled, cadence: state.cadence });
        auth.setReminderPreferences({ enabled: state.enabled, cadence: state.cadence });
        toast.success('Preferencias guardadas correctamente.');
      } catch (err) {
        toast.error('Error al guardar preferencias.');
        console.error('[Settings] Error saving reminder preferences:', err);
      }
      state.saving = false;
      render();
    });
  }

  render();
}
