import { auth } from '../../services/auth.js';
import { api } from '../../services/api.js';
import { toast } from '../../components/Toast.js';

export async function renderGlossaryManager(container) {
  const subjectId = auth.getActiveSubjectId();
  if (!subjectId) {
    container.innerHTML = '<div class="card"><p>Seleccioná una materia primero.</p></div>';
    return;
  }

  container.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-5);flex-wrap:wrap">
      <div>
        <h1 class="h2" style="margin:0">Glosario de Términos</h1>
        <p class="page-subtitle" style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:var(--font-size-sm)">Términos técnicos para corrección automática de transcripciones <span id="glossary-count" style="color:var(--color-text-muted)"></span></p>
      </div>
      <button class="btn btn-primary" id="glossary-add-term-btn">+ Agregar Término</button>
    </div>
    <div class="card" id="glossary-editor" style="padding:0;overflow:hidden">
      <div class="glossary-loading" style="padding:var(--space-8);text-align:center;color:var(--color-text-secondary)">Cargando glosario...</div>
    </div>
  `;

  const editor = container.querySelector('#glossary-editor');
  const countEl = container.querySelector('#glossary-count');
  const topAddBtn = container.querySelector('#glossary-add-term-btn');

  let glossary = { terms: [] };
  let dirty = false;
  let saving = false;
  let savedAt = null;

  function updateCount() {
    const n = (glossary.terms || []).length;
    if (countEl) countEl.textContent = n > 0 ? `· ${n} término${n === 1 ? '' : 's'}` : '';
  }

  function updateSaveBtn() {
    const btn = editor.querySelector('#glossary-save-btn');
    if (!btn) return;
    btn.disabled = saving || !dirty;
    btn.textContent = saving ? 'Guardando...' : 'Guardar Glosario';
  }

  function markDirty() {
    if (!dirty) {
      dirty = true;
      updateSaveBtn();
    }
  }

  // Copia lo escrito en los inputs al modelo antes de cualquier re-render
  // (agregar/eliminar/guardar). Sin esto, el texto tipeado se pierde.
  function syncModelFromDom() {
    const rows = editor.querySelectorAll('.glossary-term-row');
    glossary.terms = Array.from(rows).map((row) => {
      const term = row.querySelector('[data-field="term"]')?.value ?? '';
      const aliasesRaw = row.querySelector('[data-field="aliases"]')?.value ?? '';
      const definition = row.querySelector('[data-field="definition"]')?.value ?? '';
      const aliases = String(aliasesRaw).split(',').map((a) => a.trim()).filter(Boolean);
      return { term: String(term).trim(), aliases, definition: String(definition).trim() };
    });
  }

  function renderTerms(loadError) {
    updateCount();
    const terms = glossary.terms || [];

    if (loadError) {
      editor.innerHTML = `
        <div class="empty-state" style="padding:var(--space-8)">
          <div class="empty-state-icon">⚠️</div>
          <h3>No se pudo cargar el glosario</h3>
          <p style="font-size:var(--font-size-sm)">${escapeHtml(loadError)}</p>
          <button class="btn btn-secondary" id="glossary-retry-btn" style="margin-top:var(--space-4)">Reintentar</button>
        </div>
      `;
      editor.querySelector('#glossary-retry-btn').addEventListener('click', load);
      return;
    }

    if (terms.length === 0) {
      editor.innerHTML = `
        <div class="empty-state" style="padding:var(--space-8)">
          <div class="empty-state-icon">📖</div>
          <h3>Sin términos aún</h3>
          <p style="font-size:var(--font-size-sm)">Agregá términos técnicos para que el sistema detecte errores en las transcripciones automáticamente.</p>
          <button class="btn btn-primary" id="glossary-add-term-empty-btn" style="margin-top:var(--space-4)">+ Agregar Término</button>
        </div>
      `;
      editor.querySelector('#glossary-add-term-empty-btn').addEventListener('click', addTerm);
      updateSaveBtn();
      return;
    }

    editor.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;min-width:640px;border-collapse:collapse;font-size:var(--font-size-sm)">
          <thead>
            <tr style="border-bottom:1px solid var(--color-border)">
              <th style="padding:var(--space-3) var(--space-4);text-align:left;font-size:var(--font-size-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);width:28%">Término</th>
              <th style="padding:var(--space-3) var(--space-4);text-align:left;font-size:var(--font-size-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);width:32%">Aliases</th>
              <th style="padding:var(--space-3) var(--space-4);text-align:left;font-size:var(--font-size-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);width:30%">Definición</th>
              <th style="padding:var(--space-3) var(--space-4);width:10%;min-width:50px"></th>
            </tr>
          </thead>
          <tbody>
            ${terms.map((t, i) => `
              <tr class="glossary-term-row" data-index="${i}" style="border-bottom:1px solid var(--color-border)">
                <td style="padding:var(--space-2) var(--space-4)">
                  <input type="text" class="form-input" value="${escapeHtml(t.term)}" data-field="term" style="height:34px;font-size:var(--font-size-sm)" placeholder="Término" aria-label="Término ${i + 1}" />
                </td>
                <td style="padding:var(--space-2) var(--space-4)">
                  <input type="text" class="form-input" value="${escapeHtml((t.aliases || []).join(', '))}" data-field="aliases" style="height:34px;font-size:var(--font-size-sm)" placeholder="alias1, alias2" aria-label="Aliases ${i + 1}" />
                </td>
                <td style="padding:var(--space-2) var(--space-4)">
                  <input type="text" class="form-input" value="${escapeHtml(t.definition || '')}" data-field="definition" style="height:34px;font-size:var(--font-size-sm)" placeholder="Definición del término" aria-label="Definición ${i + 1}" />
                </td>
                <td style="padding:var(--space-2) var(--space-4);text-align:right">
                  <button class="btn btn-ghost btn-sm glossary-term-remove" data-index="${i}" title="Eliminar término" style="color:var(--color-error);padding:4px 8px">✕</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-3) var(--space-4);border-top:1px solid var(--color-border);flex-wrap:wrap;gap:var(--space-3)">
        <span id="glossary-saved-indicator" style="font-size:var(--font-size-xs);color:var(--color-text-muted)">${savedAt ? `Guardado ${savedAt}` : ''}</span>
        <button class="btn btn-primary btn-sm" id="glossary-save-btn">Guardar Glosario</button>
      </div>
    `;

    editor.querySelectorAll('.glossary-term-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncModelFromDom();
        const idx = parseInt(btn.dataset.index, 10);
        if (!Number.isNaN(idx)) glossary.terms.splice(idx, 1);
        markDirty();
        renderTerms();
      });
    });

    editor.querySelector('#glossary-save-btn').addEventListener('click', onSave);
    updateSaveBtn();
  }

  // Sincronización en vivo: cada tecla actualiza el modelo, sin re-render.
  editor.addEventListener('input', (ev) => {
    const input = ev.target?.closest?.('[data-field]');
    if (!input) return;
    const row = input.closest('.glossary-term-row');
    if (!row) return;
    const idx = Array.from(editor.querySelectorAll('.glossary-term-row')).indexOf(row);
    if (idx < 0 || !glossary.terms[idx]) return;
    const field = input.dataset.field;
    if (field === 'aliases') {
      glossary.terms[idx].aliases = String(input.value).split(',').map((a) => a.trim()).filter(Boolean);
    } else if (field === 'term') {
      glossary.terms[idx].term = input.value;
    } else if (field === 'definition') {
      glossary.terms[idx].definition = input.value;
    }
    input.classList.remove('input-invalid');
    input.style.borderColor = '';
    markDirty();
  });

  async function onSave() {
    if (saving) return;
    syncModelFromDom();
    const rows = Array.from(editor.querySelectorAll('.glossary-term-row'));
    const valid = glossary.terms
      .map((t) => ({
        term: String(t.term || '').trim(),
        aliases: Array.isArray(t.aliases) ? t.aliases : [],
        definition: String(t.definition || '').trim(),
      }))
      .filter((t) => t.term);

    if (valid.length === 0) {
      rows.forEach((row) => {
        const termInput = row.querySelector('[data-field="term"]');
        if (termInput && !termInput.value.trim()) {
          termInput.classList.add('input-invalid');
          termInput.style.borderColor = 'var(--color-error)';
        }
      });
      const firstInvalid = editor.querySelector('.glossary-term-row [data-field="term"]');
      if (firstInvalid) firstInvalid.focus();
      toast('warning', 'Sin términos para guardar', 'Completá al menos un término antes de guardar.');
      return;
    }

    saving = true;
    updateSaveBtn();
    const indicator = editor.querySelector('#glossary-saved-indicator');
    if (indicator) indicator.textContent = 'Guardando...';
    try {
      const result = await api.updateGlossary(subjectId, valid);
      glossary = result && Array.isArray(result.terms) ? result : { terms: valid };
      dirty = false;
      savedAt = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      toast('success', 'Glosario guardado', 'Los términos se actualizaron correctamente.');
      renderTerms();
    } catch (err) {
      toast('error', 'Error al guardar', err.message);
      updateSaveBtn();
      if (indicator) indicator.textContent = '';
    } finally {
      saving = false;
      updateSaveBtn();
    }
  }

  function addTerm() {
    syncModelFromDom();
    glossary.terms.push({ term: '', aliases: [], definition: '' });
    markDirty();
    renderTerms();
    const inputs = editor.querySelectorAll('.glossary-term-row [data-field="term"]');
    const lastInput = inputs[inputs.length - 1];
    if (lastInput) setTimeout(() => lastInput.focus(), 50);
  }

  topAddBtn.addEventListener('click', addTerm);

  async function load() {
    editor.innerHTML = '<div class="glossary-loading" style="padding:var(--space-8);text-align:center;color:var(--color-text-secondary)">Cargando glosario...</div>';
    try {
      const data = await api.getGlossary(subjectId);
      glossary = data && Array.isArray(data.terms) ? data : { terms: [] };
      dirty = false;
      renderTerms();
    } catch (err) {
      renderTerms(err.message || 'Error al cargar el glosario.');
    }
  }

  await load();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
