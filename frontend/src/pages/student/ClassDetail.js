import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { renderAutoevaluacion } from '../../components/Autoevaluacion.js';
import { renderAudioPlayer } from '../../components/AudioPlayer.js';
import { marked } from 'marked';
import { extractMermaidCode } from '@shared/extract-mermaid.js';

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isBinaryContent(text) {
    if (!text) return false;
    if (text.startsWith('%PDF')) return true;
    if (text.startsWith('PK\x03\x04')) return true;
    if (text.startsWith('Gau')) return true;
    const pdfKeywords = ['endobj', 'endstream', 'startxref', '%%EOF'];
    if (pdfKeywords.some(k => text.includes(k))) return true;
    let printable = 0;
    const len = Math.min(text.length, 500);
    for (let i = 0; i < len; i++) {
        const c = text.charCodeAt(i);
        if (c >= 32 && c <= 126) printable++;
    }
    return (printable / len) < 0.6;
}

function isPlaceholderSummary(text) {
    if (!text) return false;
    const placeholders = [
        'indícame la materia',
        'proporciona el texto',
        'deseas el resumen',
        'proporcione el texto',
    ];
    const lower = text.toLowerCase();
    return placeholders.some(p => lower.includes(p));
}

function cleanSections(sections) {
    return (sections || []).filter(s => !isBinaryContent(s.text));
}

function cleanMarkers(markers) {
    return (markers || []).filter(m => {
        if (isBinaryContent(m.label)) return false;
        if (m.startSecond === 0 && m.endSecond <= 1) return false;
        return true;
    });
}

function formatHitTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hh = Math.floor(total / 3600);
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return hh > 0 ? `${String(hh).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

const MATERIAL_ICONS = {
    transcript: '🎙️',
    presentation: '📊',
    notes: '📝',
    bibliography: '📚',
};

const SECTION_TITLE = (icon, label) => `
    <div class="section-title" style="margin-top:var(--space-10);display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6)">
        <h2 class="h3" style="margin:0">${icon} ${label}</h2>
        <div style="flex:1;height:1px;background:var(--color-border)"></div>
    </div>
`;

const MAX_VISIBLE_SECTIONS = 50;

export async function renderClassDetail(container) {
    const hash = window.location.hash || '';
    const parts = hash.split('/');
    const classId = parts[parts.length - 1];

    if (!classId || classId === 'class') {
        window.location.hash = '#/student/dashboard';
        return;
    }

    renderHeader('Detalle de Clase');
    container.innerHTML = `<div class="page-loading animate-pulse" style="padding:40px;text-align:center;color:var(--color-text-secondary)">Cargando detalles de clase...</div>`;

    try {
        const activeSubjectId = auth.getActiveSubjectId();
        const [classes, summaryData, mapData, timelineData, audioScriptData] = await Promise.all([
            api.getClasses(activeSubjectId),
            api.getClassSummary(classId, activeSubjectId),
            api.getClassMap(classId, activeSubjectId),
            api.getClassTimeline(classId, activeSubjectId),
            api.getClassAudioScript(classId, activeSubjectId),
        ]);

        const classInfo = classes.find(c => c.id === classId);
        if (!classInfo) {
            container.innerHTML = `<div class="empty-state" style="padding:40px">No se encontró la información de la clase.</div>`;
            return;
        }

        // Track class view (fire-and-forget)
        api.trackClassView(classId, activeSubjectId);

        if (!classInfo.summaryReady) {
            container.innerHTML = `
                <div class="empty-state" style="padding:60px 40px;text-align:center">
                    <div style="font-size:48px;margin-bottom:16px">🔒</div>
                    <h3>Clase no disponible</h3>
                    <p style="color:var(--color-text-secondary);max-width:400px;margin:8px auto 0">
                        Esta clase aún no fue publicada por el docente. Cuando esté lista, vas a poder acceder a su contenido.
                    </p>
                    <a href="#/student/dashboard" class="btn btn-primary" style="margin-top:20px">Volver al Dashboard</a>
                </div>
            `;
            return;
        }

        const sec = classInfo.sectionsEnabled || { summary: true, map: true, podcast: true };

        const rawSummary = summaryData?.summary?.content || summaryData?.summary || '';
        const hasValidSummary = rawSummary && !isPlaceholderSummary(rawSummary) && sec.summary !== false;

        const mapCode = sec.map !== false ? extractMermaidCode(mapData?.mapCode) : null;

        const sections = cleanSections(timelineData?.sections);
        const markers = cleanMarkers(timelineData?.markers);
        const showAllSections = sections.length <= MAX_VISIBLE_SECTIONS;
        const visibleSections = showAllSections ? sections : sections.slice(0, MAX_VISIBLE_SECTIONS);

        const audioUrl = api.getClassAudioUrl(classId, activeSubjectId);
        const audioAvailable = sec.podcast !== false && audioScriptData?.validated && !!audioScriptData?.ttsGeneratedAt;

        let html = `
            <div class="breadcrumb" style="margin-bottom:var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">
                <a href="#/student/dashboard" style="color:inherit;text-decoration:none">Dashboard</a> / <span style="color:var(--color-text-primary)">${classInfo.title}</span>
            </div>

            <div class="class-detail-hero" style="margin-bottom:var(--space-6)">
                <h1 class="h2" style="margin-bottom:var(--space-2)">${classInfo.title}</h1>
                <div class="class-meta" style="display:flex;gap:var(--space-3)">
                    <span class="badge badge-primary">${classInfo.date ? new Date(classInfo.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : 'Sin fecha'}</span>
                    <span class="badge badge-neutral">${classInfo.materials?.length || 0} materiales</span>
                </div>
            </div>

            <div class="tabs class-detail-tabs" role="tablist" style="margin-bottom:var(--space-6)">
                <button type="button" class="tab-btn active" role="tab" aria-selected="true" data-class-tab="content" id="class-tab-content-btn">Contenido</button>
                <button type="button" class="tab-btn" role="tab" aria-selected="false" data-class-tab="quiz" id="class-tab-quiz-btn">Autoevaluación</button>
            </div>
        `;

        html += `<div id="class-tab-panel-content" data-class-panel="content">`;

        if (hasValidSummary) {
            html += `
                ${SECTION_TITLE('📝', 'Resumen IA')}
                <div class="card" style="margin-bottom:var(--space-6)">
                    <div class="summary-collapse-wrapper" id="summary-wrapper">
                        <div class="summary-content markdown-body summary-collapsed" id="summary-content">
                            ${marked.parse(rawSummary, { breaks: true })}
                        </div>
                        <button class="btn btn-ghost btn-sm summary-toggle-btn" id="summary-toggle-btn">
                            <span id="summary-toggle-text">Mostrar más</span>
                            <svg id="summary-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s"><path d="m6 9 6 6 6-6"/></svg>
                        </button>
                    </div>
                </div>
            `;
        }

        if (mapCode) {
            html += `
                ${SECTION_TITLE('🗺️', 'Mapa Conceptual')}
                <div class="card" style="margin-bottom:var(--space-6)">
                    <div class="map-container" id="mermaid-container" style="padding:var(--space-6);overflow:hidden;background:var(--color-bg-alt);border-radius:var(--radius-lg);position:relative;cursor:grab">
                        <div class="map-zoom-container" id="map-zoom-container" style="translate:0 0">
                            <pre class="mermaid" style="background:transparent;border:none;padding:0;text-align:center;margin:0;pointer-events:none">${escapeHtml(mapCode)}</pre>
                        </div>
                    </div>
                    <div class="card-footer map-controls" id="map-controls" style="justify-content:center;flex-wrap:wrap;gap:6px">
                        <button class="btn btn-ghost btn-sm" data-zoom="out" title="Alejar" style="font-size:18px;line-height:1;padding:4px 10px;">−</button>
                        <button class="btn btn-ghost btn-sm" data-zoom="in" title="Acercar" style="font-size:18px;line-height:1;padding:4px 10px;">+</button>
                        <button class="btn btn-ghost btn-sm" data-zoom="reset" title="Restablecer" style="font-size:16px;line-height:1;padding:4px 10px;">⟲</button>
                        <span class="map-zoom-label" id="map-zoom-label" style="font-size:13px;font-weight:600;color:var(--color-text-secondary);min-width:48px;text-align:center">100%</span>
                        <span style="color:var(--color-text-muted);font-size:12px;margin-left:8px;">(arrastrá para navegar)</span>
                    </div>
                </div>
            `;
        }

        if (sec.podcast !== false) {
            if (audioAvailable) {
                html += `
                    ${SECTION_TITLE('🎧', 'Podcast de Estudio (IA)')}
                    <div class="card premium-vibe" style="margin-bottom:var(--space-6);background:linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);">
                        <div style="padding:var(--space-6);display:flex;flex-direction:column;align-items:center;gap:var(--space-4);">
                            <div style="width:56px;height:56px;border-radius:50%;background:var(--color-primary);display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px var(--color-primary-alpha);">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                            </div>
                            <div id="class-audio-player-mount" style="width:100%;display:flex;justify-content:center;"></div>
                            <div style="font-size:var(--text-xs);color:var(--color-text-secondary);font-style:italic;">
                                Escuchá los conceptos clave mientras te trasladás.
                            </div>
                        </div>
                    </div>
                `;
            } else {
                html += `
                    ${SECTION_TITLE('🎧', 'Podcast de Estudio (IA)')}
                    <div class="card premium-vibe" id="podcast-generate-card" style="margin-bottom:var(--space-6);background:linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);">
                        <div style="padding:var(--space-6);display:flex;flex-direction:column;align-items:center;gap:var(--space-4);">
                            <div style="width:56px;height:56px;border-radius:50%;background:var(--color-surface-2);display:flex;align-items:center;justify-content:center;">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                            </div>
                            <div style="text-align:center">
                                <h4 style="margin:0;font-size:var(--text-lg);font-weight:700;">Podcast de la clase — ${escapeHtml(classInfo.title)}</h4>
                                <p style="margin:var(--space-1) 0 0 0;font-size:var(--text-xs);color:var(--color-text-secondary);">Aún no hay audio generado para esta clase.</p>
                            </div>
                            <button type="button" class="btn btn-primary" id="btn-generate-audio" data-testid="btn-generate-audio">Generar audio</button>
                            <div id="audio-generation-progress" style="display:none;align-items:center;gap:var(--space-2);font-size:var(--text-xs);color:var(--color-text-secondary);">
                                <span class="audio-player-spinner" aria-hidden="true"></span>
                                <span>Generando audio... esto puede tomar unos segundos.</span>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        if (markers.length > 0) {
            const firstMarker = markers[0];
            const firstSection = encodeURIComponent(firstMarker.sectionId || '');
            const firstLabel = encodeURIComponent(firstMarker.label || 'Seccion de transcripcion');
            html += `
                ${SECTION_TITLE('⏱️', 'Timeline de Transcripción')}
                <div class="card" style="margin-bottom:var(--space-6)">
                    <div style="padding:var(--space-6)">
                        <div class="timeline-track" id="transcript-timeline-markers">
                            ${markers.map(marker => `
                                <button class="timeline-hit" data-section-id="${marker.sectionId}" data-focus-label="${escapeHtml(marker.label || '')}" title="${escapeHtml(marker.label || '')} (${formatHitTime(marker.startSecond)})">
                                    <span class="timeline-hit-icon">${marker.iconType === 'assignment' ? '📌' : '❓'}</span>
                                    <span class="timeline-hit-time">${formatHitTime(marker.startSecond)}</span>
                                </button>
                            `).join('')}
                        </div>
                        <div style="margin-top:var(--space-4)">
                            <a id="timeline-open-chat" class="btn btn-primary btn-sm" href="#/student/chat?classId=${classId}&transcriptSection=${firstSection}&focusLabel=${firstLabel}">Consultar en el chat (${markers.length} hit-point${markers.length === 1 ? '' : 's'})</a>
                        </div>
                    </div>
                </div>
            `;
        }

        if (visibleSections.length > 0) {
            html += `
                ${SECTION_TITLE('📜', 'Transcripción Navegable')}
                <div class="card" style="margin-bottom:var(--space-6)">
                    <div class="transcript-sections" id="transcript-sections-list" style="padding:var(--space-2)">
                        ${visibleSections.map(section => `
                            <article class="transcript-section" id="transcript-section-${section.id}" data-section-id="${section.id}">
                                <div class="transcript-section-head">
                                    <span class="badge badge-neutral">${escapeHtml(section.timestampLabel || 'Bloque')}</span>
                                    <a
                                        href="#/student/chat?classId=${classId}&transcriptSection=${encodeURIComponent(section.id)}&focusLabel=${encodeURIComponent(section.text?.slice(0, 64) || 'Seccion de transcripcion')}"
                                        class="btn btn-ghost btn-sm"
                                    >
                                        Abrir en chat
                                    </a>
                                </div>
                                <p class="transcript-section-text">${escapeHtml(section.text || '')}</p>
                            </article>
                        `).join('')}
                        ${!showAllSections && sections.length > MAX_VISIBLE_SECTIONS ? `
                            <div style="text-align:center;padding:var(--space-4);color:var(--color-text-secondary);font-size:var(--text-sm)">
                                Mostrando ${MAX_VISIBLE_SECTIONS} de ${sections.length} secciones.
                                ${sections.length > 200 ? 'La transcripción completa está disponible en los materiales de la clase.' : ''}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        html += `
            ${SECTION_TITLE('📚', 'Materiales de Referencia')}
            <div class="card" style="margin-bottom:40px">
                <div class="materials-list" style="padding:var(--space-2)">
                    ${classInfo.materials?.length > 0 ? classInfo.materials.map(m => `
                        <div class="material-row" style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-4);border-bottom:1px solid var(--color-border);:last-child:border-bottom:none">
                            <span style="font-size:1.2rem;flex-shrink:0">${MATERIAL_ICONS[m.type] || '📄'}</span>
                            <span style="font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.filename}</span>
                            <span style="font-size:12px;color:var(--color-text-muted);flex-shrink:0;text-transform:capitalize">${m.type}</span>
                        </div>
                    `).join('') : '<div style="padding:32px;text-align:center;color:var(--color-text-secondary)">No hay archivos adjuntos para esta clase.</div>'}
                </div>
            </div>
            </div>
            <div id="class-tab-panel-quiz" data-class-panel="quiz" hidden></div>

            <div class="fab-container" style="position:fixed;bottom:32px;right:32px;z-index:var(--z-fab)">
                <a id="class-chat-fab" href="#/student/dashboard?classId=${classId}" class="btn btn-primary btn-lg fab" style="box-shadow:var(--shadow-lg);padding:16px 24px;border-radius:var(--radius-full);text-decoration:none;font-weight:bold;display:flex;align-items:center;gap:12px">
                    <span>💬</span> Consultar esta clase
                </a>
            </div>
        `;

        container.innerHTML = html;

        // ── Class detail tabs (Contenido / Autoevaluación) ──
        const contentPanel = container.querySelector('#class-tab-panel-content');
        const quizPanel = container.querySelector('#class-tab-panel-quiz');
        const tabButtons = container.querySelectorAll('[data-class-tab]');
        let quizInited = false;

        const selectClassTab = (tabName) => {
            const isQuiz = tabName === 'quiz';
            tabButtons.forEach((btn) => {
                const active = btn.dataset.classTab === tabName;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            if (contentPanel) contentPanel.hidden = isQuiz;
            if (quizPanel) quizPanel.hidden = !isQuiz;
            if (isQuiz && !quizInited) {
                quizInited = true;
                renderAutoevaluacion(quizPanel, {
                    classId,
                    subjectId: activeSubjectId,
                    className: classInfo.title,
                });
            }
        };

        tabButtons.forEach((btn) => {
            btn.addEventListener('click', () => selectClassTab(btn.dataset.classTab));
        });

        // ── Podcast audio player: custom TTS player component (Story 11.3.1) ──
        const playerMount = container.querySelector('#class-audio-player-mount');
        if (playerMount && audioAvailable) {
            renderAudioPlayer(playerMount, {
                src: audioUrl,
                className: classInfo.title,
                downloadName: `podcast-${classId}.mp3`,
            });
        }

        // ── 'Generar audio' (Story 11.3.1): trigger on-demand TTS generation ──
        const generateAudioBtn = container.querySelector('#btn-generate-audio');
        const generateProgress = container.querySelector('#audio-generation-progress');

        generateAudioBtn?.addEventListener('click', async () => {
            if (generateAudioBtn.disabled) return;
            if (generateAudioBtn) generateAudioBtn.disabled = true;
            if (generateProgress) generateProgress.style.display = 'flex';
            try {
                const { toast } = await import('../../components/Toast.js');
                await api.generateClassAudio(classId);
                toast('success', 'Audio generado', 'El podcast de la clase está listo.');
                await renderClassDetail(container);
            } catch (err) {
                if (generateProgress) {
                    generateProgress.style.display = 'none';
                }
                if (generateAudioBtn) generateAudioBtn.disabled = false;
                const { toast } = await import('../../components/Toast.js');
                toast('error', 'Error', err?.message || 'No se pudo generar el audio. Reintentá más tarde.');
            }
        });

        // Restore quiz tab if the URL carries ?tab=quiz (deep link from dashboard)
        if (new URLSearchParams(window.location.search).get('tab') === 'quiz') {
            selectClassTab('quiz');
        }

        if (mapCode && typeof mermaid !== 'undefined') {
            try {
                const mermaidEl = container.querySelector('#mermaid-container .mermaid');
                if (mermaidEl) {
                    mermaid.run({ nodes: [mermaidEl] });
                }
            } catch (err) {
                console.error('Mermaid render error:', err);
            }
        }

        const summaryWrapper = container.querySelector('#summary-wrapper');
        const summaryContent = container.querySelector('#summary-content');
        const summaryToggle = container.querySelector('#summary-toggle-btn');
        const summaryToggleText = container.querySelector('#summary-toggle-text');
        const summaryToggleIcon = container.querySelector('#summary-toggle-icon');

        if (summaryWrapper && summaryContent && summaryToggle) {
            const collapsed = summaryContent.classList.contains('summary-collapsed');
            if (collapsed) {
                summaryToggle.addEventListener('click', () => {
                    const isCollapsed = summaryContent.classList.toggle('summary-collapsed');
                    summaryToggleText.textContent = isCollapsed ? 'Mostrar más' : 'Mostrar menos';
                    summaryToggleIcon.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)';
                });
            } else {
                summaryToggle.style.display = 'none';
            }
        }

        let mapZoom = 1;
        let mapTranslateX = 0;
        let mapTranslateY = 0;
        const zoomContainer = container.querySelector('#map-zoom-container');
        const mapContainer = container.querySelector('#mermaid-container');
        const zoomLabel = container.querySelector('#map-zoom-label');

        const setZoom = (level) => {
            mapZoom = Math.max(0.25, Math.min(10, level));
            if (zoomContainer) zoomContainer.style.transform = `translate(${mapTranslateX}px, ${mapTranslateY}px) scale(${mapZoom})`;
            if (zoomLabel) zoomLabel.textContent = Math.round(mapZoom * 100) + '%';
        };

        container.querySelector('[data-zoom="in"]')?.addEventListener('click', () => setZoom(mapZoom + 0.25));
        container.querySelector('[data-zoom="out"]')?.addEventListener('click', () => setZoom(Math.max(0.25, mapZoom - 0.25)));
        container.querySelector('[data-zoom="reset"]')?.addEventListener('click', () => {
            mapTranslateX = 0;
            mapTranslateY = 0;
            setZoom(1);
        });

        if (mapContainer) {
            let isDragging = false;
            let startX, startY;

            mapContainer.addEventListener('mousedown', (e) => {
                if (e.target.closest('.map-controls, .map-controls *')) return;
                isDragging = true;
                startX = e.clientX - mapTranslateX;
                startY = e.clientY - mapTranslateY;
                mapContainer.style.cursor = 'grabbing';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                mapTranslateX = e.clientX - startX;
                mapTranslateY = e.clientY - startY;
                if (zoomContainer) zoomContainer.style.transform = `translate(${mapTranslateX}px, ${mapTranslateY}px) scale(${mapZoom})`;
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    mapContainer.style.cursor = 'grab';
                }
            });
        }

        container.querySelector('#btn-generate-map')?.addEventListener('click', async () => {
            const btn = container.querySelector('#btn-generate-map');
            if (btn) { btn.disabled = true; btn.textContent = 'Generando...'; }
            try {
                const { generateClassMap } = await import('../../services/classes.api.js');
                await generateClassMap(classId, activeSubjectId);
                renderClassDetail(container);
            } catch {
                if (btn) { btn.disabled = false; btn.textContent = 'Generar mapa conceptual'; }
            }
        });

        initTranscriptionReport(container, classId, activeSubjectId);

        container.querySelectorAll('.timeline-hit').forEach((hit) => {
            hit.addEventListener('click', () => {
                const sectionId = hit.getAttribute('data-section-id');
                const focusLabel = hit.getAttribute('data-focus-label') || 'Seccion de transcripcion';
                if (!sectionId) return;

                const target = container.querySelector(`#transcript-section-${CSS.escape(sectionId)}`);
                if (!target) return;

                container.querySelectorAll('.transcript-section.active').forEach(el => el.classList.remove('active'));
                target.classList.add('active');
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });

                const chatLink = container.querySelector('#timeline-open-chat');
                if (chatLink) {
                    chatLink.setAttribute('href', `#/student/chat?classId=${classId}&transcriptSection=${encodeURIComponent(sectionId)}&focusLabel=${encodeURIComponent(focusLabel)}`);
                    chatLink.textContent = 'Consultar este hit-point en el chat';
                }

                const fabLink = container.querySelector('#class-chat-fab');
                if (fabLink) {
                    fabLink.setAttribute('href', `#/student/chat?classId=${classId}&transcriptSection=${encodeURIComponent(sectionId)}&focusLabel=${encodeURIComponent(focusLabel)}`);
                }
            });
        });

    } catch (err) {
        console.error('Error rendering class detail:', err);
        container.innerHTML = `<div class="card" style="padding:40px;text-align:center;color:var(--color-error)">Error al cargar el detalle de la clase. Por favor reintente.</div>`;
    }
}

function initTranscriptionReport(container, classId, subjectId) {
    let toolbar = null;
    const onSelectionChange = () => {
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : '';
        const isInTranscript = selection && container.querySelector('#transcript-sections-list')?.contains(selection.anchorNode);

        if (toolbar) { toolbar.remove(); toolbar = null; }

        if (selectedText.length > 0 && isInTranscript) {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            toolbar = document.createElement('div');
            toolbar.className = 'transcript-report-toolbar';
            toolbar.style.cssText = 'position:fixed;z-index:1000;background:var(--surface-2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:6px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
            toolbar.innerHTML = '<button class="btn btn-secondary btn-sm">Reportar error de transcripción</button>';
            toolbar.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
            toolbar.style.top = (rect.bottom + 8) + 'px';

            toolbar.querySelector('button').addEventListener('click', async () => {
                toolbar.remove();
                toolbar = null;
                window.getSelection().removeAllRanges();

                const overlay = document.createElement('div');
                overlay.className = 'modal-overlay';
                overlay.innerHTML = `
                    <div class="modal-content" style="max-width:500px;width:92%;">
                        <div class="modal-header"><h3 class="h4" style="margin:0;">Reportar error de transcripción</h3>
                        <button type="button" class="btn btn-ghost btn-sm dialog-close">✕</button></div>
                        <div class="modal-body">
                            <div style="margin-bottom:12px;"><strong>Texto seleccionado:</strong>
                            <div class="chat-bubble chat-bubble-user" style="margin-top:4px;white-space:pre-wrap;font-size:14px;">${escapeHtml(selectedText)}</div></div>
                            <div><label class="form-label" for="transcript-correction" style="font-weight:600;">Corrección sugerida</label>
                            <textarea id="transcript-correction" class="form-input" style="min-height:80px;resize:vertical;" placeholder="Escribí la corrección..."></textarea>
                            <p id="transcript-correction-error" style="display:none;margin-top:6px;color:var(--color-error);font-size:13px;"></p></div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-ghost dialog-cancel">Cancelar</button>
                            <button type="button" class="btn btn-primary" id="transcript-correction-submit" disabled>Enviar</button>
                        </div>
                    </div>`;

                const ta = overlay.querySelector('#transcript-correction');
                const errEl = overlay.querySelector('#transcript-correction-error');
                const submitBtn = overlay.querySelector('#transcript-correction-submit');

                const cleanup = () => overlay.remove();
                ta.addEventListener('input', () => { submitBtn.disabled = (ta.value || '').trim().length < 3; errEl.style.display = 'none'; });
                overlay.querySelector('.dialog-close')?.addEventListener('click', cleanup);
                overlay.querySelector('.dialog-cancel')?.addEventListener('click', cleanup);
                overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

                submitBtn.addEventListener('click', async () => {
                    const val = (ta.value || '').trim();
                    if (val.length < 3) {
                        errEl.textContent = 'Debe tener al menos 3 caracteres.';
                        errEl.style.display = 'block'; ta.focus(); return;
                    }
                    submitBtn.disabled = true; submitBtn.textContent = 'Enviando...';
                    try {
                        const { toast } = await import('../../components/Toast.js');
                        const messageId = `transcript-${Date.now()}`;
                        await api.reportChatIssue({ messageId, subjectId, issueDetail: `Error en transcripción: "${selectedText.substring(0, 200)}" — Corrección sugerida: ${val}`, question: '', answer: selectedText });
                        toast('success', 'Reporte enviado', 'El docente recibió el reporte de error de transcripción.');
                        cleanup();
                    } catch (err) {
                        const { toast } = await import('../../components/Toast.js');
                        toast('error', 'Error', err?.message || 'No se pudo enviar el reporte.');
                        submitBtn.disabled = false; submitBtn.textContent = 'Enviar';
                    }
                });
                document.body.appendChild(overlay);
                setTimeout(() => ta.focus(), 100);
            });
            document.body.appendChild(toolbar);
        }
    };
    document.addEventListener('selectionchange', onSelectionChange);
}
