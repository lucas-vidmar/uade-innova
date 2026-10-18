import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { renderAutoevaluacion } from '../../components/Autoevaluacion.js';
import { renderAudioPlayer } from '../../components/AudioPlayer.js';
import { marked } from 'marked';
import { extractMermaidCode } from '@shared/extract-mermaid.js';
import { formatLocalDate, parseLocalDate, startOfLocalDay } from '../../services/dates.js';

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
    // Fix #346: strip any query string before extracting the id — client nav
    // can append ?params, which previously poisoned the lookup and rendered
    // the not-found state until a hard reload.
    // Fix #360 (UJ-04): keep the query string instead of discarding it — a link
    // copied from another unit carries ?subjectId=<unidad> and must be honored,
    // otherwise a class of another unit is never found.
    const queryString = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const hashPath = hash.split('?')[0];
    const parts = hashPath.split('/');
    const rawClassId = parts[parts.length - 1];
    const classId = decodeURIComponent(rawClassId || '');

    if (!classId || classId === 'class') {
        window.location.hash = '#/student/dashboard';
        return;
    }

    renderHeader('Detalle de Clase');
    container.innerHTML = `<div class="page-loading animate-pulse" style="padding:40px;text-align:center;color:var(--color-text-secondary)">Cargando detalles de clase...</div>`;

    try {
        const activeSubjectId = auth.getActiveSubjectId();

        // Fix #360 (UJ-04): a class link must open the class it points to, even
        // when it belongs to another unit. We resolve the OWNING unit among the
        // units the person can access (the link's ?subjectId first, then the
        // active unit, then the rest of the person's units) and only then fetch
        // the class-scoped data. A unit the person is NOT enrolled in is never
        // used for lookups, so no lateral door is opened.
        const requestedSubjectId = new URLSearchParams(queryString).get('subjectId');
        const enrolledIds = auth.getEnrolledSubjects().map(s => s.id);
        const scopedIds = auth.getScopeSubjectIds();
        const accessibleIds = enrolledIds.length > 0 ? enrolledIds : scopedIds;
        const requestedAccessible = !!requestedSubjectId && accessibleIds.includes(requestedSubjectId);

        const candidateUnits = [...new Set([requestedSubjectId, activeSubjectId, ...accessibleIds].filter(Boolean))]
            .filter(id => id === activeSubjectId || accessibleIds.includes(id));

        let subjectId = requestedAccessible ? requestedSubjectId : activeSubjectId;
        let classInfo = null;
        let classList = [];
        for (const unit of candidateUnits) {
            try {
                const list = await api.getClasses(unit);
                if (Array.isArray(list) && list.some(c => c.id === classId)) {
                    subjectId = unit;
                    classList = list;
                    classInfo = list.find(c => c.id === classId);
                    break;
                }
            } catch (unitErr) {
                // Una unidad inaccesible (403) no debe romper la resolucion: se salta.
                console.warn(`[ClassDetail] No se pudo listar la unidad ${unit}:`, unitErr?.message || unitErr);
            }
        }

        if (!classInfo) {
            // Distinguish "esta clase no existe en tu unidad" from "no cursás la
            // unidad del enlace": the second case needs a reason and a path, not
            // a generic not-found (UJ-04 paso 2/7).
            const deniedByUnit = !!requestedSubjectId && !requestedAccessible;
            container.innerHTML = deniedByUnit
                ? `
                <div class="empty-state" style="padding:60px 40px;text-align:center">
                    <div style="font-size:48px;margin-bottom:16px">🔒</div>
                    <h3>No cursás esta unidad</h3>
                    <p style="color:var(--color-text-secondary);max-width:420px;margin:8px auto 0">
                        Esta clase pertenece a una unidad en la que no estás matriculado, así que no podés ver su contenido.
                        Si creés que deberías tener acceso, pedí el alta de la unidad a administración.
                    </p>
                    <a href="#/student/dashboard" class="btn btn-primary" style="margin-top:20px">Volver al Dashboard</a>
                </div>
            `
                : `<div class="empty-state" style="padding:40px">No se encontró la información de la clase.</div>`;
            return;
        }

        // La clase quedo resuelta en otra unidad: alinear la unidad activa para
        // que encabezado, sidebar y chat muestren lo mismo que la clase abierta.
        if (subjectId !== activeSubjectId) {
            auth.setActiveSubjectId(subjectId);
        }

        const [summaryData, mapData, timelineData, audioScriptData, deadlines] = await Promise.all([
            api.getClassSummary(classId, subjectId),
            api.getClassMap(classId, subjectId),
            api.getClassTimeline(classId, subjectId),
            api.getClassAudioScript(classId, subjectId),
            api.getDeadlines(subjectId),
        ]);

        // Track class view (fire-and-forget)
        api.trackClassView(classId, subjectId);

        // #428: el alumnado sólo abre lo publicado. El estado explícito manda y
        // `summaryReady` es su espejo, así que se mira el estado cuando está.
        const classPublished = classInfo.publicationState
            ? classInfo.publicationState === 'publicado'
            : !!classInfo.summaryReady;
        if (!classPublished) {
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

        // #423 (UJ-37): el cierre del encuentro debe mostrar "lo que viene" —
        // entregas con fecha comprometida y el próximo encuentro —, no sólo el
        // contenido del encuentro ya pasado.
        const startOfToday = startOfLocalDay();
        const upcomingDeadlines = (Array.isArray(deadlines) ? deadlines : [])
            .filter(d => d && d.dueDate && parseLocalDate(d.dueDate) && parseLocalDate(d.dueDate) >= startOfToday)
            .sort((a, b) => parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate));
        const currentClassTime = classInfo.date ? parseLocalDate(classInfo.date)?.getTime() ?? null : null;
        const nextClass = (Array.isArray(classList) ? classList : [])
            .filter(c => c && c.id !== classId && c.date)
            .filter(c => currentClassTime === null || (parseLocalDate(c.date)?.getTime() ?? 0) > currentClassTime)
            .sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date))[0] || null;
        const fmtDay = (value) => formatLocalDate(value, { day: 'numeric', month: 'short' });
        const upcomingHtml = `
            ${SECTION_TITLE('📅', 'Lo que viene')}
            <div class="card" data-testid="lo-que-viene" style="margin-bottom:var(--space-6);">
                <div style="padding:var(--space-4);">
                    <h3 class="h4" style="margin:0 0 var(--space-2) 0;font-size:var(--text-base);">Entregas con fecha comprometida</h3>
                    ${upcomingDeadlines.length > 0
                        ? `<ul style="margin:0;padding-left:18px;">${upcomingDeadlines.map(d => `<li style="margin-bottom:6px;"><strong>${escapeHtml(d.title || 'Entrega')}</strong> — vence el ${fmtDay(d.dueDate)}${d.classId ? ` <a href="#/student/class/${encodeURIComponent(d.classId)}" style="font-size:12px;">ver clase</a>` : ''}</li>`).join('')}</ul>`
                        : '<p style="margin:0;color:var(--color-text-secondary);font-size:14px;">No tenés entregas con fecha comprometida pendientes.</p>'}
                    <h3 class="h4" style="margin:var(--space-4) 0 var(--space-2) 0;font-size:var(--text-base);">Próximo encuentro</h3>
                    ${nextClass
                        ? `<p style="margin:0;font-size:14px;"><a href="#/student/class/${encodeURIComponent(nextClass.id)}">${escapeHtml(nextClass.title || 'Encuentro')}</a>${nextClass.date ? ` — ${fmtDay(nextClass.date)}` : ''}</p>`
                        : '<p style="margin:0;color:var(--color-text-secondary);font-size:14px;">No hay un próximo encuentro anunciado.</p>'}
                </div>
            </div>
        `;

        const rawSummary = summaryData?.summary?.content || summaryData?.summary || '';
        const hasValidSummary = rawSummary && !isPlaceholderSummary(rawSummary) && sec.summary !== false;

        const mapCode = sec.map !== false ? extractMermaidCode(mapData?.mapCode) : null;

        const sections = cleanSections(timelineData?.sections);
        const markers = cleanMarkers(timelineData?.markers);
        const showAllSections = sections.length <= MAX_VISIBLE_SECTIONS;
        const visibleSections = showAllSections ? sections : sections.slice(0, MAX_VISIBLE_SECTIONS);

        const audioUrl = api.getClassAudioUrl(classId, subjectId);
        const audioAvailable = sec.podcast !== false && audioScriptData?.validated && !!audioScriptData?.ttsGeneratedAt;

        let html = `
            <div class="breadcrumb" style="margin-bottom:var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">
                <a href="#/student/dashboard" style="color:inherit;text-decoration:none">Dashboard</a> / <span style="color:var(--color-text-primary)">${classInfo.title}</span>
            </div>

            <div class="class-detail-hero" style="margin-bottom:var(--space-6)">
                <h1 class="h2" style="margin-bottom:var(--space-2)">${classInfo.title}</h1>
                <div class="class-meta" style="display:flex;gap:var(--space-3)">
                    <span class="badge badge-primary">${classInfo.date ? formatLocalDate(classInfo.date, { day: 'numeric', month: 'long' }) : 'Sin fecha'}</span>
                    <span class="badge badge-neutral">${classInfo.materials?.length || 0} materiales</span>
                </div>
            </div>

            <div class="tabs class-detail-tabs" role="tablist" style="margin-bottom:var(--space-6)">
                <button type="button" class="tab-btn active" role="tab" aria-selected="true" data-class-tab="content" id="class-tab-content-btn">Contenido</button>
                <button type="button" class="tab-btn" role="tab" aria-selected="false" data-class-tab="quiz" id="class-tab-quiz-btn">Autoevaluación</button>
            </div>
        `;

        html += `<div id="class-tab-panel-content" data-class-panel="content">`;

        html += upcomingHtml;

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
                // #370: la generación del audio depende del aval del guión, que sólo
                // puede dar quien enseña (`POST /class-audio/{classId}/generate`
                // responde 400 mientras `validated` sea falso). Ofrecer el botón acá
                // era un callejón sin salida para quien aprende: se informa el estado
                // pendiente y no se ofrece ninguna acción.
                html += `
                    ${SECTION_TITLE('🎧', 'Podcast de Estudio (IA)')}
                    <div class="card premium-vibe" id="podcast-pending-card" data-testid="podcast-pending" style="margin-bottom:var(--space-6);background:linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);">
                        <div style="padding:var(--space-6);display:flex;flex-direction:column;align-items:center;gap:var(--space-4);">
                            <div style="width:56px;height:56px;border-radius:50%;background:var(--color-surface-2);display:flex;align-items:center;justify-content:center;">
                                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                            </div>
                            <div style="text-align:center">
                                <h4 style="margin:0;font-size:var(--text-lg);font-weight:700;">Podcast de la clase — ${escapeHtml(classInfo.title)}</h4>
                                <p style="margin:var(--space-1) 0 0 0;font-size:var(--text-xs);color:var(--color-text-secondary);">El podcast de esta clase todavía no está disponible. Se habilita cuando el contenido del encuentro quedó revisado.</p>
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
        const fabContainer = container.querySelector('.fab-container');
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
            // El FAB es fijo y cae justo sobre la fila «Siguiente / Ver resultados»
            // de la práctica, que no se puede scrollear: con la pestaña de
            // Autoevaluación abierta se oculta para dejar los botones alcanzables
            // (el chat sigue a un clic en la barra lateral y en cada sección).
            if (fabContainer) fabContainer.hidden = isQuiz;
            if (isQuiz && !quizInited) {
                quizInited = true;
                renderAutoevaluacion(quizPanel, {
                    classId,
                    subjectId: subjectId,
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

        // ── Podcast: la acción de generar audio es de quien enseña (#370). El detalle
        // de clase de la alumna sólo informa el estado, así que ya no hay handler.


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
                await generateClassMap(classId, subjectId);
                renderClassDetail(container);
            } catch {
                if (btn) { btn.disabled = false; btn.textContent = 'Generar mapa conceptual'; }
            }
        });

        initContentReport(container, classId, activeSubjectId);


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

// #369: el reporte de contenido estaba atado sólo al registro textual, así que una
// afirmación sin respaldo dentro de un derivado (resumen IA, mapa conceptual) no se
// podía marcar ni registrar: no había forma de declarar el derivado afectado. La barra
// de reporte ahora cubre los derivados y el caso nombre el derivado, la afirmación y el
// tramo del registro donde debería estar respaldada.
const REPORT_SURFACES = [
    {
        elementId: 'transcript-sections-list',
        derivado: 'Transcripción',
        action: 'Reportar error de transcripción',
        heading: 'Reportar error de transcripción',
        success: 'El docente recibió el reporte de error de transcripción.',
    },
    {
        elementId: 'summary-content',
        derivado: 'Resumen IA',
        action: 'Reportar afirmación sin respaldo',
        heading: 'Reportar afirmación sin respaldo',
        success: 'El docente recibió el reporte sobre el resumen. La afirmación queda registrada con el tramo del registro.',
    },
    {
        elementId: 'mermaid-container',
        derivado: 'Mapa conceptual',
        action: 'Reportar relación sin respaldo',
        heading: 'Reportar relación sin respaldo',
        success: 'El docente recibió el reporte sobre el mapa conceptual.',
    },
];

function normalizeForMatch(text) {
    return String(text || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ');
}

/**
 * Tramo del registro más parecido a lo señalado, como sugerencia para quien reporta
 * (el tramo donde la afirmación debería estar respaldada). Heurística explícita: se
 * declara como sugerencia y no como certeza.
 */
function suggestTramo(container, selectedText) {
    const words = normalizeForMatch(selectedText).split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) return null;
    let best = null;
    container.querySelectorAll('.transcript-section').forEach(section => {
        const text = normalizeForMatch(section.querySelector('.transcript-section-text')?.innerText || '');
        if (!text) return;
        const score = words.filter(w => text.includes(w)).length / words.length;
        if (!best || score > best.score) {
            best = {
                score,
                etiqueta: (section.querySelector('.badge')?.innerText || 'Bloque').trim(),
                texto: (section.querySelector('.transcript-section-text')?.innerText || '').trim().slice(0, 80),
            };
        }
    });
    if (!best || best.score < 0.3) return null;
    return best;
}

function initContentReport(container, classId, subjectId) {
    let toolbar = null;
    const surfaceFor = (node) => {
        if (!node) return null;
        return REPORT_SURFACES.find(surface => {
            const el = container.querySelector('#' + surface.elementId);
            return !!el && el.contains(node);
        }) || null;
    };

    const onSelectionChange = () => {
        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : '';
        const surface = (selectedText && selection) ? surfaceFor(selection.anchorNode) : null;

        if (toolbar) { toolbar.remove(); toolbar = null; }

        if (!surface || selectedText.length === 0) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        toolbar = document.createElement('div');
        toolbar.className = 'transcript-report-toolbar';
        toolbar.style.cssText = 'position:fixed;z-index:1000;background:var(--surface-2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:6px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        toolbar.innerHTML = `<button class="btn btn-secondary btn-sm">${surface.action}</button>`;
        toolbar.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
        toolbar.style.top = (rect.bottom + 8) + 'px';

        toolbar.querySelector('button').addEventListener('click', async () => {
            toolbar.remove();
            toolbar = null;
            window.getSelection().removeAllRanges();

            const tramo = suggestTramo(container, selectedText);

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.innerHTML = `
                <div class="modal-content" style="max-width:500px;width:92%;">
                    <div class="modal-header"><h3 class="h4" style="margin:0;">${surface.heading}</h3>
                    <button type="button" class="btn btn-ghost btn-sm dialog-close">✕</button></div>
                    <div class="modal-body">
                        <div style="margin-bottom:12px;"><strong>Derivado afectado:</strong>
                        <div style="font-size:14px;">${escapeHtml(surface.derivado)} — ${escapeHtml(classId)}</div></div>
                        <div style="margin-bottom:12px;"><strong>Texto seleccionado:</strong>
                        <div class="chat-bubble chat-bubble-user" style="margin-top:4px;white-space:pre-wrap;font-size:14px;">${escapeHtml(selectedText)}</div></div>
                        <div style="margin-bottom:12px;"><strong>Tramo del registro más parecido (sugerencia):</strong>
                        <div style="margin-top:4px;font-size:14px;">${tramo ? `${escapeHtml(tramo.etiqueta)} — «${escapeHtml(tramo.texto)}»` : 'Sin coincidencia con los tramos visibles'}</div></div>
                        <div><label class="form-label" for="transcript-correction" style="font-weight:600;">Qué corregiría</label>
                        <textarea id="transcript-correction" class="form-input" style="min-height:80px;resize:vertical;" placeholder="Contá qué está mal y con qué debería decirse..."></textarea>
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
            overlay.addEventListener('click', (e) => { if (e.target === e.currentTarget) cleanup(); });

            submitBtn.addEventListener('click', async () => {
                const val = (ta.value || '').trim();
                if (val.length < 3) {
                    errEl.textContent = 'Debe tener al menos 3 caracteres.';
                    errEl.style.display = 'block'; ta.focus(); return;
                }
                submitBtn.disabled = true; submitBtn.textContent = 'Enviando...';
                try {
                    const { toast } = await import('../../components/Toast.js');
                    const messageId = `content-${Date.now()}`;
                    const tramoRef = tramo ? `${tramo.etiqueta} «${tramo.texto}»` : 'sin coincidencia en los tramos visibles';
                    const issueDetail = surface.derivado === 'Transcripción'
                        ? `Error en transcripción: "${selectedText.substring(0, 200)}" — Corrección sugerida: ${val}`
                        : `Derivado afectado: ${surface.derivado} (encuentro ${classId}) — Afirmación sin respaldo: "${selectedText.substring(0, 200)}" — Tramo del registro más parecido: ${tramoRef} — Corrección sugerida: ${val}`;
                    await api.reportChatIssue({ messageId, subjectId, classId, issueDetail, question: '', answer: selectedText });
                    toast('success', 'Reporte enviado', surface.success);
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
    };

    document.addEventListener('selectionchange', onSelectionChange);
}
