import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { extractMermaidCode } from '@shared/extract-mermaid.js';

const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
});

export async function renderClassEditor(container) {
    const hash = window.location.hash || '';
    const parts = hash.split('/');
    const classId = parts[parts.length - 1];
    const subjectId = auth.getActiveSubjectId();
    // Guard-aware back navigation (#340): the editor is shared by the
    // teacher (/teacher/class) and director (/director/class) routes.
    const backHash = auth.getRole() === 'director' ? '#/director/classes' : '#/teacher/classes';

    if (!classId || !subjectId) {
        window.location.hash = backHash;
        return;
    }

    renderHeader('Editor de Clase');
    container.innerHTML = `<div class="page-loading animate-pulse" style="padding:60px;text-align:center;color:var(--color-text-secondary)">Cargando editor de clase...</div>`;

    try {
        const [classesData, summaryData, mapData, audioScriptData] = await Promise.all([
            api.getClasses(subjectId),
            api.getClassSummary(classId, subjectId),
            api.getClassMap(classId, subjectId),
            api.getClassAudioScript(classId, subjectId),
        ]);

        const classInfo = classesData.find(c => c.id === classId);
        if (!classInfo) {
            container.innerHTML = `<div class="empty-state" style="padding:40px">Clase no encontrada.</div>`;
            return;
        }

        let activeTab = 'summary';
        let showSource = false;
        let mapZoom = 1;
        let mapControls = null;
        let loadingSection = null;
        let mapRenderId = 0;

        const sectionsEnabled = classInfo.sectionsEnabled || { summary: true, map: true, podcast: true };
        let dirty = false;
        // #428: el estado de publicación es un dato único y explícito. La clase y
        // cada derivado lo comparten, así que lo que el docente ve acá es exactamente
        // lo que el alumnado puede abrir.
        let publicationState = classInfo.publicationState
            || (classInfo.summaryReady ? 'publicado' : 'borrador');
        let publicationChangedBy = classInfo.publicationChangedBy || '';
        let publicationChangedAt = classInfo.publicationChangedAt || '';
        let publicationHistory = Array.isArray(summaryData?.publicationHistory) ? summaryData.publicationHistory : [];
        const derivedStates = {
            summary: summaryData?.publicationState || publicationState,
            map: mapData?.publicationState || publicationState,
            podcast: audioScriptData?.publicationState || publicationState,
        };

        const rawSummary = summaryData?.summary?.content || summaryData?.summary || '';
        const initialMapCode = extractMermaidCode(mapData?.mapCode);
        const initialPodcast = audioScriptData?.script || '';
        let podcastValidated = audioScriptData?.validated || false;
        let podcastTtsGenerated = audioScriptData?.ttsGeneratedAt || false;

        // ── Local state: preserva cambios entre tabs ──────────────
        const localState = {
            summary: rawSummary,
            map: initialMapCode,
            podcast: initialPodcast,
        };

        function saveCurrentTabToLocal() {
            const el = getEditorElement(activeTab);
            if (!el) return;
            const val = getEditorValue(activeTab, el);
            localState[activeTab] = val;
        }

        function getEditorElement(tab) {
            if (tab === 'summary') return document.getElementById('summary-editor');
            if (tab === 'map') return document.getElementById('map-editor');
            if (tab === 'podcast') return document.getElementById('podcast-editor');
            return null;
        }

        function getEditorValue(tab, el) {
            if (!el) return '';
            if (tab === 'summary') {
                if (showSource) {
                    const source = document.getElementById('summary-source');
                    return source ? source.value : '';
                }
                const html = el.innerHTML;
                return turndown.turndown(html) || '';
            }
            return el.value || '';
        }

        function setEditorValue(tab, val) {
            if (tab === 'summary') {
                const editor = document.getElementById('summary-editor');
                const source = document.getElementById('summary-source');
                if (editor && source) {
                    if (showSource) {
                        source.value = val;
                    } else {
                        editor.innerHTML = val ? marked.parse(val, { async: false }) : '';
                        source.value = val;
                    }
                }
            } else if (tab === 'map') {
                const el = document.getElementById('map-editor');
                if (el) el.value = val || '';
            } else if (tab === 'podcast') {
                const el = document.getElementById('podcast-editor');
                if (el) el.value = val || '';
            }
        }

        function toggleSection(section) {
            sectionsEnabled[section] = !sectionsEnabled[section];
            render();
        }

        // ── Render map preview (accesible desde render() y attachEvents()) ──
        async function renderMapPreview() {
            const id = ++mapRenderId;
            await new Promise(r => setTimeout(r, 0)); // yield to DOM
            if (id !== mapRenderId) return; // stale call
            const preview = document.getElementById('map-preview');
            if (!preview) return;
            const el = document.getElementById('map-editor');
            const code = extractMermaidCode(el?.value || '');
            preview.innerHTML = '';
            if (mapControls) { mapControls.remove(); mapControls = null; }
            if (!code) {
                preview.innerHTML = '<span class="preview-placeholder">Vista previa del diagrama</span>';
                return;
            }
            const zoomContainer = document.createElement('div');
            zoomContainer.className = 'map-zoom-container';
            zoomContainer.id = 'map-zoom-container';
            preview.appendChild(zoomContainer);

            mapControls = document.createElement('div');
            mapControls.className = 'map-controls';
            mapControls.innerHTML = `
                <button data-zoom="out" title="Alejar">−</button>
                <button data-zoom="in" title="Acercar">+</button>
                <button data-zoom="reset" title="Restablecer">⟲</button>
                <span class="map-zoom-label">100%</span>
            `;
            preview.after(mapControls);

            mapControls.querySelector('[data-zoom="in"]').onclick = () => setMapZoom(mapZoom + 0.25);
            mapControls.querySelector('[data-zoom="out"]').onclick = () => setMapZoom(Math.max(0.25, mapZoom - 0.25));
            mapControls.querySelector('[data-zoom="reset"]').onclick = () => setMapZoom(1);

            if (typeof mermaid !== 'undefined') {
                try {
                    const { svg } = await mermaid.render('map-render-' + Date.now(), code);
                    zoomContainer.innerHTML = svg;
                    const svgEl = zoomContainer.querySelector('svg');
                    if (svgEl) {
                        svgEl.style.maxWidth = '100%';
                        svgEl.style.height = 'auto';
                    }
                } catch (e) {
                    console.warn('[MapPreview] render error:', e?.message?.substring(0, 100));
                    preview.innerHTML = '<span class="preview-placeholder">Error al renderizar el diagrama</span>';
                    if (mapControls) { mapControls.remove(); mapControls = null; }
                }
            }
        }

        function setMapZoom(level) {
            mapZoom = Math.max(0.25, Math.min(10, level));
            const zc = document.getElementById('map-zoom-container');
            if (zc) zc.style.transform = `scale(${mapZoom})`;
            if (mapControls) {
                const label = mapControls.querySelector('.map-zoom-label');
                if (label) label.textContent = Math.round(mapZoom * 100) + '%';
            }
        }

        function render() {
            container.innerHTML = `
                <div class="page-container" style="max-width:1200px; margin:0 auto;">
                    <div style="margin-bottom:var(--space-4);">
                        <a href="${backHash}" class="btn btn-ghost btn-sm" style="padding:4px 8px; margin-bottom:4px;">← Volver</a>
                        <h2 class="h3" style="margin:4px 0 0;">${classInfo.title}</h2>
                        <div style="display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap;">
                            <span style="font-size:0.8rem; color:var(--color-text-secondary);">${classInfo.date || 'Sin fecha'}</span>
                            ${statusBadge()}
                        </div>
                    </div>

                    ${publicationBanner()}

                    <div class="tab-bar" style="display:flex; gap:2px; margin-bottom:var(--space-4); background:var(--color-bg-alt); border-radius:var(--radius-md) var(--radius-md) 0 0; overflow:hidden;">
                        <button class="editor-tab ${activeTab === 'summary' ? 'active' : ''}" data-tab="summary" style="flex:1; padding:12px 16px; border:none; background:${activeTab === 'summary' ? 'var(--color-surface)' : 'transparent'}; cursor:pointer; font-weight:${activeTab === 'summary' ? '700' : '500'}; font-size:0.9rem; color:${activeTab === 'summary' ? 'var(--color-text-primary)' : 'var(--color-text-muted)'}; transition:all 0.15s; border-bottom:${activeTab === 'summary' ? '2px solid var(--color-primary)' : '2px solid transparent'};">
                            📝 Resumen ${sectionsEnabled.summary ? '' : '🚫'}
                        </button>
                        <button class="editor-tab ${activeTab === 'map' ? 'active' : ''}" data-tab="map" style="flex:1; padding:12px 16px; border:none; background:${activeTab === 'map' ? 'var(--color-surface)' : 'transparent'}; cursor:pointer; font-weight:${activeTab === 'map' ? '700' : '500'}; font-size:0.9rem; color:${activeTab === 'map' ? 'var(--color-text-primary)' : 'var(--color-text-muted)'}; transition:all 0.15s; border-bottom:${activeTab === 'map' ? '2px solid var(--color-primary)' : '2px solid transparent'};">
                            🗺️ Mapa Conceptual ${sectionsEnabled.map ? '' : '🚫'}
                        </button>
                        <button class="editor-tab ${activeTab === 'podcast' ? 'active' : ''}" data-tab="podcast" style="flex:1; padding:12px 16px; border:none; background:${activeTab === 'podcast' ? 'var(--color-surface)' : 'transparent'}; cursor:pointer; font-weight:${activeTab === 'podcast' ? '700' : '500'}; font-size:0.9rem; color:${activeTab === 'podcast' ? 'var(--color-text-primary)' : 'var(--color-text-muted)'}; transition:all 0.15s; border-bottom:${activeTab === 'podcast' ? '2px solid var(--color-primary)' : '2px solid transparent'};">
                            🎧 Podcast ${sectionsEnabled.podcast ? '' : '🚫'}
                        </button>
                    </div>

                    <div id="editor-content">
                        ${activeTab === 'summary' ? renderSummaryTab() : ''}
                        ${activeTab === 'map' ? renderMapTab() : ''}
                        ${activeTab === 'podcast' ? renderPodcastTab() : ''}
                    </div>

                    <div style="display:flex; justify-content:flex-end; align-items:center; margin-top:var(--space-8); padding-top:var(--space-6); border-top:1px solid var(--color-border); gap:12px; flex-wrap:wrap;">
                        ${publicationState === 'publicado' ? '<button class="btn btn-ghost" id="btn-publish-now" title="Volver a disparar el aviso de resumen publicado a los alumnos (útil para clases pasadas)" style="color:var(--color-primary)">📣 Reenviar aviso</button>' : ''}
                        <button class="btn btn-ghost" id="btn-send-review" title="Marca el contenido como listo para que lo avale quien corresponda">🕒 Enviar a revisión</button>
                        <button class="btn btn-ghost" id="btn-retract" title="Retira la clase de la unidad sin borrar el contenido">⏪ Pasar a borrador</button>
                        <button class="btn btn-secondary" id="btn-save-draft" title="Guarda el contenido sin cambiar la visibilidad">Guardar cambios</button>
                        <button class="btn btn-primary" id="btn-approve">✅ Aprobar y Publicar</button>
                    </div>
                </div>
            `;

            attachEvents();

            if (activeTab === 'map') {
                requestAnimationFrame(() => renderMapPreview().catch(() => {}));
            }
        }

        function setDirty() { dirty = true; render(); }

        const PUBLICATION_LABELS = {
            borrador: '📝 Borrador',
            pendiente_de_aval: '🕒 Pendiente de aval',
            publicado: '✅ Publicado',
        };

        const PUBLICATION_DESCRIPTIONS = {
            borrador: 'No visible para el alumnado.',
            pendiente_de_aval: 'No visible para el alumnado: esperando el aval.',
            publicado: 'Visible para el alumnado de la unidad.',
        };

        function statusBadge() {
            if (dirty) return '<span class="badge badge-error" style="background:var(--color-error);color:white;">⚠️ Cambios no guardados</span>';
            const cls = publicationState === 'publicado' ? 'badge-success' : (publicationState === 'pendiente_de_aval' ? 'badge-info' : 'badge-neutral');
            return `<span class="badge ${cls}" id="publication-state-badge" data-state="${publicationState}">${PUBLICATION_LABELS[publicationState] || publicationState}</span>`;
        }

        function publicationBanner() {
            const when = publicationChangedAt ? new Date(publicationChangedAt).toLocaleString('es-AR') : '';
            const who = publicationChangedBy ? ` por ${publicationChangedBy}` : '';
            const trace = publicationState === 'borrador' && !who ? '' : `${who}${when ? ` el ${when}` : ''}`;
            const latest = publicationHistory.at(-1);
            return `
                <div class="card" id="publication-state-panel" data-state="${publicationState}" style="margin-bottom:var(--space-4);padding:var(--space-3) var(--space-4);border-left:4px solid var(--color-primary);">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                        <div>
                            <strong style="font-size:0.9rem;">Estado de publicación: ${PUBLICATION_LABELS[publicationState] || publicationState}</strong>
                            <p style="margin:4px 0 0;font-size:0.8rem;color:var(--color-text-secondary);">${PUBLICATION_DESCRIPTIONS[publicationState] || ''}${trace ? ` Registrado${trace}.` : ''}</p>
                            ${latest?.reason ? `<p style="margin:4px 0 0;font-size:0.8rem;color:var(--color-text-secondary);">Motivo del último cambio: ${latest.reason}</p>` : ''}
                        </div>
                        <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:var(--color-text-secondary);">
                            Motivo (opcional)
                            <input type="text" id="publication-reason" class="form-input" style="width:220px;font-size:0.8rem;padding:4px 8px;" placeholder="por qué cambia el estado">
                        </label>
                    </div>
                    <p style="margin:8px 0 0;font-size:0.78rem;color:var(--color-text-muted);">
                        Derivados: resumen ${PUBLICATION_LABELS[derivedStates.summary] || derivedStates.summary} · mapa ${PUBLICATION_LABELS[derivedStates.map] || derivedStates.map} · podcast ${PUBLICATION_LABELS[derivedStates.podcast] || derivedStates.podcast}
                    </p>
                </div>
            `;
        }

        function sectionToggleHTML(sectionKey) {
            const on = sectionsEnabled[sectionKey];
            return `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:var(--space-3); padding-bottom:var(--space-3); border-bottom:1px solid var(--color-border);">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem; font-weight:500;">
                        <input type="checkbox" class="section-toggle" data-section="${sectionKey}" ${on ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;">
                        ${on ? '🟢 Visible para alumnos' : '🔴 Oculto para alumnos'}
                    </label>
                    <button class="btn btn-ghost btn-regenerate-section" data-section="${sectionKey}" ${loadingSection === sectionKey ? 'disabled' : ''} style="font-size:0.85rem; padding:4px 10px; border:none; background:none; cursor:pointer; color:var(--color-primary);">
                        ${loadingSection === sectionKey ? '⏳ Regenerando...' : '🔄 Regenerar'}
                    </button>
                </div>
            `;
        }

        function renderSummaryTab() {
            const isLoading = loadingSection === 'summary';
            return `
                <div class="card" style="position:relative;">
                    ${isLoading ? '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.7);z-index:10;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-lg);"><div style="text-align:center;"><div class="animate-pulse" style="font-size:28px;margin-bottom:8px;">🔄</div><p style="font-weight:600;margin:0;font-size:0.9rem;">Regenerando resumen...</p></div></div>' : ''}
                    <div style="padding:var(--space-4);">
                        ${sectionToggleHTML('summary')}
                        <div class="editor-toolbar" style="margin-bottom:0;">
                            <button data-cmd="bold" title="Negrita (Ctrl+B)" tabindex="-1"><b>B</b></button>
                            <button data-cmd="italic" title="Cursiva (Ctrl+I)" tabindex="-1"><i>I</i></button>
                            <span class="sep"></span>
                            <button data-cmd="h1" title="Título 1" tabindex="-1" style="width:auto;padding:0 8px;font-weight:800;font-size:0.95rem">H1</button>
                            <button data-cmd="h2" title="Título 2" tabindex="-1" style="width:auto;padding:0 8px;font-weight:700;font-size:0.9rem">H2</button>
                            <button data-cmd="h3" title="Título 3" tabindex="-1" style="width:auto;padding:0 8px;font-weight:600;font-size:0.85rem">H3</button>
                            <button data-cmd="h4" title="Título 4" tabindex="-1" style="width:auto;padding:0 8px;font-weight:600;font-size:0.8rem">H4</button>
                            <button data-cmd="h5" title="Título 5" tabindex="-1" style="width:auto;padding:0 8px;font-weight:500;font-size:0.75rem">H5</button>
                            <span class="sep"></span>
                            <button data-cmd="insertUnorderedList" title="Lista con viñetas" tabindex="-1" style="width:auto;padding:0 8px">&#8226;</button>
                            <button data-cmd="insertOrderedList" title="Lista numerada" tabindex="-1" style="width:auto;padding:0 8px">1.</button>
                            <span class="sep"></span>
                            <button data-cmd="hr" title="Línea separadora" tabindex="-1" style="width:auto;padding:0 8px">—</button>
                            <button data-cmd="table" title="Insertar tabla" tabindex="-1" style="width:auto;padding:0 8px;font-size:0.85rem">⊞</button>
                            <span class="sep"></span>
                            <button data-cmd="source" title="Ver / editar código fuente" tabindex="-1" style="width:auto;padding:0 8px;font-family:var(--font-mono);font-size:0.8rem">&lt;/&gt;</button>
                        </div>
                        <div id="summary-editor" class="editor-content" contenteditable="true" style="border-radius:0 0 var(--radius-md) var(--radius-md);">${localState.summary ? marked.parse(localState.summary, { async: false }) : ''}</div>
                        <textarea id="summary-source" class="form-input" style="display:none;height:350px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:15px;border-radius:0 0 var(--radius-md) var(--radius-md);border-top:none;">${localState.summary}</textarea>
                    </div>
                </div>
            `;
        }

        function renderMapTab() {
            const isLoading = loadingSection === 'map';
            return `
                <div class="card" style="position:relative;">
                    ${isLoading ? '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.7);z-index:10;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-lg);"><div style="text-align:center;"><div class="animate-pulse" style="font-size:28px;margin-bottom:8px;">🔄</div><p style="font-weight:600;margin:0;font-size:0.9rem;">Regenerando mapa...</p></div></div>' : ''}
                    <div style="padding:var(--space-4);">
                        ${sectionToggleHTML('map')}
                        <textarea id="map-editor" class="form-input" style="height:150px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:12px 15px;border-radius:var(--radius-md);margin-bottom:12px;" placeholder="graph TD...">${localState.map || ''}</textarea>
                        <div class="map-preview" id="map-preview"><span class="preview-placeholder">Vista previa del diagrama</span></div>
                    </div>
                </div>
            `;
        }

        function renderPodcastTab() {
            const isLoading = loadingSection === 'podcast';
            const text = localState.podcast || '';
            return `
                <div class="card" style="position:relative;">
                    ${isLoading ? '<div style="position:absolute;inset:0;background:rgba(255,255,255,0.7);z-index:10;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-lg);"><div style="text-align:center;"><div class="animate-pulse" style="font-size:28px;margin-bottom:8px;">🔄</div><p style="font-weight:600;margin:0;font-size:0.9rem;">Regenerando guión...</p></div></div>' : ''}
                    <div style="padding:var(--space-4);">
                        ${sectionToggleHTML('podcast')}
                        <textarea id="podcast-editor" class="form-input" style="height:350px;font-family:var(--font-mono);font-size:0.875rem;line-height:1.6;padding:12px 15px;border-radius:var(--radius-md);resize:vertical;" placeholder="Guión de podcast...">${text}</textarea>
                    </div>
                </div>
            `;
        }

        function attachEvents() {
            const summaryEditor = document.getElementById('summary-editor');
            const summarySource = document.getElementById('summary-source');
            const mapEditor = document.getElementById('map-editor');
            const mapPreview = document.getElementById('map-preview');
            const podcastEditor = document.getElementById('podcast-editor');
            const btnSaveDraft = document.getElementById('btn-save-draft');
            const btnApprove = document.getElementById('btn-approve');

            // ── Tab switching: save current tab to localState ──
            document.querySelectorAll('.editor-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    saveCurrentTabToLocal();
                    activeTab = btn.dataset.tab;
                    render();
                });
            });

            // ── Section toggles ──
            document.querySelectorAll('.section-toggle').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    sectionsEnabled[e.target.dataset.section] = e.target.checked;
                    setDirty();
                });
            });

            // ── Per-section regenerate ──
            document.querySelectorAll('.btn-regenerate-section').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const section = e.currentTarget.dataset.section;
                    await regenerateSection(section);
                });
            });

            // ── Summary live save on input ──
            if (summaryEditor) {
                summaryEditor.addEventListener('input', () => {
                    const html = summaryEditor.innerHTML;
                    localState.summary = turndown.turndown(html) || '';
                    if (!dirty) { dirty = true; render(); }
                });
                summaryEditor.addEventListener('keydown', (e) => {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
                    }
                });
            }

            // ── Summary toolbar ──
            document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const cmd = btn.getAttribute('data-cmd');
                    if (cmd === 'source') {
                        showSource = !showSource;
                        if (showSource) {
                            summarySource.value = localState.summary;
                            summaryEditor.style.display = 'none';
                            summarySource.style.display = 'block';
                        } else {
                            const html = marked.parse(summarySource.value, { async: false });
                            summaryEditor.innerHTML = html;
                            summaryEditor.style.display = 'block';
                            summarySource.style.display = 'none';
                            localState.summary = summarySource.value;
                        }
                        return;
                    }
                    if (showSource) return;
                    summaryEditor.focus();
                    if (['h1','h2','h3','h4','h5'].includes(cmd)) {
                        document.execCommand('formatBlock', false, `<${cmd}>`);
                    } else if (cmd === 'hr') {
                        document.execCommand('insertHorizontalRule', false, null);
                    } else if (cmd === 'table') {
                        const html = '<table><thead><tr><th>Columna 1</th><th>Columna 2</th></tr></thead><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table>';
                        document.execCommand('insertHTML', false, html);
                    } else {
                        document.execCommand(cmd, false, null);
                    }
                });
            });

            if (summarySource) {
                summarySource.addEventListener('input', () => {
                    localState.summary = summarySource.value;
                    if (!dirty) { dirty = true; render(); }
                });
            }

            // ── Map live save on input ──
            if (mapEditor) {
                mapEditor.addEventListener('input', () => {
                    localState.map = mapEditor.value;
                    clearTimeout(renderTimer);
                    renderTimer = setTimeout(renderMapPreview, 500);
                });
            }

            // ── Podcast live save on input ──
            if (podcastEditor) {
                podcastEditor.addEventListener('input', () => {
                    localState.podcast = podcastEditor.value;
                });
            }

            // ── Map live save + debounced preview ──
            let renderTimer;
            if (mapEditor) {
                mapEditor.addEventListener('input', () => {
                    localState.map = mapEditor.value;
                    if (!dirty) { dirty = true; render(); }
                    clearTimeout(renderTimer);
                    renderTimer = setTimeout(() => renderMapPreview().catch(() => {}), 500);
                });
            }

            // ── Podcast live save on input ──
            if (podcastEditor) {
                podcastEditor.addEventListener('input', () => {
                    localState.podcast = podcastEditor.value;
                    if (!dirty) { dirty = true; render(); }
                });
            }

            const r = document.getElementById('btn-regenerate');
            const s = document.getElementById('btn-save-draft');
            const a = document.getElementById('btn-approve');
            const p = document.getElementById('btn-publish-now');
            const rev = document.getElementById('btn-send-review');
            const ret = document.getElementById('btn-retract');
            // #428: guardar el contenido y cambiar la visibilidad son dos acciones
            // distintas. Antes "Guardar Borrador" retiraba la clase sin decirlo y
            // "Aprobar" la publicaba, con el estado repartido en dos lugares.
            if (s) s.onclick = () => saveContent();
            if (a) a.onclick = () => saveContent({ publicationState: 'publicado' });
            if (rev) rev.onclick = () => changePublicationState('pendiente_de_aval');
            if (ret) ret.onclick = () => changePublicationState('borrador');
            if (p) {
                p.onclick = async () => {
                    p.disabled = true;
                    p.textContent = '📣 Enviando...';
                    try {
                        await api.publishClassSummaryNow(classId, subjectId);
                        toast('success', 'Publicado', 'La notificación del resumen fue enviada a los alumnos.');
                    } catch (e) {
                        toast('error', 'Error', e.message || 'No se pudo publicar ahora.');
                    } finally {
                        p.disabled = false;
                        p.textContent = '📣 Reenviar aviso';
                    }
                };
            }
        }

        function readPublicationReason() {
            const el = document.getElementById('publication-reason');
            return el?.value?.trim() || undefined;
        }

        function applyPublicationResult(result) {
            if (!result) return;
            publicationState = result.publicationState || publicationState;
            publicationChangedBy = result.changedBy || publicationChangedBy;
            publicationChangedAt = result.changedAt || publicationChangedAt;
            if (result.reason || (result.changed && publicationState === 'borrador')) {
                publicationHistory = [...publicationHistory, {
                    from: result.previousState,
                    to: result.publicationState,
                    by: result.changedBy,
                    at: result.changedAt,
                    reason: result.reason,
                }].slice(-20);
            }
            // La clase y sus derivados comparten el estado: el servidor los escribió juntos.
            derivedStates.summary = publicationState;
            derivedStates.map = publicationState;
            derivedStates.podcast = publicationState;
            podcastValidated = publicationState === 'publicado';
        }

        async function changePublicationState(state) {
            const buttons = ['btn-approve', 'btn-save-draft', 'btn-send-review', 'btn-retract']
                .map((id) => document.getElementById(id)).filter(Boolean);
            buttons.forEach((b) => { b.disabled = true; });
            try {
                const result = await api.setClassPublicationState(classId, {
                    subjectId,
                    state,
                    reason: readPublicationReason(),
                });
                applyPublicationResult(result);
                dirty = false;
                render();
                if (state === 'publicado') {
                    toast('success', 'Publicado', 'El contenido ya es visible para los alumnos.');
                } else if (state === 'pendiente_de_aval') {
                    toast('success', 'En revisión', 'La clase quedó pendiente de aval: el alumnado todavía no la ve.');
                } else {
                    toast('success', 'Retirado de la unidad', 'La clase dejó de estar disponible para los alumnos. El contenido no se borró.');
                }
            } catch (e) {
                toast('error', 'Error', e.message || 'No se pudo cambiar el estado de publicación.');
                render();
            }
        }

        // ── Regenerate per section ──
        async function regenerateSection(section) {
            loadingSection = section;
            render();

            try {
                if (section === 'podcast') {
                    const result = await api.generateClassAudioScript(classId, subjectId);
                    if (result.script) {
                        localState.podcast = result.script;
                        podcastValidated = false;
                        podcastTtsGenerated = false;
                    }
                    toast('success', 'Podcast', 'Guión regenerado con IA.');
                } else if (section === 'map') {
                    const result = await api.generateClassAssets(classId, subjectId);
                    if (result.map?.mapCode) {
                        localState.map = result.map.mapCode;
                    }
                    toast('success', 'Mapa', 'Mapa conceptual regenerado con IA.');
                } else {
                    const result = await api.generateClassAssets(classId, subjectId);
                    if (result.summary?.summary) {
                        const md = typeof result.summary.summary === 'object' ? result.summary.summary.content : result.summary.summary;
                        localState.summary = md;
                    }
                    if (result.map?.mapCode) {
                        localState.map = result.map.mapCode;
                    }
                    toast('success', 'Resumen', 'Resumen regenerado con IA.');

                    const scriptData = await api.getClassAudioScript(classId, subjectId);
                    if (scriptData?.script) {
                        localState.podcast = scriptData.script;
                        podcastValidated = false;
                        podcastTtsGenerated = false;
                    }
                }
            } catch (e) {
                toast('error', 'Error', e.message || 'No se pudo regenerar.');
            } finally {
                loadingSection = null;
                render();
            }
        }

        // ── Save to DB ──
        // #428: guarda el contenido y, si el docente pidió publicar, mueve el estado
        // con la acción explícita. El aviso al alumnado lo emite el servidor como
        // consecuencia del estado publicado, así que el cliente no lo dispara.
        async function saveContent({ publicationState: requestedState } = {}) {
            const btnSaveDraft = document.getElementById('btn-save-draft');
            const btnApprove = document.getElementById('btn-approve');
            try {
                if (btnSaveDraft) btnSaveDraft.disabled = true;
                if (btnApprove) btnApprove.disabled = true;

                saveCurrentTabToLocal();

                const validated = requestedState === 'publicado' || (!requestedState && publicationState === 'publicado');
                await Promise.all([
                    api.saveClassSummary(classId, { subjectId, summary: localState.summary, validated }),
                    api.saveClassMap ? api.saveClassMap(classId, { subjectId, mapCode: localState.map || '', validated }) : Promise.resolve(),
                    localState.podcast?.trim()
                        ? api.saveClassAudioScript(classId, {
                            subjectId,
                            script: localState.podcast,
                            generateAudio: requestedState === 'publicado' || publicationState === 'publicado',
                        })
                        : Promise.resolve(),
                ]);

                const classes = await api.getClasses(subjectId);
                const idx = classes.findIndex(c => c.id === classId);
                if (idx >= 0) {
                    // #428: `sectionsEnabled` sí es del cliente; el estado de publicación no.
                    classes[idx].sectionsEnabled = { ...sectionsEnabled };
                    await api.saveClasses(subjectId, classes);
                }

                dirty = false;
                render();

                if (requestedState) {
                    await changePublicationState(requestedState);
                    if (requestedState === 'publicado') {
                        const audioCheck = await api.getClassAudioScript(classId, subjectId);
                        podcastTtsGenerated = !!audioCheck?.ttsGeneratedAt;
                        window.location.hash = backHash;
                    }
                } else {
                    toast('success', 'Guardado', 'Cambios guardados sin cambiar quién puede ver la clase.');
                }
            } catch (e) {
                toast('error', 'Error', e.message || 'No se pudo guardar el contenido.');
            } finally {
                const s = document.getElementById('btn-save-draft');
                const a = document.getElementById('btn-approve');
                if (s) s.disabled = false;
                if (a) a.disabled = false;
            }
        }

        render();
    } catch (err) {
        console.error('Error loading class editor:', err);
        container.innerHTML = `
            <div class="empty-state" style="padding:60px 40px; text-align:center;">
                <div style="font-size:48px; margin-bottom:16px;">⚠️</div>
                <h3>Error al cargar el editor</h3>
                <p style="color:var(--color-text-secondary);">${err.message}</p>
                <a href="${backHash}" class="btn btn-primary" style="margin-top:20px;">Volver a Clases</a>
            </div>
        `;
    }
}
