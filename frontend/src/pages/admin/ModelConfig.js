import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

export async function renderAdminModelConfig(container) {
  let config = {
    model: 'deepseek-v4-flash',
    temperature: 0.3,
    maxTokens: 2048,
    topP: 0.95,
    embeddingModel: 'text-embedding-3-small',
  };

  async function loadConfig() {
    try {
      const result = await api.getAdminConfig('model');
      if (result?.data) config = { ...config, ...result.data };
    } catch (err) {
      console.warn('[ModelConfig] No se pudo cargar la configuración del modelo:', err);
    }
  }

  await loadConfig();

  container.innerHTML = `
    <div class="page-header">
      <h1 class="h2">Configuración del Modelo de IA</h1>
      <p class="text-secondary">Seleccionar el modelo activo para las respuestas del asistente.</p>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Modelo de Chat Activo</h3>
      <p class="text-xs text-text-muted" style="margin-bottom:var(--space-4)">
        El modelo seleccionado se usará para generar respuestas en el chat RAG.
      </p>
      <div style="display:grid;gap:var(--space-3)">
        <label class="card" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4);cursor:pointer;border:2px solid ${config.model === 'deepseek-v4-flash' ? 'var(--color-primary)' : 'transparent'};border-radius:var(--radius-md)" id="model-deepseek">
          <input type="radio" name="ai-model" value="deepseek-v4-flash" ${config.model === 'deepseek-v4-flash' ? 'checked' : ''} style="accent-color:var(--color-primary)">
          <div>
            <strong>DeepSeek V4 Flash</strong>
            <p class="text-xs text-text-muted" style="margin:2px 0 0">Rápido y eficiente. Ideal para respuestas cotidianas. Consumido desde Azure AI Foundry.</p>
          </div>
          <span class="badge badge-success" style="margin-left:auto">Activo</span>
        </label>


      </div>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Modelo de Embeddings</h3>
      <div style="display:flex;align-items:center;gap:var(--space-3)">
        <div>
          <strong>${config.embeddingModel}</strong>
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
    const deepseekRadio = document.querySelector('input[name="ai-model"][value="deepseek-v4-flash"]');
    const gptRadio = document.querySelector('input[name="ai-model"][value="gpt-4o-mini"]');
    if (deepseekRadio) deepseekRadio.checked = config.model === 'deepseek-v4-flash';
    if (gptRadio) gptRadio.checked = config.model === 'gpt-4o-mini';
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
        renderValues();
      }
      toast('success', 'Configuración guardada', 'El modelo y parámetros se actualizarán en las próximas respuestas.');
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
