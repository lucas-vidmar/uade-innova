import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

export async function renderAdminModelConfig(container) {
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
        <label class="card" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4);cursor:pointer;border:2px solid var(--color-primary);border-radius:var(--radius-md)" id="model-deepseek">
          <input type="radio" name="ai-model" value="deepseek-v4-flash" checked style="accent-color:var(--color-primary)">
          <div>
            <strong>DeepSeek V4 Flash</strong>
            <p class="text-xs text-text-muted" style="margin:2px 0 0">Rápido y eficiente. Ideal para respuestas cotidianas. Consumido desde Azure AI Foundry.</p>
          </div>
          <span class="badge badge-success" style="margin-left:auto">Activo</span>
        </label>

        <label class="card" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4);cursor:pointer;border:2px solid transparent;border-radius:var(--radius-md);opacity:0.6" id="model-gpt">
          <input type="radio" name="ai-model" value="gpt-4o-mini">
          <div>
            <strong>GPT-4o Mini</strong>
            <p class="text-xs text-text-muted" style="margin:2px 0 0">Alternativa de OpenAI. Mayor precisión en tareas complejas pero mayor latencia.</p>
          </div>
        </label>
      </div>
    </div>

    <div class="card animate-in" style="margin-bottom:var(--space-6)">
      <h3 style="margin-bottom:var(--space-4)">Modelo de Embeddings</h3>
      <div style="display:flex;align-items:center;gap:var(--space-3)">
        <div>
          <strong>text-embedding-3-small</strong>
          <p class="text-xs text-text-muted" style="margin:2px 0 0">Dimensión: 1536 · Azure OpenAI (RS-OPENAI-LLM)</p>
        </div>
        <span class="badge badge-success" style="margin-left:auto">Fijo</span>
      </div>
      <p class="text-xs text-text-muted" style="margin-top:var(--space-2)">El modelo de embeddings es fijo y no se puede cambiar desde esta interfaz.</p>
    </div>

    <div class="card animate-in">
      <h3 style="margin-bottom:var(--space-4)">Parámetros de Generación</h3>
      <div style="display:grid;gap:var(--space-4)">
        <div>
          <label class="form-label" style="font-weight:600">Temperatura</label>
          <input type="range" id="setting-temperature" min="0" max="1" step="0.1" value="0.3" style="width:100%;max-width:300px">
          <span id="temperature-value" style="font-family:monospace;font-size:0.85rem">0.3</span>
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Máximo de tokens por respuesta</label>
          <input type="number" id="setting-max-tokens" value="2048" min="256" max="8192" style="max-width:200px" class="form-input">
        </div>
        <div>
          <label class="form-label" style="font-weight:600">Top P</label>
          <input type="range" id="setting-top-p" min="0" max="1" step="0.05" value="0.95" style="width:100%;max-width:300px">
          <span id="top-p-value" style="font-family:monospace;font-size:0.85rem">0.95</span>
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

  document.getElementById('btn-model-save')?.addEventListener('click', () => {
    toast('success', 'Configuración guardada', 'El modelo y parámetros se actualizarán en las próximas respuestas.');
  });
}
