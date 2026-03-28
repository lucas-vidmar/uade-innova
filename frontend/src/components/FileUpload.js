/* ============================================================
   FileUpload — Drag & drop with progress, type icons, status
   ============================================================ */
import { toast } from './Toast.js';
import { api } from '../services/api.js';
import { showConfirmDialog } from './Dialog.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const TYPE_CONFIG = {
  transcript: { label: 'Transcripción', icon: '📝', accept: '.txt,.docx,.vtt,.pdf', hint: 'TXT, DOCX, VTT o PDF' },
  presentation: { label: 'Presentación', icon: '📊', accept: '.pptx,.pdf', hint: 'PPTX o PDF' },
  notes: { label: 'Apuntes', icon: '📓', accept: '.docx,.pdf,.txt', hint: 'DOCX, PDF o TXT' },
  bibliography: { label: 'Bibliografía', icon: '📚', accept: '.pdf,.docx,.txt', hint: 'PDF, DOCX o TXT' },
};

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', badge: 'badge-neutral', icon: '⏳' },
  processing: { label: 'Procesando', badge: 'badge-warning', icon: '⚙️' },
  ready: { label: 'Listo', badge: 'badge-success', icon: '✅' },
  error: { label: 'Error', badge: 'badge-error', icon: '❌' },
};

export function createFileUpload({ type = 'transcript', onUpload, existingFiles = [] }) {
  const cfg = TYPE_CONFIG[type];
  const container = document.createElement('div');
  container.className = 'file-upload-container';

  let files = [...existingFiles];

  const render = () => {
    container.innerHTML = `
      <div class="file-drop-zone" id="drop-zone-${type}" tabindex="0" role="button" aria-label="Zona de carga de ${cfg.label}">
        <input type="file" id="file-input-${type}" accept="${cfg.accept}" multiple class="file-input-hidden" />
        <div class="file-drop-icon">${cfg.icon}</div>
        <div class="file-drop-title">Arrastrá tu <strong>${cfg.label}</strong> aquí</div>
        <div class="file-drop-sub">Formatos: <span class="file-drop-badge">${cfg.hint}</span> • <span class="file-drop-badge">Máx 10MB</span></div>
        <button class="btn btn-secondary btn-sm" id="file-browse-${type}" type="button">Buscar archivo</button>
      </div>

      ${files.length > 0 ? `
        <div class="file-list" id="file-list-${type}">
          ${files.map((f, i) => renderFileItem(f, i)).join('')}
        </div>
      ` : ''}
    `;
    bindEvents();
  };

  const renderFileItem = (f, i) => {
    const statusCfg = STATUS_CONFIG[f.status] || STATUS_CONFIG.pending;
    const isNew = f._new;
    return `
      <div class="file-item" data-index="${i}">
        <div class="file-item-icon">${cfg.icon}</div>
        <div class="file-item-info">
          <div class="file-item-name">${f.filename || f.name}</div>
          <div class="file-item-meta">${f.mimeType || f.type || ''}</div>
          ${isNew && f.status === 'processing' ? `
            <div class="progress-bar" style="margin-top:6px">
              <div class="progress-fill" style="--progress-value:${f._progress || 0}%"></div>
            </div>
          ` : ''}
        </div>
        <span class="badge ${statusCfg.badge}">
          ${statusCfg.icon} ${statusCfg.label}
        </span>
        <button class="btn btn-icon btn-ghost btn-sm file-remove" data-index="${i}" type="button" title="Eliminar">✕</button>
      </div>
    `;
  };

  const bindEvents = () => {
    const dropZone = container.querySelector(`#drop-zone-${type}`);
    const fileInput = container.querySelector(`#file-input-${type}`);
    const browseBtn = container.querySelector(`#file-browse-${type}`);

    browseBtn?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('keydown', e => e.key === 'Enter' && fileInput.click());

    dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone?.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });

    fileInput?.addEventListener('change', () => handleFiles(fileInput.files));

    container.querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index);
        const fileObj = files[idx];

        if (fileObj._new) {
          files.splice(idx, 1);
          render();
        } else {
          const shouldDelete = await showConfirmDialog({
            title: 'Eliminar material',
            message: `Eliminar definitivamente el material "${fileObj.filename}"?`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            danger: true,
          });
          if (!shouldDelete) return;

          try {
            await api.deleteMaterial(fileObj.id);
            files.splice(idx, 1);
            render();
            toast('success', 'Eliminado', 'El material fue borrado correctamente.');
          } catch (e) {
            toast('error', 'Error', 'No se pudo eliminar el archivo.');
          }
        }
      });
    });
  };

  const handleFiles = async (rawFiles) => {
    for (const file of rawFiles) {
      if (file.size > MAX_FILE_SIZE) {
        toast('error', 'Archivo demasiado grande', `"${file.name}" supera el límite de 10MB.`);
        continue;
      }

      const fileObj = {
        _new: true,
        filename: file.name,
        mimeType: file.type,
        status: 'processing',
        type,
        _progress: 0,
        _file: file,
      };
      files.push(fileObj);
      render();

      // Animate progress to show it's working
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress >= 90) progress = 90;
        const idx = files.indexOf(fileObj);
        fileObj._progress = progress;
        const progressFill = container.querySelector(`.file-item[data-index="${idx}"] .progress-fill`);
        if (progressFill) progressFill.style.setProperty('--progress-value', `${progress}%`);
      }, 300);

      try {
        const formData = new FormData();
        formData.append('file', file);

        // Allow the onUpload callback to provide classId and subjectId and do the upload or we can do it here.
        // Wait, it's better to delegate the actual upload to the caller `onUploadFile` so FileUpload remains reusable.

        await onUpload?.(fileObj, file, (progressValue) => {
          clearInterval(interval);
          fileObj._progress = progressValue;
          render();
        });

        clearInterval(interval);
        fileObj.status = 'processing';
        fileObj._progress = 100;
        render();
        toast('info', 'Procesando archivo', `"${file.name}" se subió y está siendo analizado por la IA en segundo plano.`);
      } catch (error) {
        clearInterval(interval);
        fileObj.status = 'error';
        fileObj._progress = 0;
        render();
        toast('error', 'Error al procesar', `Hubo un problema subiendo "${file.name}".`);
      }
    }
  };

  render();
  return container;
}
