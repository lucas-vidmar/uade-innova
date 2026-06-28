import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
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

        const mapCode = extractMermaidCode(mapData?.mapCode);

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
                        ${mapCode ? 
                            `<pre class="mermaid" style="background:transparent;border:none;padding:0;text-align:center;margin:0">${escapeHtml(mapCode)}</pre>` : 
                            '<div class="empty-state" style="padding:20px;text-align:center"><p>El mapa conceptual se está generando o no hay suficiente contenido aún.</p></div>'}
                    </div>
                    ${mapCode ? `
                        <div class="card-footer" style="padding:10px;text-align:center;border-top:1px solid var(--color-border)">
                            <button class="btn btn-ghost btn-sm" id="btn-fullscreen-map">Ver código Mermaid</button>
                        </div>
                    ` : (summaryData?.summaryReady || hasValidSummary) ? `
                        <div class="card-footer" style="padding:10px;text-align:center;border-top:1px solid var(--color-border)">
                            <button class="btn btn-primary btn-sm" id="btn-generate-map">Generar mapa conceptual</button>
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
                ` : (summaryData?.summaryReady || hasValidSummary) ? `
                <div class="card premium-vibe" id="podcast-card-generate" style="background: linear-gradient(135deg, var(--color-surface) 0%, var(--color-bg-alt) 100%);">
                    <div class="card-header">
                        <span class="card-title">🎧 Podcast de Estudio (IA)</span>
                        <span class="badge badge-info">Beta</span>
                    </div>
                    <div class="podcast-container" style="padding:var(--space-8); display:flex; flex-direction:column; align-items:center; gap:var(--space-6);">
                        <div class="podcast-visual" style="width:64px; height:64px; border-radius:50%; background:var(--color-surface-2); display:flex; align-items:center; justify-content:center;">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                        </div>
                        <div style="text-align:center">
                            <h4 style="margin:0; font-size:var(--text-lg); font-weight:700;">Resumen Audio-Guía</h4>
                            <p style="margin:var(--space-1) 0 0 0; font-size:var(--text-xs); color:var(--color-text-secondary);">Generado automáticamente con voz Nova</p>
                        </div>
                        <button class="btn btn-primary" id="btn-generate-audio">Generar audio</button>
                        <div id="audio-generation-progress" style="display:none;font-size:var(--text-xs);color:var(--color-text-secondary);">Generando audio... esto puede tomar unos segundos.</div>
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

        container.querySelector('#btn-generate-audio')?.addEventListener('click', async () => {
          const progress = container.querySelector('#audio-generation-progress');
          const btn = container.querySelector('#btn-generate-audio');
          if (btn) btn.style.display = 'none';
          if (progress) progress.style.display = 'block';
          try {
            const resp = await fetch(audioUrl);
            if (resp.ok) {
              renderClassDetail(container);
            } else {
              if (progress) progress.textContent = 'Error al generar el audio. Reintentá más tarde.';
            }
          } catch {
            if (progress) progress.textContent = 'Error de conexión. Reintentá más tarde.';
          }
        });

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
