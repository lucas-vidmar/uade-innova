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
    <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);margin-bottom:var(--space-5);flex-wrap:wrap">
      <div>
        <h1 class="h2" style="margin:0">Glosario de Términos</h1>
        <p style="margin:var(--space-1) 0 0;color:var(--color-text-secondary);font-size:var(--font-size-sm)">Términos técnicos para corrección automática de transcripciones</p>
      </div>
      <button class="btn btn-primary" id="glossary-add-term-btn">+ Agregar Término</button>
    </div>
    <div class="card" id="glossary-editor" style="padding:0;overflow:hidden">
      <div class="glossary-loading" style="padding:var(--space-8);text-align:center;color:var(--color-text-secondary)">Cargando glosario...</div>
    </div>
  `;

  const editor = container.querySelector('#glossary-editor');
  let glossary = { terms: [] };

  function renderTerms() {
    const terms = glossary.terms || [];
    if (terms.length === 0) {
      editor.innerHTML = `
        <div class="empty-state" style="padding:var(--space-8)">
          <div class="empty-state-icon">📖</div>
          <h3>Sin términos aún</h3>
          <p style="font-size:var(--font-size-sm)">Agregá términos técnicos para que el sistema detecte errores en las transcripciones automáticamente.</p>
        </div>
      `;
      return;
    }

    editor.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:var(--font-size-sm)">
          <thead>
            <tr style="border-bottom:1px solid var(--color-border)">
              <th style="padding:var(--space-3) var(--space-4);text-align:left;font-size:var(--font-size-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);width:40%">Término</th>
              <th style="padding:var(--space-3) var(--space-4);text-align:left;font-size:var(--font-size-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);width:50%">Aliases</th>
              <th style="padding:var(--space-3) var(--space-4);width:10%;min-width:50px"></th>
            </tr>
          </thead>
          <tbody>
            ${terms.map((t, i) => `
              <tr class="glossary-term-row" data-index="${i}" style="border-bottom:1px solid var(--color-border)">
                <td style="padding:var(--space-2) var(--space-4)">
                  <input type="text" class="form-input" value="${escapeHtml(t.term)}" data-field="term" style="height:34px;font-size:var(--font-size-sm)" placeholder="Término" />
                </td>
                <td style="padding:var(--space-2) var(--space-4)">
                  <input type="text" class="form-input" value="${escapeHtml((t.aliases || []).join(', '))}" data-field="aliases" style="height:34px;font-size:var(--font-size-sm)" placeholder="alias1, alias2" />
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
        <span id="glossary-saved-indicator" style="font-size:var(--font-size-xs);color:var(--color-text-muted)"></span>
        <button class="btn btn-primary btn-sm" id="glossary-save-btn">Guardar Glosario</button>
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
