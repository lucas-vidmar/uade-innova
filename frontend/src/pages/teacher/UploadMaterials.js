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
  const classes = await api.getClasses(user.subjectId);

  // Read ?class= from hash
  const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  let selectedClassId = hashParams.get('class') || classes[0]?.id || '';
  let activeTab = 'transcript';

  const render = () => {
    const selectedClass = classes.find(c => c.id === selectedClassId);

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
          <label class="form-label" for="class-selector">Clase objetivo</label>
          <select class="form-select" id="class-selector" style="max-width:520px">
            ${classes.map(c => `<option value="${c.id}" ${c.id === selectedClassId ? 'selected' : ''}>${c.title} — ${new Date(c.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}</option>`).join('')}
          </select>
        </div>

        ${selectedClass ? `
          <div class="class-info-strip">
            <div class="class-info-topics">
              ${selectedClass.topics.map(t => `<span class="chip selected">${t}</span>`).join('')}
            </div>
            <span class="badge ${selectedClass.summaryReady ? 'badge-success' : selectedClass.materials.length > 0 ? 'badge-warning' : 'badge-neutral'}">
              ${selectedClass.summaryReady ? '✅ Material completo' : selectedClass.materials.length > 0 ? '⚙️ Procesando' : '📭 Sin material'}
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
        ${selectedClass?.summaryReady ? `
          <div class="divider"></div>
          <div class="ai-validation-section">
            <h3 style="margin-bottom:var(--space-4)">🤖 Validación de Resumen IA</h3>
            <div class="ai-summary-preview">
              <p style="color:var(--color-text-secondary);font-size:var(--font-size-sm);line-height:1.7">
                La IA generó el siguiente resumen basado en los materiales cargados para esta clase. Podés aprobarlo, editarlo o rechazarlo para regenerarlo.
              </p>
              <div class="ai-summary-box">
                <strong>Resumen de ${selectedClass.title}:</strong>
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
    mountUploadZone(selectedClass);

    // Events
    document.getElementById('class-selector')?.addEventListener('change', e => {
      selectedClassId = e.target.value;
      render();
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
        // Perform real API upload
        const formData = new FormData();
        formData.append('file', rawFile);
        formData.append('classId', selectedClassId);
        formData.append('subjectId', user.subjectId || 'arq-software-2026');
        formData.append('materialType', activeTab);

        try {
          const response = await api.ingestMaterial(formData);
          updateProgress(100);

          // Update frontend state
          if (selectedClass) {
            const cls = classes.find(c => c.id === selectedClassId);
            if (cls) {
              cls.materials.push({
                ...fileObj,
                status: 'ready',
                id: response.materialId || `m-new-${Date.now()}`,
                classId: selectedClassId
              });
            }
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
