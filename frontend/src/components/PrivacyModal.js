/* ============================================================
   PrivacyModal.js — AI Content Consent Modal
   Terms fetched from Blob Storage, checkbox and continue button.
   Issues #377/#376: el diálogo toma y contiene el foco, y se puede
   aplazar (✕ / Escape / clic afuera) sin autorizar nada.
   ============================================================ */
import { auth } from '../services/auth.js';
import { api } from '../services/api.js';
import { toast } from './Toast.js';
import { createDialogFocus } from '../services/dialog-focus.js';

export async function renderPrivacyModal(onAccepted, options = {}) {
    const force = options?.force === true;
    if (!force && auth.getAIConsentAccepted()) return;
    if (document.getElementById('privacy-modal')) return;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'privacy-modal';
    modalOverlay.className = 'modal-overlay';
    modalOverlay.style.zIndex = '9999';

    modalOverlay.innerHTML = `
        <div class="modal-content animate-in" role="dialog" aria-modal="true" aria-labelledby="privacy-modal-title" style="max-width: 720px;">
            <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);">
                <h2 class="h3" id="privacy-modal-title" style="margin: 0; display: flex; align-items: center; gap: var(--space-2);">
                    Términos de uso
                </h2>
                <button type="button" class="btn btn-ghost btn-sm" id="consent-close-btn" aria-label="Cerrar y decidir más tarde">✕</button>
            </div>
            
            <div class="modal-body" style="overflow-y: auto; max-height: 60vh;">
                <div id="terms-content" class="text-text-secondary text-sm leading-relaxed">
                    <div class="animate-pulse">Cargando términos...</div>
                </div>
                
                <div class="mt-6 p-4 bg-surface-2 rounded-xl border border-border">
                    <label class="flex items-start gap-3 cursor-pointer select-none">
                        <input type="checkbox" id="consent-checkbox" style="accent-color: var(--color-accent); flex-shrink: 0; width: 18px; height: 18px; margin-top: 1px;">
                        <span class="text-sm font-medium text-text-primary leading-relaxed">
                            Acepto que mis consultas sean procesadas por IA y almacenadas para mejorar el servicio
                        </span>
                    </label>
                </div>
            </div>
            
            <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:var(--space-3);">
                <button type="button" class="btn btn-outline" id="consent-later-btn">Decidir más tarde</button>
                <button id="consent-continue-btn" class="btn btn-primary btn-lg" disabled>Continuar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);

    const modalContent = modalOverlay.querySelector('.modal-content');
    const checkbox = document.getElementById('consent-checkbox');
    const continueBtn = document.getElementById('consent-continue-btn');
    const termsContent = document.getElementById('terms-content');

    let finished = false;
    const background = [document.getElementById('app'), document.querySelector('.app-shell')].filter(Boolean);

    const releaseFocus = createDialogFocus({
        dialog: modalContent,
        background,
        initialFocus: '#consent-checkbox',
        onEscape: () => closeWithoutAccepting(),
    });

    // Cerrar sin aceptar: la decisión queda abierta y se retoma en la próxima visita.
    // (UJ-01, rama de error: "si la persona interrumpe antes de registrar su decisión".)
    const closeWithoutAccepting = () => {
        if (finished) return;
        finished = true;
        releaseFocus();
        modalOverlay.classList.replace('animate-in', 'animate-out');
        setTimeout(() => {
            modalOverlay.remove();
            document.body.style.overflow = '';
        }, 250);
    };

    modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) closeWithoutAccepting();
    });
    document.getElementById('consent-close-btn')?.addEventListener('click', closeWithoutAccepting);
    document.getElementById('consent-later-btn')?.addEventListener('click', closeWithoutAccepting);

    checkbox.addEventListener('change', () => {
        continueBtn.disabled = !checkbox.checked;
    });

    continueBtn.addEventListener('click', async () => {
        continueBtn.disabled = true;
        continueBtn.innerHTML = 'Procesando...';

        const success = await auth.acceptAIConsent();
        if (success) {
            if (finished) return;
            finished = true;
            releaseFocus();
            modalOverlay.classList.replace('animate-in', 'animate-out');
            setTimeout(() => {
                modalOverlay.remove();
                document.body.style.overflow = '';
                if (onAccepted && typeof onAccepted === 'function') {
                    onAccepted();
                }
            }, 300);
        } else {
            continueBtn.disabled = false;
            continueBtn.innerHTML = 'Continuar';
            toast('error', 'Error', 'Hubo un problema al guardar su preferencia. Reintente.');
        }
    });

    document.body.style.overflow = 'hidden';
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.removedNodes.forEach((node) => {
                if (node.id === 'privacy-modal') {
                    document.body.style.overflow = '';
                    if (!finished) { finished = true; releaseFocus(); }
                    observer.disconnect();
                }
            });
        });
    });
    observer.observe(document.body, { childList: true });

    // Fetch terms from backend
    try {
        const terms = await api.getTerms();
        if (terms && terms.content) {
            termsContent.innerHTML = renderMarkdown(terms.content);
        } else {
            termsContent.innerHTML = '<p class="text-text-muted italic">No se pudieron cargar los términos. Intente nuevamente.</p>';
        }
    } catch (err) {
        console.error('[PrivacyModal] Error fetching terms:', err);
        termsContent.innerHTML = '<p class="text-text-muted italic">Error al cargar los términos de uso.</p>';
    }
}

function renderMarkdown(text) {
    if (!text) return '';
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h3 class="h4 mt-4 mb-2">$1</h3>')
        .replace(/^## (.+)$/gm, '<h2 class="h3 mt-5 mb-2">$1</h2>')
        .replace(/^# (.+)$/gm, '<h2 class="h3 mt-5 mb-2">$1</h2>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul class="mb-3">$1</ul>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
    return `<p>${html}</p>`;
}
