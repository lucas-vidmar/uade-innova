/* ============================================================
   Teacher Upload Materials — 4-tab upload panel (Core of Option B)
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { createFileUpload } from '../../components/FileUpload.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';
import { processingNotifications } from '../../services/processing-notifications.js';

const MATERIAL_TABS = [
  { type: 'transcript', icon: '📝', label: 'Transcripción' },
  { type: 'presentation', icon: '📊', label: 'Presentación' },
  { type: 'notes', icon: '📓', label: 'Apuntes' },
  { type: 'bibliography', icon: '📚', label: 'Bibliografía' },
];

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m];
  });
}

export async function renderTeacherUpload(container) {
  renderHeader('Cargar Materiales');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando clases...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  const classes = await api.getClasses(activeSubjectId);

  // By default, select the first valid class or nothing
  let selectedClassIds = classes.length > 0 ? [classes[0].id] : [];
  let activeTab = 'transcript';
  let isMasterSource = false;
  const activeSubjectIdSafe = activeSubjectId;

  // #390: reparto del lote por encuentro. Cuando hay más de un encuentro destino,
  // cada pieza espera a que quien enseña le asigne el suyo antes de subirse; el
  // destino dejó de ser "todas las clases seleccionadas" y pasó a ser un dato por
  // archivo. Con un solo encuentro no hay nada que repartir y la carga sigue directa.
  let piezasDelLote = [];             // [{ key, fileObj, rawFile, destinoId, error }]
  let subiendoLote = false;
  const destinosDelLote = new Map();  // key → classId

  const claveDePieza = (rawFile) => `${rawFile.name}|${rawFile.size}|${rawFile.lastModified || 0}`;

  // Stored-summary cache for the AI-validation preview (#333): classId ->
  // { status: 'loading' | 'ready' | 'error', text: string }. Fetched once per
  // class so the preview shows the real stored summary, never a placeholder.
  let summaryCache = {};

  const ensureStoredSummary = (classId) => {
    if (!classId || summaryCache[classId]) return;
    summaryCache[classId] = { status: 'loading', text: '' };
    api.getClassSummary(classId, activeSubjectIdSafe).then(data => {
      const raw = data?.summary?.content || data?.summary || '';
      summaryCache[classId] = { status: 'ready', text: typeof raw === 'string' ? raw : '' };
      if (selectedClassIds[0] === classId) render();
    }).catch(() => {
      summaryCache[classId] = { status: 'error', text: '' };
      if (selectedClassIds[0] === classId) render();
    });
  };

  const unsubscribeProcessing = processingNotifications.subscribe((event) => {
    if (!event || event.type !== 'material-status-terminal') return;
    if (event.subjectId !== activeSubjectIdSafe) return;

    const nextStatus = event.terminal === 'ready' ? 'ready' : 'error';
    const targetClasses = Array.isArray(event.classIds) && event.classIds.length > 0
      ? event.classIds
      : classes.map((cls) => cls.id);

    let didMutate = false;

    targetClasses.forEach((classId) => {
      const cls = classes.find((item) => item.id === classId);
      if (!cls || !Array.isArray(cls.materials)) return;

      cls.materials = cls.materials.map((material) => {
        if ((material.id || material.materialId) !== event.materialId) return material;
        didMutate = true;
        return {
          ...material,
          status: nextStatus,
          processedAt: new Date().toISOString(),
        };
      });
    });

    if (didMutate) {
      render();
    }
  });

  const teardown = () => {
    unsubscribeProcessing();
    window.removeEventListener('hashchange', teardown);
  };

  window.addEventListener('hashchange', teardown, { once: true });

  const renderStoredSummaryPreview = (primaryClass) => {
    if (!primaryClass) return '';
    ensureStoredSummary(primaryClass.id);
    const state = summaryCache[primaryClass.id];
    if (!state || state.status === 'loading') {
      return `<div class="ai-summary-box" aria-live="polite"><span class="animate-pulse">Cargando resumen almacenado…</span></div>`;
    }
    if (state.status === 'ready' && state.text) {
      const preview = state.text.length > 1500 ? `${state.text.slice(0, 1500)}…` : state.text;
      return `<div class="ai-summary-box">
        <strong>Resumen de ${escapeHtml(primaryClass.title)}:</strong>
        <br/><br/>
        <span style="white-space:pre-wrap">${escapeHtml(preview)}</span>
      </div>`;
    }
    return `<div class="ai-summary-box">No se pudo cargar el resumen almacenado de esta clase. Probá actualizar con el botón de refresco.</div>`;
  };

  const render = () => {
    // Info preview for the FIRST selected class just as visual feedback
    const primaryClass = selectedClassIds.length > 0 ? classes.find(c => c.id === selectedClassIds[0]) : null;
    const selectedClasses = classes.filter(c => selectedClassIds.includes(c.id));

    console.log('[UploadMaterials] Rendering with selectedClassIds:', selectedClassIds);

    container.innerHTML = `
      <!-- Class selector -->
      <div class="upload-header card" style="margin-bottom:var(--space-6)">
        <div class="upload-header-inner" style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex: 1">
            <h2 style="font-size:var(--font-size-xl);margin-bottom:var(--space-2)">📤 Carga de Materiales de Clase</h2>
            <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">Seleccioná una clase y cargá los materiales correspondientes. El pipeline de IA los procesará automáticamente.</p>
          </div>
          <button class="btn btn-ghost p-2" id="btn-refresh-classes" title="Actualizar datos desde el servidor">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:block"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.83 6.72 2.25L21 8M21 3v5h-5"/></svg>
          </button>
        </div>

        <div class="form-group" style="margin-top:var(--space-5)">
          <label class="form-label">Clases destino (podés seleccionar múltiples)</label>
          <div class="class-multiselect" style="display:flex; flex-direction:column; gap:var(--space-2); max-height:200px; overflow-y:auto; background:var(--color-bg-secondary); border:1px solid var(--color-border); border-radius:8px; padding:var(--space-3)">
            ${classes.length === 0 ? `<div style="color:var(--color-text-muted)">No hay clases creadas. Ve al Gestor de Clases primero.</div>` : ''}
            ${classes.map(c => `
              <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                <input type="checkbox" class="class-checkbox" value="${c.id}" ${selectedClassIds.includes(c.id) ? 'checked' : ''} />
                <span>${escapeHtml(c.title)} <span style="color:var(--color-text-muted); font-size:12px;">— ${c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : 'Sin fecha'}</span></span>
              </label>
            `).join('')}
          </div>
        </div>

        ${primaryClass ? `
          <div class="selection-status-bar ${selectedClassIds.length === 0 ? 'status-error' : ''}">
            <div class="status-info">
              <span class="status-icon">${selectedClassIds.length > 0 ? '📍' : '⚠️'}</span>
              <span class="status-text">
                ${selectedClassIds.length > 0 
                  ? `Subiendo a <strong>${selectedClassIds.length}</strong> ${selectedClassIds.length === 1 ? 'clase' : 'clases'}: 
                     <span class="selected-names">${selectedClasses.map(c => c.title).join(', ')}</span>`
                  : '<strong>No seleccionaste ninguna clase.</strong> Seleccioná al menos una para subir materiales.'
                }
              </span>
            </div>
            ${selectedClassIds.length > 1 ? `
            <div class="selection-hint" style="font-size:var(--font-size-xs);color:var(--color-text-secondary);margin-top:var(--space-2)">
              Con varios encuentros seleccionados el reparto se hace <strong>por pieza</strong>: cada archivo elige su encuentro antes de subirse.
            </div>` : ''}
          </div>
        ` : ''}
      </div>

      <!-- Tabs + upload zones -->
      <div class="card">
        <div class="tabs" style="margin-bottom:var(--space-6)" id="material-tabs">
          ${MATERIAL_TABS.map(tab => `
            <button class="tab-btn ${activeTab === tab.type ? 'active' : ''}" data-tab="${tab.type}">
              ${tab.icon} ${tab.label}
            </button>
          `).join('')}
        </div>

        <div id="upload-zone-wrapper"></div>

        ${piezasDelLote.length > 0 ? `
        <div class="lote-reparto card" id="lote-reparto" style="margin-top:var(--space-5);padding:var(--space-4);border:1px solid var(--color-border);border-radius:8px">
          <h3 class="h5" style="margin-bottom:var(--space-2)">📦 Reparto del lote por encuentro</h3>
          <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-3)">
            Ninguna pieza se subió todavía. Elegí a qué encuentro va cada una y recién después confirmá el lote.
          </p>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="text-align:left;font-size:var(--font-size-xs);color:var(--color-text-muted)">
                <th style="padding:4px 0">Archivo</th>
                <th style="padding:4px 0">Encuentro destino</th>
              </tr>
            </thead>
            <tbody>
              ${piezasDelLote.map((pieza, i) => `
                <tr data-lote-index="${i}">
                  <td style="padding:6px 0">${escapeHtml(pieza.fileObj.filename)}</td>
                  <td style="padding:6px 0">
                    <select class="form-input lote-destino" data-lote-index="${i}" aria-label="Encuentro destino de ${escapeHtml(pieza.fileObj.filename)}">
                      <option value="">— Sin asignar —</option>
                      ${selectedClasses.map(c => `<option value="${escapeHtml(c.id)}" ${pieza.destinoId === c.id ? 'selected' : ''}>${escapeHtml(c.title)}</option>`).join('')}
                    </select>
                    ${pieza.error ? `<div class="lote-error" role="alert" style="color:var(--color-danger,#b3261e);font-size:var(--font-size-xs);margin-top:4px">${escapeHtml(pieza.error)}</div>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div style="display:flex;gap:var(--space-3);margin-top:var(--space-4)">
            <button class="btn btn-primary" id="lote-confirmar" type="button" ${subiendoLote ? 'disabled' : ''}>
              ${subiendoLote ? 'Subiendo el lote…' : `Confirmar y subir el lote (${piezasDelLote.length})`}
            </button>
            <button class="btn btn-ghost" id="lote-descartar" type="button" ${subiendoLote ? 'disabled' : ''}>Descartar el reparto</button>
          </div>
        </div>
        ` : ''}

        ${activeTab === 'bibliography' ? `
        <div style="margin-top:var(--space-4);padding:var(--space-4);background:var(--surface-2);border-radius:var(--radius-md)">
          <label style="display:flex;align-items:center;gap:var(--space-3);cursor:pointer">
            <input type="checkbox" id="master-source-toggle" ${isMasterSource ? 'checked' : ''} />
            <div>
              <div style="font-weight:600">Marcar como Fuente Maestra</div>
              <div style="font-size:var(--fs-sm);color:var(--color-text-secondary)">Las fuentes maestras tienen prioridad en las respuestas del chat</div>
            </div>
          </label>
        </div>
        ` : ''}

        <!-- AI Validation section (only for classes with summaries) -->
        ${primaryClass?.summaryReady ? `
          <div class="divider"></div>
          <div class="ai-validation-section">
            <h3 style="margin-bottom:var(--space-4)">🤖 Validación de Resumen IA</h3>
            <div class="ai-summary-preview">
              <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);line-height:1.7">
                Este es el resumen almacenado actualmente para esta clase. Podés aprobarlo, editarlo o rechazarlo para regenerarlo.
              </p>
              ${renderStoredSummaryPreview(primaryClass)}
              <div class="ai-validation-actions">
                <button class="btn btn-primary" id="approve-summary">✅ Aprobar resumen</button>
                <button class="btn btn-secondary" id="edit-summary">✏️ Editar</button>
                <button class="btn btn-danger" id="reject-summary">🔄 Regenerar</button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Mount upload zone for active tab
    mountUploadZone(primaryClass);

    // Events
    container.querySelectorAll('.class-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedClassIds.push(e.target.value);
        } else {
          selectedClassIds = selectedClassIds.filter(id => id !== e.target.value);
        }
        render(); // Re-render to update the info strip
      });
    });

    // #390: reparto del lote por encuentro.
    container.querySelectorAll('.lote-destino').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = Number(e.target.dataset.loteIndex);
        const pieza = piezasDelLote[idx];
        if (!pieza) return;
        pieza.destinoId = e.target.value || null;
        destinosDelLote.set(pieza.key, pieza.destinoId);
        pieza.error = null;
        const error = e.target.closest('td')?.querySelector('.lote-error');
        if (error) error.remove();
      });
    });

    container.querySelector('#lote-descartar')?.addEventListener('click', () => {
      if (subiendoLote) return;
      piezasDelLote = [];
      destinosDelLote.clear();
      render();
    });

    container.querySelector('#lote-confirmar')?.addEventListener('click', () => {
      confirmarLote();
    });

    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        isMasterSource = false;
        render();
      });
    });

    container.querySelector('#master-source-toggle')?.addEventListener('change', (e) => {
      isMasterSource = e.target.checked;
    });

    document.getElementById('approve-summary')?.addEventListener('click', async () => {
      if (!primaryClass) return;
      const { createSummaryReviewModal } = await import('../../components/SummaryReviewModal.js');
      createSummaryReviewModal(primaryClass.id, primaryClass.title, activeSubjectIdSafe, () => {
        render();
      });
    });
    document.getElementById('edit-summary')?.addEventListener('click', async () => {
      if (!primaryClass) return;
      const { createSummaryReviewModal } = await import('../../components/SummaryReviewModal.js');
      createSummaryReviewModal(primaryClass.id, primaryClass.title, activeSubjectIdSafe, () => {
        render();
      });
    });
    document.getElementById('reject-summary')?.addEventListener('click', async () => {
      if (!primaryClass) return;
      const { createSummaryReviewModal } = await import('../../components/SummaryReviewModal.js');
      createSummaryReviewModal(primaryClass.id, primaryClass.title, activeSubjectIdSafe, () => {
        render();
      });
    });

    document.getElementById('btn-refresh-classes')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-refresh-classes');
      btn.classList.add('animate-spin');
      try {
        const freshClasses = await api.getClasses(activeSubjectId, true); // true for skipCache
        // Update local classes array in place
        classes.splice(0, classes.length, ...freshClasses);
        summaryCache = {};
        toast('success', 'Datos actualizados', 'Se sincronizaron las clases y materiales con el servidor.');
        render();
      } catch (err) {
        toast('error', 'Error al refrescar', err.message);
      } finally {
        btn.classList.remove('animate-spin');
      }
    });
  };

  // #390: subir el lote confirmado. Cada pieza viaja con su propio encuentro: se
  // abandonó el envío de todas las clases seleccionadas en cada archivo, que dejaba
  // el material del encuentro 6 respondiendo en el encuentro 5.
  const confirmarLote = async () => {
    if (subiendoLote) return;

    const sinDestino = piezasDelLote.filter(pieza => !pieza.destinoId);
    if (sinDestino.length > 0) {
      piezasDelLote.forEach(pieza => {
        pieza.error = pieza.destinoId ? null : 'Falta elegir el encuentro de esta pieza.';
      });
      render();
      toast('error', 'Reparto incompleto', `Quedaron ${sinDestino.length} pieza(s) sin encuentro. Asigná cada una antes de confirmar.`);
      return;
    }

    subiendoLote = true;
    render();

    const fallidas = [];
    let subidas = 0;

    for (const pieza of piezasDelLote) {
      const destinoId = pieza.destinoId;
      const formData = new FormData();
      formData.append('file', pieza.rawFile);
      formData.append('subjectId', activeSubjectIdSafe);
      formData.append('materialType', activeTab);
      if (isMasterSource) formData.append('materialPriority', 'primary');
      formData.append('classIds', destinoId);   // una sola pieza → un solo encuentro

      try {
        const response = await api.ingestMaterial(formData);
        subidas += 1;

        const cls = classes.find(c => c.id === destinoId);
        if (cls) {
          if (!Array.isArray(cls.materials)) cls.materials = [];
          cls.materials.push({
            ...pieza.fileObj,
            status: response?.status || 'processing',
            id: response.materialId,
            classIds: [destinoId],
            uploadedAt: new Date().toISOString(),
          });
        }

        if (response?.materialId) {
          processingNotifications.trackJob({
            materialId: response.materialId,
            subjectId: activeSubjectIdSafe,
            classIds: [destinoId],
            filename: pieza.fileObj.filename,
          });
        }
      } catch (error) {
        const motivo = error?.message ? error.message.replace(/\s*\.\s*$/, '') : 'error de red';
        fallidas.push({
          ...pieza,
          error: `No se pudo subir: ${motivo}. Volvé a intentar.`,
        });
      }
    }

    // Las que fallaron se quedan a la vista con su motivo y su destino, listas para
    // reintentar; ninguna se pierde en silencio (#386).
    piezasDelLote = fallidas;
    subiendoLote = false;
    render();

    if (fallidas.length === 0) {
      toast('success', 'Lote encolado', `Se subieron ${subidas} pieza(s), cada una en el encuentro que le asignaste.`);
    } else {
      toast('error', 'Parte del lote no se subió', `${fallidas.length} pieza(s) quedaron sin subir. Revisá el motivo y reintentá.`);
    }
  };

  const mountUploadZone = (selectedClass) => {
    const wrapper = document.getElementById('upload-zone-wrapper');
    if (!wrapper) return;
    // #390 (detalle): con varios encuentros seleccionados la lista de "ya cargados"
    // era la de la clase primaria y no representaba a las demás. Ahora es la unión,
    // sin repetir el mismo material.
    const clasesDelDestino = selectedClassIds.length > 0
      ? classes.filter(c => selectedClassIds.includes(c.id))
      : (selectedClass ? [selectedClass] : []);
    const vistos = new Set();
    const existingFiles = [];
    for (const cls of clasesDelDestino) {
      for (const material of (cls.materials || [])) {
        if (material.type !== activeTab) continue;
        const id = material.id || material.materialId;
        if (id && vistos.has(id)) continue;
        if (id) vistos.add(id);
        existingFiles.push(material);
      }
    }

    const uploader = createFileUpload({
      type: activeTab,
      existingFiles,
      // Con más de un encuentro destino la pieza no se sube al elegirla: espera en el
      // reparto del lote hasta que se le asigne su encuentro y se confirme (#390).
      stageFile: selectedClassIds.length > 1
        ? (fileObj, rawFile) => {
            const key = claveDePieza(rawFile);
            if (piezasDelLote.some(pieza => pieza.key === key)) return;
            piezasDelLote.push({ key, fileObj, rawFile, destinoId: null, error: null });
            render();
          }
        : null,
      onUpload: async (fileObj, rawFile, updateProgress) => {
        if (selectedClassIds.length === 0) {
          toast('error', 'Error', 'Debe seleccionar al menos una clase antes de subir el material.');
          updateProgress(0);
          throw new Error('No class selected');
        }

        console.log('[UploadMaterials] Starting upload for file:', rawFile.name, 'Target classes:', selectedClassIds);

        // Perform real API upload
        const formData = new FormData();
        formData.append('file', rawFile);
        formData.append('subjectId', activeSubjectId);
        formData.append('materialType', activeTab);

        if (isMasterSource) formData.append('materialPriority', 'primary');

        // Append all selected class IDs
        selectedClassIds.forEach(id => formData.append('classIds', id));

        try {
          const response = await api.ingestMaterial(formData);
          console.log('[UploadMaterials] Upload response:', response);
          updateProgress(100);

          // Update frontend state for all selected classes
          selectedClassIds.forEach(cid => {
            const cls = classes.find(c => c.id === cid);
            if (cls) {
              // Ensure we don't add duplicate material if it's already there
              const existingIdx = cls.materials.findIndex(m => m.id === response.materialId);
              const materialData = {
                ...fileObj,
                status: response?.status || 'processing',
                id: response.materialId || `m-new-${Date.now()}`,
                classIds: [...selectedClassIds],
                uploadedAt: new Date().toISOString()
              };
              
              if (existingIdx >= 0) {
                cls.materials[existingIdx] = materialData;
              } else {
                cls.materials.push(materialData);
              }
            }
          });

          console.log('[UploadMaterials] Local state updated. Re-rendering...');
          render();

          if (response?.materialId && (response?.status || 'processing') === 'processing') {
            processingNotifications.trackJob({
              materialId: response.materialId,
              subjectId: activeSubjectId,
              classIds: [...selectedClassIds],
              filename: rawFile.name,
            });
          }
        } catch (error) {
          throw error; // Let FileUpload catch and show error toast
        }
      },
    });
    wrapper.innerHTML = '';
    wrapper.appendChild(uploader);
  };

  render();
}
