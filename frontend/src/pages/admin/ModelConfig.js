import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

// Motores que el backend acepta para el asistente (`ALLOWED_MODELS` en
// `backend/src/services/admin-settings.js`). Se listan todos: esconder uno hacía
// que la pantalla mostrara "Activo" sobre un motor distinto del guardado (UJ-55).
const MOTORES_SELECCIONABLES = ['deepseek-v4-flash', 'gpt-4o-mini'];

const ETIQUETA_MOTOR = {
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'gpt-4o-mini': 'GPT-4o mini',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export async function renderAdminModelConfig(container) {
  let config = {
    model: 'deepseek-v4-flash',
    temperature: 0.3,
    maxTokens: 2048,
    topP: 0.95,
    embeddingModel: 'text-embedding-3-small',
  };
  // Registro del cambio (quién y cuándo) y motor que efectivamente responde.
  // Ambos vienen en la respuesta del backend y antes se descartaban: la pantalla
  // no podía distinguir "lo que guardé" de "lo que responde" (UJ-55 paso 9).
  let meta = { defaults: null, updatedAt: null, updatedBy: null, effective: null, disponible: false };

  async function loadConfig() {
    try {
      const result = await api.getAdminConfig('model');
      if (result?.data) {
        config = { ...config, ...result.data };
        meta = {
          defaults: result.defaults ?? null,
          updatedAt: result.updatedAt ?? null,
          updatedBy: result.updatedBy ?? null,
          effective: result.effective ?? null,
          disponible: true,
        };
      }
    } catch (err) {
      console.warn('[ModelConfig] No se pudo cargar la configuración del modelo:', err);
    }
  }

  await loadConfig();

  const motorEfectivo = meta.effective?.model || null;
  const seleccionGobierna = !!motorEfectivo && motorEfectivo === config.model;

  function registroTexto() {
    if (!meta.disponible) return 'No se pudo leer el registro del cambio.';
    if (meta.defaults === true || !meta.updatedAt) {
      return 'Sin modificaciones registradas: rige el valor por defecto.';
    }
    const cuando = new Date(meta.updatedAt).toLocaleString('es-AR');
    return `Última modificación registrada: ${cuando}${meta.updatedBy ? ` por ${esc(meta.updatedBy)}` : ''}.`;
  }

  function vigenteTexto() {
    if (!meta.disponible) return 'Motor vigente no disponible (no se pudo leer la configuración).';
    if (!motorEfectivo) return 'Motor vigente no informado por el servicio.';
    const origen = meta.effective?.source === 'prompt-version'
      ? `fijado por la versión activa del prompt del asistente${meta.effective?.promptVersion ? ` (${esc(meta.effective.promptVersion)})` : ''}`
      : 'tomado de la configuración del servicio';
    return `${esc(motorEfectivo)} — ${origen}.`;
  }

  function avisoSeleccion() {
    if (!meta.disponible || !motorEfectivo || seleccionGobierna) return '';
    return `
      <div class="card animate-in" style="margin-bottom:var(--space-6);border-left:4px solid var(--color-warning)">
        <div style="display:flex;gap:var(--space-3);align-items:flex-start;padding:var(--space-4)">
          <span aria-hidden="true" style="font-size:1.25rem">⚠️</span>
          <div>
            <strong>La selección guardada no gobierna las respuestas.</strong>
            <div class="text-xs text-text-muted" style="margin-top:2px">
              Lo guardado en esta pantalla es <code>${esc(config.model)}</code>, pero el motor que responde hoy es
              <strong>${esc(motorEfectivo)}</strong>. Para cambiar el motor del asistente hay que usar
              <a href="#/admin/prompts">Gestión de Prompts</a>: el motor lo fija la versión activa del prompt.
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderMotores() {
    return MOTORES_SELECCIONABLES.map((valor) => `
        <label class="card" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4);cursor:pointer;border:2px solid ${config.model === valor ? 'var(--color-primary)' : 'transparent'};border-radius:var(--radius-md)" id="model-${valor}">
          <input type="radio" name="ai-model" value="${valor}" ${config.model === valor ? 'checked' : ''} style="accent-color:var(--color-primary)">
          <div>
            <strong>${ETIQUETA_MOTOR[valor] || valor}</strong>
            <p class="text-xs text-text-muted" style="margin:2px 0 0">${valor === 'deepseek-v4-flash' ? 'Rápido y eficiente. Ideal para respuestas cotidianas. Consumido desde Azure AI Foundry.' : 'Motor candidato alternativo. Consumido desde Azure OpenAI.'}</p>
          </div>
          ${motorEfectivo === valor ? '<span class="badge badge-success" style="margin-left:auto">Vigente</span>' : ''}
          ${config.model === valor ? '<span class="badge" style="margin-left:auto;background:var(--color-surface-3);color:var(--color-text-muted)">Seleccionado</span>' : ''}
        </label>`).join('');
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="h2">Configuración del Modelo de IA</h1>
      <p class="text-secondary">Seleccionar el modelo activo para las respuestas del asistente.</p>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Modelo de Chat Activo</h3>
      <div style="display:grid;gap:var(--space-3);margin-bottom:var(--space-4)">
        <div>
          <span class="form-label" style="font-weight:600">Motor que responde hoy</span>
          <p class="text-sm" style="margin:2px 0 0" id="motor-vigente">${vigenteTexto()}</p>
        </div>
        <div>
          <span class="form-label" style="font-weight:600">Selección guardada en esta pantalla</span>
          <p class="text-sm" style="margin:2px 0 0" id="motor-seleccionado">${esc(config.model)}${seleccionGobierna ? ' — es el motor vigente.' : ''}</p>
        </div>
        <div>
          <span class="form-label" style="font-weight:600">Registro del cambio</span>
          <p class="text-sm text-text-muted" style="margin:2px 0 0" id="registro-cambio">${registroTexto()}</p>
        </div>
      </div>
      <p class="text-xs text-text-muted" style="margin-bottom:var(--space-4)">
        El motor que responde lo fija la versión activa del prompt del asistente. Elegir otro motor acá
        todavía no cambia las respuestas.
      </p>
      <div style="display:grid;gap:var(--space-3)" id="lista-motores">
        ${renderMotores()}
      </div>
    </div>

    ${avisoSeleccion()}

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Modelo de Embeddings</h3>
      <div style="display:flex;align-items:center;gap:var(--space-3)">
        <div>
          <strong>${esc(config.embeddingModel)}</strong>
          <p class="text-xs text-text-muted" style="margin:2px 0 0">Dimensión: 1536 · Azure OpenAI (RS-OPENAI-LLM)</p>
        </div>
        <span class="badge" style="margin-left:auto;background:var(--color-surface-3);color:var(--color-text-muted)">Prototipo · Fijo</span>
      </div>
      <p class="text-xs text-text-muted" style="margin-top:var(--space-2)">El modelo de embeddings es fijo y no se puede cambiar desde esta interfaz. No se persiste.</p>
    </div>

    <div class="card animate-in">
      <h3 style="margin-bottom:var(--space-4)">Parámetros de Generación</h3>
      <div style="display:grid;gap:var(--space-4)">
        <div>
          <label class="form-label" style="font-weight:600">Temperatura</label>
          <input type="range" id="setting-temperature" min="0" max="1" step="0.1" value="${config.temperature}" style="width:100%;max-width:300px">
          <span id="temperature-value" style="font-family:monospace;font-size:0.85rem">${config.temperature}</span>
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Máximo de tokens por respuesta</label>
          <input type="number" id="setting-max-tokens" value="${config.maxTokens}" min="256" max="8192" style="max-width:200px" class="form-input">
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Top P</label>
          <input type="range" id="setting-top-p" min="0" max="1" step="0.05" value="${config.topP}" style="width:100%;max-width:300px">
          <span id="top-p-value" style="font-family:monospace;font-size:0.85rem">${config.topP}</span>
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:var(--space-3);margin-top:var(--space-6)">
      <button class="btn btn-secondary" id="btn-model-reset">Restablecer</button>
      <button class="btn btn-primary" id="btn-model-save">Guardar Configuración</button>
    </div>
  `;

  document.getElementById('setting-temperature')?.addEventListener('input', (e) => {
    document.getElementById('temperature-value').textContent = e.target.value;
  });

  document.getElementById('setting-top-p')?.addEventListener('input', (e) => {
    document.getElementById('top-p-value').textContent = e.target.value;
  });

  function renderValues() {
    for (const valor of MOTORES_SELECCIONABLES) {
      const radio = document.querySelector(`input[name="ai-model"][value="${valor}"]`);
      if (radio) radio.checked = config.model === valor;
    }
    document.getElementById('setting-temperature').value = config.temperature;
    document.getElementById('temperature-value').textContent = config.temperature;
    document.getElementById('setting-max-tokens').value = config.maxTokens;
    document.getElementById('setting-top-p').value = config.topP;
    document.getElementById('top-p-value').textContent = config.topP;
  }

  function readValues() {
    const selected = document.querySelector('input[name="ai-model"]:checked');
    return {
      model: selected?.value || config.model || 'deepseek-v4-flash',
      temperature: Number(document.getElementById('setting-temperature').value),
      maxTokens: Number(document.getElementById('setting-max-tokens').value),
      topP: Number(document.getElementById('setting-top-p').value),
    };
  }

  document.getElementById('btn-model-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-model-save');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      const result = await api.saveAdminConfig('model', readValues());
      if (result?.data) {
        config = { ...config, ...result.data };
        meta = {
          defaults: result.defaults ?? null,
          updatedAt: result.updatedAt ?? null,
          updatedBy: result.updatedBy ?? null,
          effective: result.effective ?? meta.effective,
          disponible: true,
        };
        renderValues();
      }
      // No se promete un efecto sobre las respuestas: el motor vigente lo fija
      // la versión activa del prompt y esta pantalla todavía no lo cambia (UJ-55).
      const vigente = meta.effective?.model;
      toast(
        'success',
        'Selección guardada',
        vigente
          ? `Quedó registrada la selección. El motor que responde sigue siendo ${vigente}.`
          : 'Quedó registrada la selección.',
      );
    } catch (err) {
      toast('error', 'Error al guardar la configuración', err.message || 'No se pudo persistir la configuración del modelo.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Configuración';
    }
  });

  document.getElementById('btn-model-reset')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-model-reset');
    btn.disabled = true;
    try {
      const result = await api.resetAdminConfig('model');
      if (result?.data) {
        config = { ...config, ...result.data };
        meta = {
          defaults: result.defaults ?? null,
          updatedAt: result.updatedAt ?? null,
          updatedBy: result.updatedBy ?? null,
          effective: result.effective ?? meta.effective,
          disponible: true,
        };
        renderValues();
      }
      toast('success', 'Valores restablecidos', 'Se restauraron los valores por defecto del modelo.');
    } catch (err) {
      toast('error', 'Error al restablecer', err.message || 'No se pudieron restablecer los valores.');
    } finally {
      btn.disabled = false;
    }
  });
}
