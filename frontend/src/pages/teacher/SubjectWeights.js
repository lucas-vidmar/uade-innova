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

  async function loadWeights() {
    const result = await api.getSubjectWeights(subjectId);
    if (result?.data) {
      currentWeights = { ...DEFAULT_VALUES, ...result.data };
      isDefaults = result.defaults === true;
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
      <div class="weights-sliders">
        ${Object.entries(MATERIAL_LABELS).map(([key, meta]) => `
          <div class="weight-slider-row" style="margin-bottom:var(--space-5)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2)">
              <div>
                <strong>${meta.label}</strong>
                <div style="font-size:0.85em;color:var(--color-text-secondary)">${meta.desc}</div>
              </div>
              <span class="badge badge-neutral" id="weight-value-${key}" style="min-width:48px;text-align:center">${currentWeights[key]?.toFixed(2)}</span>
            </div>
            <input type="range" class="weight-slider" id="slider-${key}"
              min="0" max="3" step="0.05" value="${currentWeights[key]}"
              style="width:100%;accent-color:var(--color-primary)" />
            <div style="display:flex;justify-content:space-between;font-size:0.8em;color:var(--color-text-secondary)">
              <span>0 (excluir)</span>
              <span>1 (normal)</span>
              <span>3 (máxima prioridad)</span>
            </div>
          </div>
        `).join('')}
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

  async function onSave() {
    const saveBtn = editor.querySelector('#weights-save-btn');
    const status = editor.querySelector('#weights-status');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';
    try {
      const result = await api.saveSubjectWeights(subjectId, currentWeights);
      if (result?.data) {
        currentWeights = { ...DEFAULT_VALUES, ...result.data };
        isDefaults = false;
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
    const resetBtn = editor.querySelector('#weights-reset-btn');
    resetBtn.disabled = true;
    try {
      await api.saveSubjectWeights(subjectId, DEFAULT_VALUES);
      currentWeights = { ...DEFAULT_VALUES };
      isDefaults = true;
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
