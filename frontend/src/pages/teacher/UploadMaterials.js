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
                La IA generó el siguiente resumen basado en los materiales cargados para esta clase. Podés aprobarlo, editarlo o rechazarlo para regenerarlo.
              </p>
              <div class="ai-summary-box">
                <strong>Resumen de ${primaryClass.title}:</strong>
                <br/><br/>
                Esta clase introdujo los fundamentos de las <strong>arquitecturas de software</strong>, cubriendo los principales estilos arquitectónicos (monolítico, en capas, microservicios, event-driven) y sus atributos de calidad (disponibilidad, escalabilidad, mantenibilidad, seguridad). Se discutieron los trade-offs entre acoplamiento y cohesión, y se presentó el modelo C4 como herramienta de documentación arquitectónica.
              </div>
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

    document.getElementById('approve-summary')?.addEventListener('click', () => {
      toast('success', '¡Resumen aprobado!', 'El resumen está ahora visible para los alumnos.');
    });
    document.getElementById('edit-summary')?.addEventListener('click', () => {
      toast('info', 'Edición', 'Editor de resumen — funcionalidad completa en la siguiente iteración.');
    });
    document.getElementById('reject-summary')?.addEventListener('click', () => {
      toast('warning', 'Regenerando...', 'La IA generará un nuevo resumen en unos momentos.');
    });

    document.getElementById('btn-refresh-classes')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-refresh-classes');
      btn.classList.add('animate-spin');
      try {
        const freshClasses = await api.getClasses(activeSubjectId, true); // true for skipCache
        // Update local classes array in place
        classes.splice(0, classes.length, ...freshClasses);
        toast('success', 'Datos actualizados', 'Se sincronizaron las clases y materiales con el servidor.');
        render();
      } catch (err) {
        toast('error', 'Error al refrescar', err.message);
      } finally {
        btn.classList.remove('animate-spin');
      }
    });
  };

  const mountUploadZone = (selectedClass) => {
    const wrapper = document.getElementById('upload-zone-wrapper');
    if (!wrapper) return;
    const existingFiles = selectedClass?.materials.filter(m => m.type === activeTab) || [];
    const uploader = createFileUpload({
      type: activeTab,
      existingFiles,
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

          if (response?.fallback) {
            toast('warning', 'Modo local activo', `"${rawFile.name}" quedó en estado local de procesamiento. El backend de ingesta no está disponible en este entorno.`);
          }

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
