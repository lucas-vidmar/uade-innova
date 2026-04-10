/* ============================================================
   Class Detail — Exploration of a specific lecture
   HU#61: AI Summary + Conceptual Map (Mermaid.js)
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function renderClassDetail(container) {
    // Get classId from hash (e.g. #/student/class/class-01)
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
                <!-- Summary Section -->
                <div class="card">
                    <div class="card-header">
                        <span class="card-title">📝 Resumen IA</span>
                        ${summaryData?.validated ? '<span class="badge badge-success">✓ Validado por Docente</span>' : '<span class="badge badge-warning">En revisión</span>'}
                    </div>
                    <div class="summary-content markdown-body" style="padding:var(--space-6)">
                        ${summaryData?.summary?.content || summaryData?.summary || '<p class="empty-text">El resumen todavía no está disponible para esta clase.</p>'}
                    </div>
                </div>

                <!-- Multimodal Assets Section -->
                <div class="card">
                    <div class="card-header">
                        <span class="card-title">🗺️ Mapa Conceptual</span>
                    </div>
                    <div class="map-container" id="mermaid-container" style="padding:var(--space-6);overflow:hidden;background:var(--color-bg-alt);border-radius:var(--radius-lg)">
                        ${mapData?.mapCode ? 
                            `<pre class="mermaid" style="background:transparent;border:none;padding:0;text-align:center;margin:0">${mapData.mapCode}</pre>` : 
                            '<div class="empty-state" style="padding:20px;text-align:center"><p>El mapa conceptual se está generando o no hay suficiente contenido aún.</p></div>'}
                    </div>
                    ${mapData?.mapCode ? `
                        <div class="card-footer" style="padding:10px;text-align:center;border-top:1px solid var(--color-border)">
                            <button class="btn btn-ghost btn-sm" id="btn-fullscreen-map">Ver código Mermaid</button>
                        </div>
                    ` : ''}
                </div>

                <!-- AI Podcast Section -->
                <div class="card premium-vibe" style="background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);">
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
                            <source src="${api.getClassAudioUrl(classId)}" type="audio/mpeg">
                            Tu navegador no soporta el elemento de audio.
                        </audio>
                        <div style="font-size:var(--text-xs); color:var(--color-text-secondary); font-style:italic;">
                            Escucha los conceptos clave mientras te trasladas.
                        </div>
                    </div>
                </div>
            </div>

            <div class="card" style="margin-top:var(--space-6)">
                <div class="card-header">
                    <span class="card-title">⏱️ Timeline de Transcripción</span>
                </div>
                ${(timelineData?.markers || []).length > 0 ? `
                    <div class="timeline-track" id="transcript-timeline-markers">
                        ${(timelineData.markers || []).map(marker => `
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
                    ${(timelineData?.sections || []).length > 0 ? (timelineData.sections || []).map(section => `
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
                </div>
            </div>

            <!-- Materials List -->
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

        // Initialize Mermaid if code exists
        if (mapData?.mapCode && typeof mermaid !== 'undefined') {
            try {
                const mermaidEl = document.querySelector('#mermaid-container .mermaid');
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
