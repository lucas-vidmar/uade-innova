/* ============================================================
   PrivacyModal.js — Institutional Data Privacy Modal
   ============================================================ */
import { auth } from '../services/auth.js';

/**
 * Renders and manages the Privacy Policy modal.
 * This is a blocking modal that only disappears when the user clicks "Accept".
 */
export function renderPrivacyModal() {
    // If already accepted, do nothing
    if (auth.getConsentAccepted()) return;

    // Check if modal already exists
    if (document.getElementById('privacy-modal')) return;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'privacy-modal';
    modalOverlay.className = 'modal-overlay';
    modalOverlay.style.zIndex = '9999'; // Ensure it's on top of everything

    modalOverlay.innerHTML = `
        <div class="modal-content card animate-in" style="max-width: 600px; width: 90%; max-height: 80vh; display: flex; flex-direction: column;">
            <div class="modal-header" style="border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-4); margin-bottom: var(--space-4);">
                <h2 class="h3" style="margin: 0; display: flex; align-items: center; gap: var(--space-2);">
                    <span style="font-size: 1.5rem;">⚖️</span> Política de Privacidad de Datos
                </h2>
            </div>
            
            <div class="modal-body" style="overflow-y: auto; flex: 1; padding-right: var(--space-2);">
                <p><strong>Bienvenido a UADE Innova.</strong></p>
                <p>Para continuar utilizando este dashboard educativo inteligente, es necesario que acepte el tratamiento de sus datos académicos conforme a nuestra política institucional.</p>
                
                <h3 class="h4" style="margin-top: var(--space-4);">1. Información Recopilada</h3>
                <p>Procesamos información sobre su cursada, incluyendo materiales de clase (transcripciones, presentaciones), tareas y actividades en el chat RAG para personalizar su experiencia de aprendizaje.</p>
                
                <h3 class="h4" style="margin-top: var(--space-4);">2. Uso de IA Generativa</h3>
                <p>Utilizamos modelos de Azure OpenAI para generar resúmenes y responder consultas. Sus datos están protegidos bajo protocolos de seguridad de nivel empresarial (Zero-Trust) y no se utilizan para entrenar modelos públicos externos.</p>
                
                <h3 class="h4" style="margin-top: var(--space-4);">3. Sus Derechos</h3>
                <p>Usted mantiene el derecho de acceso, rectificación y eliminación de sus datos personales conforme a las normativas vigentes en la República Argentina y las políticas internas de UADE.</p>
                
                <div class="alert alert-info" style="margin-top: var(--space-4);">
                    <p style="margin: 0; font-size: 0.9rem;">Al hacer clic en "Aceptar y Continuar", usted confirma que ha leído y acepta los términos anteriores.</p>
                </div>
            </div>
            
            <div class="modal-footer" style="border-top: 1px solid var(--color-border); padding-top: var(--space-4); margin-top: var(--space-4); display: flex; justify-content: flex-end; gap: var(--space-3);">
                <button id="privacy-accept-btn" class="btn btn-primary btn-lg">Aceptar y Continuar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalOverlay);

    // Interaction logic
    const acceptBtn = document.getElementById('privacy-accept-btn');
    acceptBtn.addEventListener('click', async () => {
        acceptBtn.disabled = true;
        acceptBtn.innerHTML = 'Procesando...';
        
        const success = await auth.acceptPrivacyPolicy();
        if (success) {
            modalOverlay.classList.replace('animate-in', 'animate-out');
            setTimeout(() => {
                modalOverlay.remove();
            }, 300);
        } else {
            acceptBtn.disabled = false;
            acceptBtn.innerHTML = 'Aceptar y Continuar';
            alert('Hubo un error al guardar su preferencia. Por favor, reintente.');
        }
    });

    // Disable background scrolling while modal is open
    document.body.style.overflow = 'hidden';
    
    // Clean up scroll on remove
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
}
