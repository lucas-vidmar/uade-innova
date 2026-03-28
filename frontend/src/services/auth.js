/* ============================================================
   Auth Service — Mock SSO for local development
   ============================================================ */
import { api } from './api.js';

const LOCAL_SUBJECTS_KEY = 'uade.local.subjects';

const USERS = {
    student: {
        id: 'alu-001',
        name: 'Valentina Rodríguez',
        email: 'valentina.rodriguez@uade.edu.ar',
        role: 'student',
        avatar: 'VR',
        subjects: [
            { id: 'arq-software-2026', name: 'Arquitecturas de Software (2026-1)' },
            { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas (2026-1)' }
        ],
    },
    teacher: {
        id: 'doc-001',
        name: 'Dr. Martín Ferreiro',
        email: 'mferreiro@uade.edu.ar',
        role: 'teacher',
        avatar: 'MF',
        subjects: [
            { id: 'arq-software-2026', name: 'Arquitecturas de Software (2026-1)' },
            { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas (2026-1)' }
        ],
    },
    director: {
        id: 'dir-001',
        name: 'Prof. Ana Belgrano',
        email: 'abelgrano@uade.edu.ar',
        role: 'director',
        avatar: 'AB',
        department: 'Ingeniería en Informática',
        subjects: [
            { id: 'arq-software-2026', name: 'Arquitecturas de Software (2026-1)' },
            { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas (2026-1)' }
        ],
    },
};

export const auth = {
    getUser() {
        const role = sessionStorage.getItem('edu_role') || 'student';
        const baseUser = USERS[role] || USERS.student;
        return {
            ...baseUser,
            subjects: mergeSubjectsWithLocal(baseUser.subjects || []),
        };
    },

    setRole(role) {
        if (USERS[role]) {
            sessionStorage.setItem('edu_role', role);

            // Default active subject for UI
            const user = this.getUser();
            if (user.subjects && user.subjects.length > 0) {
                sessionStorage.setItem('edu_active_subject', user.subjects[0].id);
            }

            window.dispatchEvent(new CustomEvent('auth:roleChanged', { detail: { role } }));
        }
    },

    getActiveSubjectId() {
        const user = this.getUser();
        if (!user.subjects || user.subjects.length === 0) return null;
        return sessionStorage.getItem('edu_active_subject') || user.subjects[0].id;
    },

    setActiveSubjectId(subjectId) {
        sessionStorage.setItem('edu_active_subject', subjectId);
        window.dispatchEvent(new CustomEvent('auth:subjectChanged', { detail: { subjectId } }));
    },

    getRole() {
        return sessionStorage.getItem('edu_role') || 'student';
    },

    isLoggedIn() {
        return sessionStorage.getItem('edu_logged_in') !== 'false';
    },

    getConsentAccepted() {
        return localStorage.getItem('edu_consent_accepted') === 'true' || sessionStorage.getItem('edu_consent_accepted') === 'true';
    },

    async acceptPrivacyPolicy() {
        const user = this.getUser();
        const profile = {
            theme: sessionStorage.getItem('edu_theme') || 'light',
            language: sessionStorage.getItem('edu_lang') || 'es',
            consentAccepted: true
        };
        
        // Persist locally immediately to handle offline/dev modes
        localStorage.setItem('edu_consent_accepted', 'true');
        sessionStorage.setItem('edu_consent_accepted', 'true');
        window.dispatchEvent(new CustomEvent('auth:consentAccepted'));

        try {
            await api.saveProfile(profile);
            return true;
        } catch (err) {
            console.error('Error saving privacy consent to backend:', err);
            // We return true if in localhost because we've already persisted locally
            return window.location.hostname === 'localhost';
        }
    },

    isAuthenticated() {
        // En desarrollo local (Vite lo inyecta), permitimos el bypass. 
        // En build de producción real, esto obligaría a fallar si no hay SSO real.
        const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
        return isDev;
    },

    async logout() {
        console.log('[Auth] Logging out...');
        sessionStorage.clear();
        // SWA standard logout endpoint
        window.location.href = '/.auth/logout?post_logout_redirect_uri=/';
    },

    mockLogout() {
        sessionStorage.setItem('edu_logged_in', 'false');
        window.dispatchEvent(new CustomEvent('auth:loggedOut'));
    },

    mockLoginAs(role) {
        if (!USERS[role]) return;
        sessionStorage.setItem('edu_logged_in', 'true');
        this.setRole(role);
    },

    async initAuth() {
        try {
            const response = await fetch('/.auth/me');
            if (response.ok) {
                const payload = await response.json();
                const clientPrincipal = payload.clientPrincipal;
                if (clientPrincipal) {
                    // Extract roles and map to internal ones
                    const isDocente = clientPrincipal.userRoles.includes('Docente');
                    const isDirector = clientPrincipal.userRoles.includes('Director');
                    
                    let role = 'student';
                    if (isDirector) role = 'director';
                    else if (isDocente) role = 'teacher';
                    
                    // Enrich our internal fallback user with the real name/email
                    USERS[role].name = clientPrincipal.userDetails;
                    USERS[role].email = clientPrincipal.userDetails;
                    
                    // We don't trigger events here to avoid race conditions on boot.
                    // Just set state silently initially.
                    sessionStorage.setItem('edu_role', role);
                    sessionStorage.setItem('edu_logged_in', 'true');
                    
                    // Sync subjects from backend
                    try {
                        const subjects = await api.getSubjects();
                        USERS[role].subjects = subjects;
                    } catch (err) {
                        console.error('Error fetching enrolled subjects:', err);
                    }

                    const user = USERS[role];
                    if (user.subjects && user.subjects.length > 0 && !sessionStorage.getItem('edu_active_subject')) {
                        sessionStorage.setItem('edu_active_subject', user.subjects[0].id);
                    }

                    // Sync profile and consent
                    try {
                        const profile = await api.getProfile();
                        const accepted = profile.consentAccepted ? 'true' : 'false';
                        sessionStorage.setItem('edu_consent_accepted', accepted);
                        localStorage.setItem('edu_consent_accepted', accepted);
                        sessionStorage.setItem('edu_theme', profile.theme);
                        sessionStorage.setItem('edu_lang', profile.language);
                    } catch (err) {
                        console.error('Error fetching user profile:', err);
                    }
                    
                    return true;
                }
            }
        } catch (error) {
            console.warn('SWA Auth no alcanzado, modo local activado.', error);
        }
        
        // Fallback local
        if (!sessionStorage.getItem('edu_role')) {
             sessionStorage.setItem('edu_role', 'student');
             sessionStorage.setItem('edu_active_subject', USERS.student.subjects[0].id);
        }
        if (!sessionStorage.getItem('edu_logged_in')) {
            sessionStorage.setItem('edu_logged_in', 'true');
        }
        return false;
    }
};

function mergeSubjectsWithLocal(baseSubjects) {
    const base = Array.isArray(baseSubjects) ? baseSubjects : [];
    let local = [];

    try {
        const raw = localStorage.getItem(LOCAL_SUBJECTS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        local = Array.isArray(parsed) ? parsed : [];
    } catch {
        local = [];
    }

    const byId = new Map();
    base.forEach((subject) => {
        if (subject?.id) byId.set(subject.id, subject);
    });
    local.forEach((subject) => {
        if (subject?.id) byId.set(subject.id, { ...(byId.get(subject.id) || {}), ...subject });
    });

    return Array.from(byId.values());
}
