import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { marked } from 'marked';

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
        'resumen estructurado',
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
        const [classes, summaryData, mapData, timelineData] = await Promise.all([
            api.getClasses(activeSubjectId),
            api.getClassSummary(classId),
            api.getClassMap(classId),
            api.getClassTimeline(classId),
        ]);

        const classInfo = classes.find(c => c.id === classId);
        if (!classInfo) {
            container.innerHTML = `<div class="empty-state" style="padding:40px">No se encontró la información de la clase.</div>`;
            return;
        }

        const rawSummary = summaryData?.summary?.content || summaryData?.summary || '';
        const hasValidSummary = rawSummary && !isPlaceholderSummary(rawSummary);

        const sections = cleanSections(timelineData?.sections);
        const markers = cleanMarkers(timelineData?.markers);
        const showAllSections = sections.length <= MAX_VISIBLE_SECTIONS;
        const visibleSections = showAllSections ? sections : sections.slice(0, MAX_VISIBLE_SECTIONS);

        const audioUrl = api.getClassAudioUrl(classId, activeSubjectId);
        let audioAvailable = false;
        try {
            const headResp = await fetch(audioUrl, { method: 'HEAD' });
            audioAvailable = headResp.ok;
        } catch (e) {
            audioAvailable = false;
        }

        container.innerHTML = `
            <div class="breadcrumb" style="margin-bottom:var(--space-4);font-size:var(--text-sm);color:var(--color-text-secondary)">
                <a href="#/student/dashboard" style="color:inherit;text-decoration:none">Dashboard</a> / <span style="color:var(--color-text-primary)">${classInfo.title}</span>
            </div>

            <div class="class-detail-hero" style="margin-bottom:var(--space-8)">
                <h1 class="h2" style="margin-bottom:var(--space-2)">${classInfo.title}</h1>
                <div class="class-meta" style="display:flex;gap:var(--space-3)">
                    <span class="badge badge-primary">${classInfo.date ? new Date(classInfo.date).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : 'Sin fecha'}</span>
                    <span class="badge badge-neutral">${classInfo.materials?.length || 0} materiales</span>
                </div>
            </div>

            <div class="dashboard-grid">
                <div class="card">
                    <div class="card-header">
                        <span class="card-title">📝 Resumen IA</span>
                        ${summaryData?.validated ? '<span class="badge badge-success">✓ Validado por Docente</span>' : '<span class="badge badge-warning">En revisión</span>'}
                    </div>
                    <div class="summary-content markdown-body" style="padding:var(--space-6)">
                        ${hasValidSummary ? marked.parse(rawSummary, { breaks: true }) : '<p class="empty-text">El resumen todavía no está disponible para esta clase.</p>'}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <span class="card-title">🗺️ Mapa Conceptual</span>
                    </div>
                    <div class="map-container" id="mermaid-container" style="padding:var(--space-6);overflow:hidden;background:var(--color-bg-alt);border-radius:var(--radius-lg)">
                        ${mapData?.mapCode ? 
                            `<pre class="mermaid" style="background:transparent;border:none;padding:0;text-align:center;margin:0">${escapeHtml(mapData.mapCode)}</pre>` : 
                            '<div class="empty-state" style="padding:20px;text-align:center"><p>El mapa conceptual se está generando o no hay suficiente contenido aún.</p></div>'}
                    </div>
                    ${mapData?.mapCode ? `
                        <div class="card-footer" style="padding:10px;text-align:center;border-top:1px solid var(--color-border)">
                            <button class="btn btn-ghost btn-sm" id="btn-fullscreen-map">Ver código Mermaid</button>
                        </div>
                    ` : ''}
                </div>

                ${audioAvailable ? `
                <div class="card premium-vibe podcast-card" id="podcast-card" style="background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);">
                    <div class="card-header">
                        <span class="card-title">🎧 Podcast de Estudio (IA)</span>
                        <span class="badge badge-info">Beta</span>
                    </div>
                    <div class="podcast-container" style="padding:var(--space-8); display:flex; flex-direction:column; align-items:center; gap:var(--space-6);">
                        <div class="podcast-visual" style="width:64px; height:64px; border-radius:50%; background:var(--color-primary); display:flex; align-items:center; justify-content:center; box-shadow:0 0 20px var(--color-primary-alpha);">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        </div>
                        <div style="text-align:center">
                            <h4 style="margin:0; font-size:var(--text-lg); font-weight:700;">Resumen Audio-Guía</h4>
                            <p style="margin:var(--space-1) 0 0 0; font-size:var(--text-xs); color:var(--color-text-secondary);">Generado automáticamente con voz Nova</p>
                        </div>
                        <audio controls style="width:100%; height:40px; border-radius:var(--radius-full);">
                            <source src="${audioUrl}" type="audio/mpeg">
                            Tu navegador no soporta el elemento de audio.
                        </audio>
                        <div style="font-size:var(--text-xs); color:var(--color-text-secondary); font-style:italic;">
                            Escucha los conceptos clave mientras te trasladas.
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>

            <div class="card" style="margin-top:var(--space-6)">
                <div class="card-header">
                    <span class="card-title">⏱️ Timeline de Transcripción</span>
                </div>
                ${markers.length > 0 ? `
                    <div class="timeline-track" id="transcript-timeline-markers">
                        ${markers.map(marker => `
                            <button class="timeline-hit" data-section-id="${marker.sectionId}" data-focus-label="${escapeHtml(marker.label || '')}" title="${escapeHtml(marker.label || '')}">
                                <span class="timeline-hit-icon">${marker.iconType === 'assignment' ? '📌' : '❓'}</span>
                                <span class="timeline-hit-time">${Math.floor(marker.startSecond || 0)}s</span>
                            </button>
                        `).join('')}
                    </div>
                    <div style="margin-top:var(--space-4)">
                        <a id="timeline-open-chat" class="btn btn-primary btn-sm" href="#/student/chat?classId=${classId}" aria-disabled="true">Consultar este hit-point en el chat</a>
                    </div>
                ` : '<div style="color:var(--color-text-secondary)">Todavía no hay hit-points generados para la transcripción.</div>'}
            </div>

            <div class="card" style="margin-top:var(--space-6)">
                <div class="card-header">
                    <span class="card-title">📜 Transcripción Navegable</span>
                </div>
                <div class="transcript-sections" id="transcript-sections-list">
                    ${visibleSections.length > 0 ? visibleSections.map(section => `
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
                    `).join('') : '<div style="color:var(--color-text-secondary)">No hay secciones de transcripción disponibles.</div>'}
                    ${!showAllSections && sections.length > MAX_VISIBLE_SECTIONS ? `
                        <div style="text-align:center;padding:var(--space-4);color:var(--color-text-secondary);font-size:var(--text-sm)">
                            Mostrando ${MAX_VISIBLE_SECTIONS} de ${sections.length} secciones.
                            ${sections.length > 200 ? 'La transcripción completa está disponible en los materiales de la clase.' : ''}
                        </div>
                    ` : ''}
                </div>
            </div>

            <div class="section-title" style="margin-top:var(--space-10);display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-6)">
                <h2 class="h3">📚 Materiales de Referencia</h2>
                <div style="flex:1;height:1px;background:var(--color-border)"></div>
            </div>
            <div class="card" style="margin-bottom:40px">
                <div class="materials-list" style="padding:var(--space-2)">
                    ${classInfo.materials?.length > 0 ? classInfo.materials.map(m => `
                        <div class="material-row" style="display:flex;justify-content:between;align-items:center;padding:var(--space-4);border-bottom:1px solid var(--color-border);last-child:border-bottom:none">
                            <div class="material-info" style="display:flex;align-items:center;gap:var(--space-3)">
                                <span class="material-icon" style="font-size:1.2rem">${m.type === 'transcript' ? '📄' : m.type === 'presentation' ? '📊' : '📖'}</span>
                                <span class="material-name" style="font-weight:500">${m.filename}</span>
                            </div>
                            <a href="${m.blobUrl || '#'}" target="_blank" class="btn btn-secondary btn-sm">Ver original</a>
                        </div>
                    `).join('') : '<div style="padding:32px;text-align:center;color:var(--color-text-secondary)">No hay archivos adjuntos para esta clase.</div>'}
                </div>
            </div>
            
            <div class="fab-container" style="position:fixed;bottom:32px;right:32px;z-index:var(--z-fab)">
                <a id="class-chat-fab" href="#/student/chat?classId=${classId}" class="btn btn-primary btn-lg fab" style="box-shadow:var(--shadow-lg);padding:16px 24px;border-radius:var(--radius-full);text-decoration:none;font-weight:bold;display:flex;align-items:center;gap:12px">
                    <span>💬</span> Consultar esta clase
                </a>
            </div>
        `;

        if (mapData?.mapCode && typeof mermaid !== 'undefined') {
            try {
                const mermaidEl = container.querySelector('#mermaid-container .mermaid');
                if (mermaidEl) {
                    mermaid.run({ nodes: [mermaidEl] });
                }
            } catch (err) {
                console.error('Mermaid render error:', err);
            }
        }

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
                    chatLink.setAttribute('aria-disabled', 'false');
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
