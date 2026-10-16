import { api } from '../services/api.js';
import { toast } from './Toast.js';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { extractMermaidCode } from '@shared/extract-mermaid.js';

const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
});

export function createSummaryReviewModal(classId, className, subjectId, onSaved) {
    if (document.querySelector('.modal-overlay')) return;

    let activeTab = 'summary';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    modal.innerHTML = `
        <div class="modal-content" style="max-width:min(95vw,1400px); width:95%; max-height:90vh; display:flex; flex-direction:column;">
            <div class="modal-header" style="flex-wrap:wrap; gap:8px;">
                <h3 class="modal-title" style="flex:1 1 100%; margin-bottom:4px;">Revisar Contenido IA: ${className}</h3>
                <div class="tab-bar" style="display:flex; gap:2px; width:100%;">
                    <button class="tab-btn tab-btn-summary active" data-tab="summary" style="flex:1; padding:8px 12px; border:none; background:var(--color-bg-alt); border-radius:var(--radius-md) var(--radius-md) 0 0; cursor:pointer; font-weight:600; font-size:0.85rem; color:var(--color-text-secondary); transition:all 0.15s;">📝 Resumen</button>
                    <button class="tab-btn tab-btn-map" data-tab="map" style="flex:1; padding:8px 12px; border:none; background:transparent; border-radius:var(--radius-md) var(--radius-md) 0 0; cursor:pointer; font-weight:500; font-size:0.85rem; color:var(--color-text-muted); transition:all 0.15s;">🗺️ Mapa Conceptual</button>
                    <button class="tab-btn tab-btn-podcast" data-tab="podcast" style="flex:1; padding:8px 12px; border:none; background:transparent; border-radius:var(--radius-md) var(--radius-md) 0 0; cursor:pointer; font-weight:500; font-size:0.85rem; color:var(--color-text-muted); transition:all 0.15s;">🎧 Podcast</button>
                    <button class="btn-close" style="align-self:flex-start; margin-top:4px;">&times;</button>
                </div>
            </div>
            <div class="modal-body">
                <div class="loading-summary" style="padding:40px; text-align:center;">Cargando activos...</div>

                <div id="tab-summary" style="display:none">
                    <div class="editor-wrapper">
                        <span class="section-label">📝 Resumen Detallado</span>
                        <div class="editor-toolbar">
                            <button data-cmd="bold" title="Negrita (Ctrl+B)" tabindex="-1"><b>B</b></button>
                            <button data-cmd="italic" title="Cursiva (Ctrl+I)" tabindex="-1"><i>I</i></button>
                            <span class="sep"></span>
                            <button data-cmd="h2" title="Título" tabindex="-1" style="width:auto;padding:0 8px;font-weight:700;font-size:0.9rem">H2</button>
                            <button data-cmd="h3" title="Subtítulo" tabindex="-1" style="width:auto;padding:0 8px;font-weight:600;font-size:0.85rem">H3</button>
                            <span class="sep"></span>
                            <button data-cmd="insertUnorderedList" title="Lista con viñetas" tabindex="-1" style="width:auto;padding:0 8px">&#8226;</button>
                            <button data-cmd="insertOrderedList" title="Lista numerada" tabindex="-1" style="width:auto;padding:0 8px">1.</button>
                            <span class="sep"></span>
                            <button data-cmd="source" title="Ver / editar código fuente" tabindex="-1" style="width:auto;padding:0 8px;font-family:var(--font-mono);font-size:0.8rem">&lt;/&gt;</button>
                        </div>
                        <div id="summary-editor" class="editor-content" contenteditable="true"></div>
                        <textarea id="summary-source" class="form-input" style="display:none;height:250px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:15px;border-radius:0 0 var(--radius-md) var(--radius-md);border-top:none;"></textarea>
                    </div>
                </div>

                <div id="tab-map" style="display:none">
                    <div class="editor-wrapper">
                        <span class="section-label">🗺️ Mapa Conceptual</span>
                        <textarea id="map-editor" class="form-input" style="height:130px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:12px 15px;border-radius:var(--radius-md);margin-bottom:6px;" placeholder="graph TD..."></textarea>
                        <div class="map-preview" id="map-preview"><span class="preview-placeholder">Vista previa del diagrama</span></div>
                    </div>
                </div>

                <div id="tab-podcast" style="display:none">
                    <div class="editor-wrapper">
                        <span class="section-label">🎧 Guión de Podcast</span>
                        <p style="margin:0 0 8px; color:var(--color-text-secondary); font-size:0.8rem;">
                            Este guión se genera automáticamente desde el resumen. Revisalo, editálo y aprobalo para generar el audio con TTS.
                        </p>
                        <textarea id="podcast-editor" class="form-input" style="height:280px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:12px 15px;border-radius:var(--radius-md);resize:vertical;" placeholder="Guión de podcast..."></textarea>
                        <div id="podcast-status" style="margin-top:8px; font-size:0.8rem; color:var(--color-text-muted);"></div>
                    </div>
                </div>
            </div>
            <div class="modal-footer" style="justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <button class="btn btn-ghost" id="btn-regenerate" style="color:var(--color-primary)">🔄 Regenerar con IA</button>
                <div class="row" style="gap:8px; flex-wrap:wrap;">
                    <button class="btn btn-ghost" id="btn-not-suitable" title="Marcá este resumen como no apto y escribí el contenido manualmente" style="color:var(--color-error)">🚫 No apto — escribir manualmente</button>
                    <button class="btn btn-secondary" id="btn-save-draft">Guardar Borrador</button>
                    <button class="btn btn-primary" id="btn-approve-summary">Aprobar y Publicar</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const loading = modal.querySelector('.loading-summary');
    const tabSummary = modal.querySelector('#tab-summary');
    const tabMap = modal.querySelector('#tab-map');
    const tabPodcast = modal.querySelector('#tab-podcast');

    const summaryEditor = modal.querySelector('#summary-editor');
    const summarySource = modal.querySelector('#summary-source');
    const mapEditor = modal.querySelector('#map-editor');
    const mapPreview = modal.querySelector('#map-preview');
    const podcastEditor = modal.querySelector('#podcast-editor');
    const podcastStatus = modal.querySelector('#podcast-status');

    const btnApprove = modal.querySelector('#btn-approve-summary');
    const btnSaveDraft = modal.querySelector('#btn-save-draft');
    const btnRegenerate = modal.querySelector('#btn-regenerate');
    const btnNotSuitable = modal.querySelector('#btn-not-suitable');

    let showSource = false;

    function switchTab(tab) {
        activeTab = tab;
        modal.querySelectorAll('.tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tab;
            btn.style.background = isActive ? 'var(--color-bg-alt)' : 'transparent';
            btn.style.fontWeight = isActive ? '600' : '500';
            btn.style.color = isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)';
        });
        tabSummary.style.display = tab === 'summary' ? 'block' : 'none';
        tabMap.style.display = tab === 'map' ? 'block' : 'none';
        tabPodcast.style.display = tab === 'podcast' ? 'block' : 'none';
    }

    modal.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const toolbarBtns = modal.querySelectorAll('.editor-toolbar button[data-cmd]');
    toolbarBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const cmd = btn.getAttribute('data-cmd');
            if (cmd === 'source') {
                toggleSource();
                return;
            }
            if (showSource) return;
            summaryEditor.focus();
            document.execCommand(cmd, false, null);
        });
    });

    summaryEditor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
        }
    });

    function getSummaryValue() {
        if (showSource) {
            return summarySource.value;
        }
        const html = summaryEditor.innerHTML;
        const markdown = turndown.turndown(html);
        return markdown || '';
    }

    function setSummaryValue(markdown) {
        if (!markdown) {
            summaryEditor.innerHTML = '';
            summarySource.value = '';
            return;
        }
        const html = marked.parse(markdown, { async: false });
        summaryEditor.innerHTML = html;
        summarySource.value = markdown;
    }

    function toggleSource() {
        showSource = !showSource;
        if (showSource) {
            summarySource.value = getSummaryValue();
            summaryEditor.style.display = 'none';
            summarySource.style.display = 'block';
            toolbarBtns.forEach(b => {
                if (b.getAttribute('data-cmd') === 'source') b.classList.add('active');
            });
        } else {
            setSummaryValue(summarySource.value);
            summaryEditor.style.display = 'block';
            summarySource.style.display = 'none';
            toolbarBtns.forEach(b => {
                if (b.getAttribute('data-cmd') === 'source') b.classList.remove('active');
            });
        }
    }

    let mapZoom = 1;
    let mapControls = null;

    function renderMap() {
        const code = extractMermaidCode(mapEditor.value);
        mapPreview.innerHTML = '';
        if (mapControls) { mapControls.remove(); mapControls = null; }
        if (!code) {
            mapPreview.innerHTML = '<span class="preview-placeholder">Vista previa del diagrama</span>';
            return;
        }
        const zoomContainer = document.createElement('div');
        zoomContainer.className = 'map-zoom-container';
        zoomContainer.id = 'map-zoom-container';
        const pre = document.createElement('pre');
        pre.className = 'mermaid';
        pre.textContent = code;
        zoomContainer.appendChild(pre);
        mapPreview.appendChild(zoomContainer);

        mapControls = document.createElement('div');
        mapControls.className = 'map-controls';
        mapControls.innerHTML = `
            <button data-zoom="out" title="Alejar">−</button>
            <button data-zoom="in" title="Acercar">+</button>
            <button data-zoom="reset" title="Restablecer">⟲</button>
            <span class="map-zoom-label">100%</span>
        `;
        mapPreview.after(mapControls);

        mapControls.querySelector('[data-zoom="in"]').onclick = () => setZoom(mapZoom + 0.25);
        mapControls.querySelector('[data-zoom="out"]').onclick = () => setZoom(Math.max(0.25, mapZoom - 0.25));
        mapControls.querySelector('[data-zoom="reset"]').onclick = () => setZoom(1);

        try {
            if (typeof mermaid !== 'undefined') {
                mermaid.run({ nodes: [pre] }).catch(() => {
                    mapPreview.innerHTML = '<span class="preview-placeholder">Error al renderizar el diagrama</span>';
                    if (mapControls) { mapControls.remove(); mapControls = null; }
                });
            }
        } catch (e) {
            mapPreview.innerHTML = '<span class="preview-placeholder">Error al renderizar el diagrama</span>';
            if (mapControls) { mapControls.remove(); mapControls = null; }
        }
    }

    function setZoom(level) {
        mapZoom = Math.max(0.25, Math.min(10, level));
        const zc = document.getElementById('map-zoom-container');
        if (zc) zc.style.transform = `scale(${mapZoom})`;
        if (mapControls) {
            const label = mapControls.querySelector('.map-zoom-label');
            if (label) label.textContent = Math.round(mapZoom * 100) + '%';
        }
    }

    let renderTimer;
    mapEditor.addEventListener('input', () => {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderMap, 500);
    });

    Promise.all([
        api.getClassSummary(classId, subjectId),
        api.getClassMap(classId, subjectId),
        api.getClassAudioScript(classId, subjectId),
    ]).then(([summaryData, mapData, audioScriptData]) => {
        loading.style.display = 'none';
        switchTab('summary');

        if (summaryData && summaryData.summary) {
            const md = typeof summaryData.summary === 'object' ? summaryData.summary.content : summaryData.summary;
            setSummaryValue(md);
        } else {
            setSummaryValue('');
        }

        if (mapData && mapData.mapCode) {
            mapEditor.value = mapData.mapCode;
            renderMap();
        } else {
            mapEditor.value = '';
        }

        if (audioScriptData && audioScriptData.script) {
            podcastEditor.value = audioScriptData.script;
            const stat = audioScriptData.validated
                ? (audioScriptData.ttsGeneratedAt ? '✅ Audio generado' : '✅ Guión validado — audio pendiente')
                : '📝 Borrador — revisar antes de aprobar';
            podcastStatus.textContent = `Estado: ${stat}`;
        } else {
            podcastEditor.value = '';
            podcastStatus.textContent = 'Estado: Sin guión generado';
        }
    }).catch(err => {
        console.error('Error loading class assets:', err);
        toast('error', 'Error', 'No se pudieron cargar los activos de la clase.');
        modal.remove();
    });

    const close = () => {
        modal.remove();
    };
    modal.querySelector('.btn-close').onclick = close;

    const save = async (validated, opts = {}) => {
        try {
            btnApprove.disabled = true;
            btnSaveDraft.disabled = true;
            btnRegenerate.disabled = true;
            if (btnNotSuitable) btnNotSuitable.disabled = true;

            const promises = [
                api.saveClassSummary(classId, {
                    subjectId,
                    summary: getSummaryValue(),
                    validated,
                    summarySource: opts.summarySource,
                    suitable: opts.suitable,
                }),
                api.saveClassMap ? api.saveClassMap(classId, { subjectId, mapCode: mapEditor.value, validated }) : Promise.resolve()
            ];

            const podcastScript = podcastEditor.value.trim();
            if (podcastScript) {
                promises.push(api.saveClassAudioScript(classId, {
                    subjectId,
                    script: podcastScript,
                    validated
                }));
            }

            await Promise.all(promises);
            if (opts.summarySource === 'manual') {
                toast('success', 'Resumen marcado como no apto', 'El contenido quedó marcado como escrito manualmente por el docente.');
            } else {
                toast('success', validated ? 'Publicado' : 'Guardado', validated ? 'El contenido ya es visible para los alumnos.' : 'Cambios guardados como borrador.');
            }
            onSaved(validated);
            close();
        } catch (e) {
            toast('error', 'Error', 'No se pudo guardar el contenido.');
        } finally {
            btnApprove.disabled = false;
            btnSaveDraft.disabled = false;
            btnRegenerate.disabled = false;
            if (btnNotSuitable) btnNotSuitable.disabled = false;
        }
    };

    btnApprove.onclick = () => save(true);
    btnSaveDraft.onclick = () => save(false);

    if (btnNotSuitable) {
        btnNotSuitable.onclick = () => {
            if (!confirm('¿Marcar este resumen como no apto? El contenido pasará a ser editado manualmente por vos y la IA quedará descartada para esta clase.')) return;
            save(false, { summarySource: 'manual', suitable: false });
        };
    }

    btnRegenerate.onclick = async () => {
        btnRegenerate.disabled = true;
        btnRegenerate.textContent = '🔄 Regenerando...';
        try {
            if (activeTab === 'podcast') {
                const result = await api.generateClassAudioScript(classId, subjectId);
                if (result.script) {
                    podcastEditor.value = result.script;
                    podcastStatus.textContent = 'Estado: 📝 Regenerado — revisar antes de aprobar';
                }
                toast('success', 'Regenerado', 'Guión de podcast regenerado con IA.');
            } else {
                const result = await api.generateClassAssets(classId, subjectId, { rejected: true });
                if (result.summary?.summary) {
                    const md = typeof result.summary.summary === 'object' ? result.summary.summary.content : result.summary.summary;
                    setSummaryValue(md);
                }
                if (result.map?.mapCode) {
                    mapEditor.value = result.map.mapCode;
                    renderMap();
                }
                toast('success', 'Regenerado', 'Resumen y mapa conceptual regenerados con IA.');

                const scriptData = await api.getClassAudioScript(classId, subjectId);
                if (scriptData && scriptData.script) {
                    podcastEditor.value = scriptData.script;
                    podcastStatus.textContent = 'Estado: 📝 Regenerado — revisar antes de aprobar';
                }
            }
        } catch (e) {
            toast('error', 'Error', e.message || 'No se pudieron regenerar los activos.');
        } finally {
            btnRegenerate.disabled = false;
            btnRegenerate.textContent = '🔄 Regenerar con IA';
        }
    };
}
