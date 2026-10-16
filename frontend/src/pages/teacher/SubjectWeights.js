import { auth } from '../../services/auth.js';
import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

const MATERIAL_LABELS = {
  notes: { label: 'Apuntes del docente', desc: 'Notas y apuntes de clase preparados por el docente' },
  bibliography: { label: 'Bibliografía', desc: 'Libros, papers y referencias bibliográficas' },
  transcript: { label: 'Transcripciones', desc: 'Transcripciones automáticas de las clases' },
  presentation: { label: 'Presentaciones', desc: 'Slides y presentaciones de clase' },
};

const DEFAULT_VALUES = { notes: 1.35, bibliography: 1.1, transcript: 1.0, presentation: 0.95 };

function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export async function renderSubjectWeights(container, subjectId, subjectName) {
  if (!subjectId) {
    container.innerHTML = '<div class="card"><p>Seleccioná una materia primero.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="section-title" style="margin-top:var(--space-10)">
      <h2>Ponderación de fuentes — ${subjectName || ''}</h2>
      <div class="line"></div>
    </div>
    <div class="card" id="weights-editor">
      <p class="page-subtitle" style="margin-bottom:var(--space-6)">
        Ajustá cuánto peso tiene cada tipo de material en las respuestas del chat.
        Un peso más alto prioriza ese tipo de material sobre otros.
      </p>
      <div class="weights-loading" style="padding:24px;text-align:center;color:var(--color-text-secondary)">Cargando configuración...</div>
    </div>
  `;

  const editor = container.querySelector('#weights-editor');
  let currentWeights = { ...DEFAULT_VALUES };
  let isDefaults = true;
  let meta = { updatedBy: null, updatedAt: null, reason: '' };

  function constanciaHtml() {
    // UJ-11 paso 6: la decisión sobre qué fuente manda tiene que ser revisable por
    // otra persona: quién la fijó, cuándo y con qué fundamento.
    const when = formatWhen(meta.updatedAt);
    if (!meta.updatedBy && !when) {
      return `
        <div class="weights-constancia" style="margin-bottom:var(--space-4);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:var(--font-size-sm);color:var(--color-text-secondary)">
          Todavía nadie fijó una ponderación propia para esta unidad: se están usando los valores por defecto.
        </div>`;
    }
    return `
      <div class="weights-constancia" id="weights-constancia" style="margin-bottom:var(--space-4);padding:var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);font-size:var(--font-size-sm)">
        <div><strong>Fijada por:</strong> ${meta.updatedBy || 'sin registrar'}${when ? ` · <strong>Cuándo:</strong> ${when}` : ''}</div>
        <div style="margin-top:var(--space-2)"><strong>Fundamento:</strong> ${meta.reason ? meta.reason : '<em>sin motivo registrado</em>'}</div>
      </div>`;
  }

  function renderError(message) {
    editor.innerHTML = `
      <div class="empty-state" style="padding:var(--space-6)">
        <div class="empty-state-icon">⚠️</div>
        <h3>No se pudo leer la ponderación de la unidad</h3>
        <p style="font-size:var(--font-size-sm)">${message}</p>
        <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">
          No se muestran valores para no confundir los que están vigentes con los que se ven.
          Reintentá antes de cambiar nada.
        </p>
        <button class="btn btn-secondary" id="weights-retry-btn" style="margin-top:var(--space-4)">Reintentar</button>
      </div>
    `;
    editor.querySelector('#weights-retry-btn')?.addEventListener('click', () => loadWeights());
  }

  async function loadWeights() {
    editor.innerHTML = '<div class="weights-loading" style="padding:24px;text-align:center;color:var(--color-text-secondary)">Cargando configuración...</div>';
    const result = await api.getSubjectWeights(subjectId);
    if (result?.readFailed) {
      renderError('La respuesta del servidor no llegó o vino con error.');
      return;
    }
    if (result?.data) {
      currentWeights = { ...DEFAULT_VALUES, ...result.data };
      isDefaults = result.defaults === true;
      meta = { updatedBy: result.updatedBy || null, updatedAt: result.updatedAt || null, reason: result.reason || '' };
    }
    renderSliders();
  }

  function renderSliders() {
    editor.innerHTML = `
      <p class="page-subtitle" style="margin-bottom:var(--space-6)">
        Ajustá cuánto peso tiene cada tipo de material en las respuestas del chat.
        Un peso más alto prioriza ese tipo de material sobre otros.
      </p>
      ${isDefaults ? '<div class="badge badge-info" style="margin-bottom:var(--space-4)">Usando valores por defecto</div>' : ''}
      ${constanciaHtml()}
      <div class="weights-sliders">
        ${Object.entries(MATERIAL_LABELS).map(([key, info]) => `
          <div class="weight-slider-row" style="margin-bottom:var(--space-5)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
              <div>
                <strong>${info.label}</strong>
                <div style="font-size:0.85em;color:var(--color-text-secondary)">${info.desc}</div>
              </div>
              <span class="badge badge-neutral" id="weight-value-${key}" style="min-width:48px;text-align:center">${currentWeights[key]?.toFixed(2)}</span>
            </div>
            <input type="range" class="weight-slider" id="slider-${key}"
              min="0" max="3" step="0.05" value="${currentWeights[key]}"
              aria-label="Peso de ${info.label}"
              style="width:100%;accent-color:var(--color-primary)" />
            <div style="display:flex;justify-content:space-between;font-size:0.8em;color:var(--color-text-secondary)">
              <span>0 (excluir)</span>
              <span>1 (normal)</span>
              <span>3 (máxima prioridad)</span>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="form-group" style="margin-top:var(--space-4)">
        <label class="form-label" for="weights-reason">Motivo de esta ponderación</label>
        <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);margin:var(--space-1) 0 var(--space-2)">
          Se guarda con tu nombre y la fecha, para que otra persona pueda revisar la decisión y volver atrás con motivo.
        </p>
        <textarea class="form-input" id="weights-reason" rows="3" placeholder="Por qué esta fuente manda sobre la otra en esta unidad">${meta.reason || ''}</textarea>
        <p id="weights-reason-error" role="alert" aria-live="assertive" style="color:var(--color-error);font-size:0.85rem;margin:var(--space-2) 0 0;display:none"></p>
      </div>
      <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
        <button class="btn btn-primary" id="weights-save-btn">Guardar ponderación</button>
        <button class="btn btn-secondary" id="weights-reset-btn">Restablecer valores por defecto</button>
      </div>
      <div id="weights-status" style="margin-top:var(--space-3)"></div>
    `;

    Object.keys(MATERIAL_LABELS).forEach(key => {
      const slider = editor.querySelector(`#slider-${key}`);
      const valueBadge = editor.querySelector(`#weight-value-${key}`);
      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        valueBadge.textContent = val.toFixed(2);
        currentWeights[key] = val;
      });
    });

    editor.querySelector('#weights-save-btn').addEventListener('click', onSave);
    editor.querySelector('#weights-reset-btn').addEventListener('click', onReset);
  }

  function readReason() {
    const field = editor.querySelector('#weights-reason');
    const errorEl = editor.querySelector('#weights-reason-error');
    const reason = String(field?.value || '').trim();
    if (!reason) {
      if (errorEl) {
        errorEl.textContent = 'Escribí el motivo: sin fundamento la jerarquía no es revisable por otra persona.';
        errorEl.style.display = 'block';
      }
      field?.focus();
      return null;
    }
    if (errorEl) errorEl.style.display = 'none';
    return reason;
  }

  async function onSave() {
    const reason = readReason();
    if (!reason) return;

    const saveBtn = editor.querySelector('#weights-save-btn');
    const status = editor.querySelector('#weights-status');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    try {
      const result = await api.saveSubjectWeights(subjectId, currentWeights, reason);
      if (result?.data) {
        currentWeights = { ...DEFAULT_VALUES, ...result.data };
        isDefaults = false;
        meta = {
          updatedBy: result.updatedBy || meta.updatedBy,
          updatedAt: result.updatedAt || new Date().toISOString(),
          reason: result.reason || reason,
        };
        toast('success', 'Ponderación guardada', 'Los pesos se aplicarán en las próximas consultas.');
        renderSliders();
      }
    } catch (err) {
      status.innerHTML = `<span style="color:var(--color-error)">${err.message}</span>`;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar ponderación';
    }
  }

  async function onReset() {
    const reason = readReason();
    if (!reason) return;

    const resetBtn = editor.querySelector('#weights-reset-btn');
    resetBtn.disabled = true;
    try {
      const result = await api.saveSubjectWeights(subjectId, DEFAULT_VALUES, `Restablecer valores por defecto — ${reason}`);
      currentWeights = { ...DEFAULT_VALUES };
      isDefaults = true;
      meta = {
        updatedBy: result?.updatedBy || meta.updatedBy,
        updatedAt: result?.updatedAt || new Date().toISOString(),
        reason: result?.reason || `Restablecer valores por defecto — ${reason}`,
      };
      toast('success', 'Valores restablecidos', 'Se usarán los valores por defecto.');
      renderSliders();
    } catch (err) {
      const status = editor.querySelector('#weights-status');
      status.innerHTML = `<span style="color:var(--color-error)">${err.message}</span>`;
    } finally {
      resetBtn.disabled = false;
    }
  }

  await loadWeights();
}
