/* ============================================================
   FileUpload — Drag & drop with progress, type icons, status
   ============================================================ */
import { toast } from './Toast.js';
import { api } from '../services/api.js';
import { showConfirmDialog } from './Dialog.js';
import { uploadDrafts } from '../services/upload-drafts.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// La lista de formatos de cada tipo debe coincidir con la validación del
// servidor (backend/src/functions/ingest-material.js, FILE_TYPE_VARIANTS):
// si acá se promete un formato que el servidor rechaza, la carga falla con un
// mensaje que no explica nada (#385).
const TYPE_CONFIG = {
  transcript: { label: 'Transcripción', icon: '📝', accept: '.txt,.docx,.vtt,.srt,.pdf', hint: 'TXT, DOCX, VTT, SRT o PDF' },
  presentation: { label: 'Presentación', icon: '📊', accept: '.pptx,.pdf', hint: 'PPTX o PDF' },
  notes: { label: 'Apuntes', icon: '📓', accept: '.docx,.pdf,.txt', hint: 'DOCX, PDF o TXT' },
  bibliography: { label: 'Bibliografía', icon: '📚', accept: '.pdf,.docx,.txt', hint: 'PDF, DOCX o TXT' },
};

const STATUS_CONFIG = {
  pending: { label: 'Pendiente', badge: 'badge-neutral', icon: '⏳' },
  processing: {
    label: 'Procesando',
    badge: 'badge-warning',
    icon: '⚙️',
    tip: 'Extrayendo texto y vectorizando para el chat...'
  },
  ready: { label: 'Listo', badge: 'badge-success', icon: '✅' },
  error: { label: 'Error', badge: 'badge-error', icon: '❌' },
};

// #392: el alta tarda minutos (el caso reportado tardó 119 s). Sin un plazo
// visible el docente no distingue "está procesando" de "se colgó".
export const PROCESSING_HINT = 'puede tardar unos minutos';

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

export function createFileUpload({
  type = 'transcript',
  onUpload,
  existingFiles = [],
  stageFile = null,
  uploadContext = null,
  destinoLabel = '',
}) {
  const cfg = TYPE_CONFIG[type];
  const container = document.createElement('div');
  container.className = 'file-upload-container';

  let files = [...existingFiles];
  let elapsedTimer = null;
  // Piezas elegidas en ESTA carga (no las que ya venían del servidor). El flag
  // `_new` viaja también en los materiales espejados del servidor, así que no
  // alcanza para distinguir "elegido ahora" de "ya existía".
  const piezasNuevas = new Set();

  const hasPendingWork = () => files.some((f) => f.status === 'processing');

  // #392: el avance del procesamiento es real (lo sondea processingNotifications);
  // lo único que hace falta es refrescar el tiempo transcurrido para que el
  // "Procesando" no sea un cartel mudo.
  const startElapsedTimer = () => {
    if (elapsedTimer) return;
    elapsedTimer = setInterval(() => {
      if (!container.isConnected) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
        return;
      }
      if (!hasPendingWork()) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
        return;
      }
      render();
    }, 1000);
  };

  const render = () => {
    const repeatedNames = new Set();
    const seenNames = new Set();
    files.forEach((f) => {
      const key = normalizeName(f.filename || f.name);
      if (!key) return;
      if (seenNames.has(key)) repeatedNames.add(key);
      seenNames.add(key);
    });

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
          ${files.map((f, i) => renderFileItem(f, i, repeatedNames)).join('')}
        </div>
      ` : ''}
    `;
    bindEvents();
    if (hasPendingWork()) startElapsedTimer();
  };

  const renderFileItem = (f, i, repeatedNames) => {
    const statusCfg = STATUS_CONFIG[f.status] || STATUS_CONFIG.pending;
    const name = f.filename || f.name;
    // #392: con varias copias del mismo nombre la lista obligaba a adivinar
    // cuál era cuál; cada repetida lleva su índice visible.
    const repeated = repeatedNames.has(normalizeName(name));
    // `_uploading`: el POST todavía está en vuelo (el servidor aún no confirmó el
    // alta). No cambia el badge —eso lo cubre el sondeo de processingNotifications—
    // pero sí la sub-línea, que pasa de un "subiendo" honesto a un plazo real.
    const subiendo = f._uploading === true;
    const isProcessing = f.status === 'processing';

    let hint = '';
    if (subiendo) {
      hint = `<div class="file-item-hint">Subiendo al servidor…</div>`;
    } else if (isProcessing) {
      const since = f._startedAt || (f.uploadedAt ? new Date(f.uploadedAt).getTime() : null);
      const elapsed = since ? ` hace ${formatElapsed(Date.now() - since)}` : '';
      hint = `<div class="file-item-hint">Procesando${elapsed} · ${PROCESSING_HINT}</div>`;
    }

    return `
      <div class="file-item" data-index="${i}">
        <div class="file-item-icon">${cfg.icon}</div>
        <div class="file-item-info">
          <div class="file-item-name">${name}${repeated ? ` <span class="file-item-tag">#${i + 1}</span>` : ''}</div>
          <div class="file-item-meta">${f.mimeType || f.type || ''}</div>
          ${subiendo ? `
            <div class="progress-bar" style="margin-top:6px">
              <div class="progress-fill animate-pulse" style="--progress-value:100%"></div>
            </div>
          ` : ''}
          ${hint}
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
          piezasNuevas.delete(fileObj);
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

  // #392: la misma pieza ya cargada (en el servidor o elegida en esta misma
  // carga) dejaba de ser invisible y se subía dos veces sin aviso.
  const findDuplicate = (rawFile) => {
    const name = normalizeName(rawFile.name);
    const size = rawFile.size;
    const matches = (candidate) => {
      if (!candidate) return false;
      if (normalizeName(candidate.filename || candidate.name) !== name) return false;
      const candidateSize = candidate.size ?? candidate.fileSize ?? null;
      return candidateSize == null || size == null || candidateSize === size;
    };
    return {
      enServidor: existingFiles.some(matches),
      enEstaCarga: files.some((f) => piezasNuevas.has(f) && matches(f)),
    };
  };

  const confirmDuplicate = async (rawFile, dup) => {
    const donde = dup.enEstaCarga
      ? `Ya elegiste "${rawFile.name}" en esta misma carga.`
      : `Ya hay un material con el nombre "${rawFile.name}"${destinoLabel ? ` en ${destinoLabel}` : ''}.`;
    return showConfirmDialog({
      title: 'Material duplicado',
      message: `${donde} Si lo cargás otra vez vas a tener dos copias del mismo material, indistinguibles en la lista.`,
      confirmText: 'Cargar igual',
      cancelText: 'Cancelar',
      danger: false,
    });
  };

  const handleFiles = async (rawFiles) => {
    for (const file of rawFiles) {
      if (file.size > MAX_FILE_SIZE) {
        toast('error', 'Archivo demasiado grande', `"${file.name}" supera el límite de 10MB.`);
        continue;
      }

      const dup = findDuplicate(file);
      if (dup.enServidor || dup.enEstaCarga) {
        const seguir = await confirmDuplicate(file, dup);
        if (!seguir) continue;
      }

      const fileObj = {
        _new: true,
        filename: file.name,
        mimeType: file.type,
        status: 'processing',
        type,
        _progress: 0,
        _startedAt: Date.now(),
        _file: file,
      };

      // #390: cuando quien enseña carga un lote para varios encuentros, la pieza
      // no se sube sola: queda en manos de la pantalla que la llamó para que le
      // asigne su encuentro antes de confirmar (el destino dejó de ser el conjunto
      // de clases seleccionadas y pasó a ser un dato por archivo).
      if (typeof stageFile === 'function') {
        fileObj.status = 'pending';
        files.push(fileObj);
        piezasNuevas.add(fileObj);
        render();
        try {
          await stageFile(fileObj, file);
        } catch (error) {
          fileObj.status = 'error';
          render();
          const details = error instanceof Error && error.message ? ` (${error.message})` : '';
          toast('error', 'Error al preparar el lote', `No se pudo dejar "${file.name}" listo para repartir${details}.`);
        }
        continue;
      }

      const pieza = {
        subjectId: uploadContext?.subjectId || null,
        type,
        filename: file.name,
        size: file.size,
      };

      fileObj._uploading = true;
      files.push(fileObj);
      piezasNuevas.add(fileObj);
      // #392: el borrador persistido es lo que permite avisar de una carga
      // interrumpida (refresco a mitad de camino) y frenar el cierre accidental.
      uploadDrafts.begin(pieza);
      render();

      try {
        const formData = new FormData();
        formData.append('file', file);

        // Allow the onUpload callback to provide classId and subjectId and do the upload or we can do it here.
        // Wait, it's better to delegate the actual upload to the caller `onUploadFile` so FileUpload remains reusable.

        await onUpload?.(fileObj, file, (progressValue) => {
          fileObj._progress = progressValue;
          render();
        });

        fileObj._uploading = false;
        fileObj.status = 'processing';
        fileObj._progress = 100;
        fileObj._startedAt = Date.now();
        // El servidor confirmó el alta: recién ahora el borrador deja de ser
        // necesario. Si falla (o si la página se va a mitad de camino), el
        // borrador queda y el próximo arranque avisa que la carga no llegó.
        uploadDrafts.clear(pieza);
        render();
        toast('info', 'Procesando archivo', `"${file.name}" se subió y está siendo analizado por la IA en segundo plano.`);
      } catch (error) {
        fileObj._uploading = false;
        fileObj.status = 'error';
        fileObj._progress = 0;
        render();
        const details = error instanceof Error && error.message ? ` (${error.message})` : '';
        toast('error', 'Error al procesar', `Hubo un problema subiendo "${file.name}"${details}.`);
      }
    }
  };

  render();
  return container;
}
