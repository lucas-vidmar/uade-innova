/* ============================================================
   Class Detail — Exploration of a specific lecture
   HU#61: AI Summary + Conceptual Map (Mermaid.js)
   ============================================================ */
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';

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
        const [classes, summaryData, mapData] = await Promise.all([
            api.getClasses(activeSubjectId),
            api.getClassSummary(classId),
            api.getClassMap(classId)
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
                <a href="#/student/chat?classId=${classId}" class="btn btn-primary btn-lg fab" style="box-shadow:var(--shadow-lg);padding:16px 24px;border-radius:var(--radius-full);text-decoration:none;font-weight:bold;display:flex;align-items:center;gap:12px">
                    <span>💬</span> Consultar esta clase
                </a>
            </div>
        `;

        // Initialize Mermaid if code exists
        if (mapData?.mapCode && typeof mermaid !== 'undefined') {
            try {
                mermaid.run({ nodes: [document.getElementById('mermaid-container')] });
            } catch (err) {
                console.error('Mermaid render error:', err);
            }
        }

    } catch (err) {
        console.error('Error rendering class detail:', err);
        container.innerHTML = `<div class="card" style="padding:40px;text-align:center;color:var(--color-error)">Error al cargar el detalle de la clase. Por favor reintente.</div>`;
    }
}
