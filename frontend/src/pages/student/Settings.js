import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

export async function renderStudentSettings(container) {
  renderHeader('Configuración');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando configuración...</div>`;

  const prefs = await api.getReminderPreferences();
  const [consent] = await Promise.all([
    api.getConsent().catch(() => ({ accepted: false })),
  ]);
  const botPrefs = auth.getBotPreferences();
  const state = {
    enabled: prefs?.enabled !== false,
    cadence: prefs?.cadence || 'both',
    saving: false,
    savingBot: false,
    consentAccepted: auth.getAIConsentAccepted() || consent?.accepted === true,
    savingConsent: false,
    botTone: botPrefs.tone,
    botLength: botPrefs.length,
    botIncludeSources: botPrefs.includeSources,
  };

  function render() {
    container.innerHTML = `
      <div class="settings-page" style="max-width:600px;margin:0 auto;padding:var(--space-6)">
        <h2 class="h3" style="margin-bottom:var(--space-4)">Configuración</h2>

        <!-- AI Consent Section -->
        <div class="card" style="padding:var(--space-6);margin-bottom:var(--space-6)">
          <div style="font-weight:600;margin-bottom:var(--space-2)">Consentimiento de IA</div>
          <p style="font-size:var(--fs-sm);color:var(--color-text-secondary);margin-bottom:var(--space-4)">
            ${state.consentAccepted
              ? 'Aceptaste que tus consultas sean procesadas por IA. Podés revocar este consentimiento en cualquier momento.'
              : 'No aceptaste el consentimiento de IA. El chat estará deshabilitado hasta que aceptes los términos.'}
          </p>
          <div style="display:flex;align-items:center;gap:var(--space-3)">
            <span class="status-badge" style="display:inline-flex;align-items:center;gap:var(--space-1);padding:4px 12px;border-radius:var(--radius-full);font-size:var(--fs-sm);font-weight:500;background:${state.consentAccepted ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${state.consentAccepted ? 'var(--color-success)' : 'var(--color-error)'}">
              <span style="width:8px;height:8px;border-radius:50%;background:${state.consentAccepted ? 'var(--color-success)' : 'var(--color-error)'}"></span>
              ${state.consentAccepted ? 'Aceptado' : 'No aceptado'}
            </span>
            ${state.consentAccepted ? `
              <button class="btn btn-outline btn-sm" id="revoke-consent-btn" style="color:var(--color-error);border-color:rgba(239,68,68,0.3)" ${state.savingConsent ? 'disabled' : ''}>
                ${state.savingConsent ? 'Revocando...' : 'Revocar consentimiento'}
              </button>
            ` : `
              <button class="btn btn-primary btn-sm" id="accept-consent-btn" ${state.savingConsent ? 'disabled' : ''}>
                ${state.savingConsent ? 'Aceptando...' : 'Aceptar consentimiento'}
              </button>
            `}
          </div>
        </div>

        <!-- Bot Preferences -->
        <div class="card" style="padding:var(--space-6);margin-bottom:var(--space-6)">
          <div style="font-weight:600;margin-bottom:var(--space-4)">Preferencias del Asistente IA</div>
          <div style="display:flex;flex-direction:column;gap:var(--space-4)">
            <div class="form-group">
              <label class="form-label" style="font-weight:500">Tono de respuesta</label>
              <select class="form-input" id="bot-tone-select" ${state.savingBot ? 'disabled' : ''}>
                <option value="formal" ${state.botTone === 'formal' ? 'selected' : ''}>Formal</option>
                <option value="didactic" ${state.botTone === 'didactic' ? 'selected' : ''}>Didáctico</option>
                <option value="concise" ${state.botTone === 'concise' ? 'selected' : ''}>Resumido</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" style="font-weight:500">Longitud de respuesta</label>
              <select class="form-input" id="bot-length-select" ${state.savingBot ? 'disabled' : ''}>
                <option value="concise" ${state.botLength === 'concise' ? 'selected' : ''}>Concisa</option>
                <option value="detailed" ${state.botLength === 'detailed' ? 'selected' : ''}>Detallada</option>
              </select>
            </div>
            <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
              <input type="checkbox" id="bot-sources-toggle" ${state.botIncludeSources ? 'checked' : ''} ${state.savingBot ? 'disabled' : ''}>
              <span style="font-size:var(--fs-sm)">Incluir fuentes por defecto</span>
            </label>
            <button class="btn btn-primary btn-sm" id="save-bot-prefs-btn" style="align-self:flex-start" ${state.savingBot ? 'disabled' : ''}>
              ${state.savingBot ? 'Guardando...' : 'Guardar preferencias del asistente'}
            </button>
          </div>
        </div>

        <!-- Reminder Preferences -->
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

    container.querySelector('#revoke-consent-btn')?.addEventListener('click', async (e) => {
      if (state.savingConsent) return;
      state.savingConsent = true;
      render();
      const success = await auth.revokeAIConsent();
      if (success) {
        state.consentAccepted = false;
        toast('success', 'Consentimiento revocado', 'El consentimiento de IA fue revocado correctamente.');
      } else {
        toast('error', 'Error', 'No se pudo revocar el consentimiento.');
      }
      state.savingConsent = false;
      render();
    });

    container.querySelector('#accept-consent-btn')?.addEventListener('click', async (e) => {
      if (state.savingConsent) return;
      state.savingConsent = true;
      render();
      const success = await auth.acceptAIConsent();
      if (success) {
        state.consentAccepted = true;
        toast('success', 'Consentimiento aceptado', 'El consentimiento de IA fue aceptado correctamente.');
      } else {
        toast('error', 'Error', 'No se pudo aceptar el consentimiento.');
      }
      state.savingConsent = false;
      render();
    });

    container.querySelector('#save-bot-prefs-btn')?.addEventListener('click', async () => {
      state.savingBot = true;
      render();
      try {
        const newTone = container.querySelector('#bot-tone-select')?.value || 'formal';
        const newLength = container.querySelector('#bot-length-select')?.value || 'detailed';
        const newSources = container.querySelector('#bot-sources-toggle')?.checked !== false;
        state.botTone = newTone;
        state.botLength = newLength;
        state.botIncludeSources = newSources;
        auth.setBotPreferences({ tone: newTone, length: newLength, includeSources: newSources });
        toast('success', 'Preferencias guardadas', 'Las preferencias del asistente se actualizaron.');
      } catch (err) {
        toast('error', 'Error', 'No se pudieron guardar las preferencias.');
      }
      state.savingBot = false;
      render();
    });

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
