/* ============================================================
   PrivacyModal.js — AI Content Consent Modal
   Terms fetched from Blob Storage, checkbox and continue button.
   ============================================================ */
import { auth } from '../services/auth.js';
import { api } from '../services/api.js';
import { toast } from './Toast.js';

export async function renderPrivacyModal(onAccepted) {
    if (auth.getAIConsentAccepted()) return;
    if (document.getElementById('privacy-modal')) return;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'privacy-modal';
    modalOverlay.className = 'modal-overlay';
    modalOverlay.style.zIndex = '9999';

    modalOverlay.innerHTML = `
        <div class="modal-content animate-in" style="max-width: 720px;">
            <div class="modal-header">
                <h2 class="h3" style="margin: 0; display: flex; align-items: center; gap: var(--space-2);">
                    Términos de uso
                </h2>
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
            
            <div class="modal-footer">
                <button id="consent-continue-btn" class="btn btn-primary btn-lg" disabled>Continuar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);

    const checkbox = document.getElementById('consent-checkbox');
    const continueBtn = document.getElementById('consent-continue-btn');
    const termsContent = document.getElementById('terms-content');

    checkbox.addEventListener('change', () => {
        continueBtn.disabled = !checkbox.checked;
    });

    continueBtn.addEventListener('click', async () => {
        continueBtn.disabled = true;
        continueBtn.innerHTML = 'Procesando...';

        const success = await auth.acceptAIConsent();
        if (success) {
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
