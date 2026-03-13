/* ============================================================
   Teacher Upload Materials — 4-tab upload panel (Core of Option B)
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { createFileUpload } from '../../components/FileUpload.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

const MATERIAL_TABS = [
  { type: 'transcript', icon: '📝', label: 'Transcripción' },
  { type: 'presentation', icon: '📊', label: 'Presentación' },
  { type: 'notes', icon: '📓', label: 'Apuntes' },
  { type: 'bibliography', icon: '📚', label: 'Bibliografía' },
];

export async function renderTeacherUpload(container) {
  renderHeader('Cargar Materiales');
  container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--color-text-secondary)" class="animate-pulse">Cargando clases...</div>`;

  const user = auth.getUser();
  const activeSubjectId = auth.getActiveSubjectId();
  const classes = await api.getClasses(activeSubjectId);

  // By default, select the first valid class or nothing
  let selectedClassIds = classes.length > 0 ? [classes[0].id] : [];
  let activeTab = 'transcript';

  const render = () => {
    // Info preview for the FIRST selected class just as visual feedback
    const primaryClass = selectedClassIds.length > 0 ? classes.find(c => c.id === selectedClassIds[0]) : null;

    container.innerHTML = `
      <!-- Class selector -->
      <div class="upload-header card" style="margin-bottom:var(--space-6)">
        <div class="upload-header-inner">
          <div>
            <h2 style="font-size:var(--font-size-xl);margin-bottom:var(--space-2)">📤 Carga de Materiales de Clase</h2>
            <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">Seleccioná una clase y cargá los materiales correspondientes. El pipeline de IA los procesará automáticamente.</p>
          </div>
        </div>

        <div class="form-group" style="margin-top:var(--space-5)">
          <label class="form-label">Clases destino (podés seleccionar múltiples)</label>
          <div class="class-multiselect" style="display:flex; flex-direction:column; gap:var(--space-2); max-height:200px; overflow-y:auto; background:var(--color-bg-secondary); border:1px solid var(--color-border); border-radius:8px; padding:var(--space-3)">
            ${classes.length === 0 ? `<div style="color:var(--color-text-muted)">No hay clases creadas. Ve al Gestor de Clases primero.</div>` : ''}
            ${classes.map(c => `
              <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                <input type="checkbox" class="class-checkbox" value="${c.id}" ${selectedClassIds.includes(c.id) ? 'checked' : ''} />
                <span>${c.title} <span style="color:var(--color-text-muted); font-size:12px;">— ${new Date(c.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</span></span>
              </label>
            `).join('')}
          </div>
        </div>

        ${primaryClass ? `
          <div class="class-info-strip">
            <span class="badge ${primaryClass.summaryReady ? 'badge-success' : primaryClass.materials.length > 0 ? 'badge-warning' : 'badge-neutral'}">
              ${primaryClass.summaryReady ? '✅ Material de la primer clase completo' : primaryClass.materials.length > 0 ? '⚙️ Procesando material' : '📭 Sin material en esta clase'}
            </span>
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
        render();
      });
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

        // Perform real API upload
        const formData = new FormData();
        formData.append('file', rawFile);
        formData.append('subjectId', activeSubjectId);
        formData.append('materialType', activeTab);

        // Append all selected class IDs
        selectedClassIds.forEach(id => formData.append('classIds', id));

        try {
          const response = await api.ingestMaterial(formData);
          updateProgress(100);

          // Update frontend state for all selected classes
          selectedClassIds.forEach(cid => {
            const cls = classes.find(c => c.id === cid);
            if (cls) {
              // Ensure we don't add duplicate material if it's already there
              const existingIdx = cls.materials.findIndex(m => m.id === response.materialId);
              const materialData = {
                ...fileObj,
                status: 'ready',
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
