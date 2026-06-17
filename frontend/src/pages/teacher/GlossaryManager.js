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
    <div class="page-header">
      <div>
        <h1 class="h2">Glosario de Términos</h1>
        <p class="page-subtitle">Gestioná los términos técnicos para la corrección automática de transcripciones</p>
      </div>
      <button class="btn btn-primary" id="glossary-add-term-btn">+ Agregar Término</button>
    </div>
    <div class="card" id="glossary-editor">
      <div class="glossary-loading">Cargando glosario...</div>
    </div>
  `;

  const editor = container.querySelector('#glossary-editor');
  let glossary = { terms: [] };

  function renderTerms() {
    const terms = glossary.terms || [];
    if (terms.length === 0) {
      editor.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📖</div>
          <h3>Sin términos aún</h3>
          <p>Agregá términos técnicos para que el sistema detecte errores en las transcripciones automáticamente.</p>
        </div>
      `;
      return;
    }

    editor.innerHTML = `
      <div class="glossary-term-list">
        ${terms.map((t, i) => `
          <div class="glossary-term-row" data-index="${i}">
            <div class="glossary-term-field">
              <label class="glossary-term-label">Término</label>
              <input type="text" class="form-input glossary-term-input" value="${escapeHtml(t.term)}" data-field="term" />
            </div>
            <div class="glossary-term-field">
              <label class="glossary-term-label">Aliases (separados por coma)</label>
              <input type="text" class="form-input glossary-term-input" value="${escapeHtml((t.aliases || []).join(', '))}" data-field="aliases" />
            </div>
            <button class="btn btn-ghost glossary-term-remove" data-index="${i}" title="Eliminar término">✕</button>
          </div>
        `).join('')}
      </div>
      <div class="glossary-actions">
        <button class="btn btn-primary" id="glossary-save-btn">Guardar Glosario</button>
        <span class="glossary-saved-indicator" id="glossary-saved-indicator"></span>
      </div>
    `;

    editor.querySelectorAll('.glossary-term-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        glossary.terms.splice(idx, 1);
        renderTerms();
      });
    });

    editor.querySelector('#glossary-save-btn').addEventListener('click', onSave);
  }

  function collectTerms() {
    const rows = editor.querySelectorAll('.glossary-term-row');
    return Array.from(rows).map((row) => {
      const term = row.querySelector('[data-field="term"]').value.trim();
      const aliasesRaw = row.querySelector('[data-field="aliases"]').value.trim();
      const aliases = aliasesRaw ? aliasesRaw.split(',').map((a) => a.trim()).filter(Boolean) : [];
      return { term, aliases };
    }).filter((t) => t.term);
  }

  async function onSave() {
    const terms = collectTerms();
    try {
      const indicator = editor.querySelector('#glossary-saved-indicator');
      if (indicator) indicator.textContent = 'Guardando...';
      const result = await api.updateGlossary(subjectId, terms);
      glossary = result || { terms };
      toast('success', 'Glosario guardado', 'Los términos se actualizaron correctamente.');
      renderTerms();
    } catch (err) {
      toast('error', 'Error al guardar', err.message);
    }
  }

  container.querySelector('#glossary-add-term-btn').addEventListener('click', () => {
    glossary.terms.push({ term: '', aliases: [] });
    renderTerms();
    const lastInput = editor.querySelector('.glossary-term-row:last-child [data-field="term"]');
    if (lastInput) setTimeout(() => lastInput.focus(), 50);
  });

  try {
    glossary = await api.getGlossary(subjectId);
    glossary = glossary || { terms: [] };
  } catch {
    glossary = { terms: [] };
  }
  renderTerms();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
