/* ============================================================
   Auth Service — Mock SSO for local development
   ============================================================ */
import { api } from './api.js';
import { enrollments as enrollmentService } from './enrollments.js';
import { safeSetItem, safeGetItem } from './local-storage.js';
import { mergeSubjectsWithLocal } from './subjects.api.js';

const AI_CONSENT_KEY = 'edu_ai_consent_accepted';

const CORRELATION_HEADER = 'x-correlation-id';
const TRACEPARENT_HEADER = 'traceparent';

function generateSpanId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function generateTraceParent() {
    const traceId = crypto.randomUUID().replace(/-/g, '').toLowerCase().padEnd(32, '0').slice(0, 32);
    const spanId = generateSpanId();
    return `00-${traceId}-${spanId}-01`;
}

function correlationHeaders() {
    const headers = new Headers();
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        headers.set(CORRELATION_HEADER, crypto.randomUUID());
        headers.set(TRACEPARENT_HEADER, generateTraceParent());
    } else {
        const ts = Date.now();
        headers.set(CORRELATION_HEADER, `corr-${ts}-${Math.random().toString(16).slice(2)}`);
        headers.set(TRACEPARENT_HEADER, `00-${ts.toString(16).padEnd(32, '0')}-${Math.random().toString(16).slice(2, 18)}-01`);
    }
    return headers;
}

function getApiBaseUrl() {
    const configured = (typeof import.meta !== 'undefined' && import.meta.env)
        ? String(import.meta.env.VITE_API_BASE_URL || '').trim()
        : '';
    if (configured) return configured;
    const isLocalRuntime = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return isLocalRuntime ? 'http://localhost:7071/api' : '/api';
}

function emitAuthFallbackBlocked() {
    try {
        const payload = JSON.stringify({
            url: window.location.href,
            correlationId: sessionStorage.getItem('x-correlation-id') || undefined,
            timestamp: new Date().toISOString(),
        });
        const url = `${getApiBaseUrl()}/telemetry/auth-fallback-blocked`;
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            credentials: 'omit',
            keepalive: true,
        }).catch(() => {});
    } catch (_) {}
}

const USERS = {
    student: {
        id: 'alu-001',
        name: 'Lucas Vidmar',
        email: 'lvidmar@uade.edu.ar',
        role: 'student',
        avatar: 'LV',
        subjects: [],
    },
    'student-002': {
        id: 'alu-002',
        name: 'María González',
        email: 'mgonzalez@uade.edu.ar',
        role: 'student',
        avatar: 'MG',
        subjects: [],
    },
    'student-003': {
        id: 'alu-003',
        name: 'Carlos Mendoza',
        email: 'cmendoza@uade.edu.ar',
        role: 'student',
        avatar: 'CM',
        subjects: [],
    },
    'student-004': {
        id: 'alu-004',
        name: 'Sofía Ramírez',
        email: 'sramirez@uade.edu.ar',
        role: 'student',
        avatar: 'SR',
        subjects: [],
    },
    'student-005': {
        id: 'alu-005',
        name: 'Tomás Herrera',
        email: 'therrera@uade.edu.ar',
        role: 'student',
        avatar: 'TH',
        subjects: [],
    },
    teacher: {
        id: 'doc-001',
        name: 'Profesor Xavier',
        email: 'xavier@uade.edu.ar',
        role: 'teacher',
        avatar: 'PX',
        subjects: [],
    },
    director: {
        id: 'dir-001',
        name: 'Joaquín García',
        email: 'jgarciag@uade.edu.ar',
        role: 'director',
        avatar: 'JG',
        department: 'Ingeniería en Informática',
        subjects: [],
    },
    admin: {
        id: 'adm-001',
        name: 'Admin Técnico',
        email: 'admin@uade.edu.ar',
        role: 'admin',
        avatar: 'AT',
        subjects: [],
    },
};

const STUDENT_KEYS = ['student', 'student-002', 'student-003', 'student-004', 'student-005'];

export const auth = {
    getUser() {
        const role = sessionStorage.getItem('edu_role') || 'student';
        let baseUser;
        if (role === 'student') {
            const studentKey = sessionStorage.getItem('edu_student_key') || 'student';
            baseUser = USERS[studentKey] || USERS.student;
        } else {
            baseUser = USERS[role] || USERS.student;
        }
        return {
            ...baseUser,
            subjects: mergeSubjectsWithLocal(baseUser.subjects || []),
            enrollments: enrollmentService.getCachedEnrollments(),
        };
    },

    setRole(role) {
        if (USERS[role] || STUDENT_KEYS.includes(role)) {
            if (STUDENT_KEYS.includes(role)) {
                sessionStorage.setItem('edu_role', 'student');
                sessionStorage.setItem('edu_student_key', role);
            } else {
                sessionStorage.setItem('edu_role', role);
                sessionStorage.removeItem('edu_student_key');
            }
            const uid = USERS[role]?.id || (STUDENT_KEYS.includes(role) ? USERS[role]?.id : null) || USERS.student.id;
            sessionStorage.setItem('edu_uid', uid);

            const user = this.getUser();
            if (user.subjects && user.subjects.length > 0) {
                sessionStorage.setItem('edu_active_subject', user.subjects[0].id);
            }

            window.dispatchEvent(new CustomEvent('auth:roleChanged', { detail: { role } }));
        }
    },

    getActiveSubjectId() {
        const storedSubjectId = sessionStorage.getItem('edu_active_subject');
        if (storedSubjectId) return storedSubjectId;
        const user = this.getUser();
        if (!user.subjects || user.subjects.length === 0) return null;
        return user.subjects[0].id;
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

    getBotPreferences() {
        return {
            tone: localStorage.getItem('edu_bot_tone') || 'formal',
            length: localStorage.getItem('edu_bot_length') || 'detailed',
            includeSources: localStorage.getItem('edu_bot_include_sources') !== 'false',
        };
    },

    setBotPreferences(prefs) {
        if (prefs.tone) localStorage.setItem('edu_bot_tone', prefs.tone);
        if (prefs.length) localStorage.setItem('edu_bot_length', prefs.length);
        if (prefs.includeSources !== undefined) localStorage.setItem('edu_bot_include_sources', String(prefs.includeSources));
        window.dispatchEvent(new CustomEvent('auth:botPrefsChanged', { detail: prefs }));
    },

    getReminderPreferences() {
            return {
                enabled: sessionStorage.getItem('edu_reminder_enabled') !== 'false',
                cadence: sessionStorage.getItem('edu_reminder_cadence') || 'both',
            };
        },

    setReminderPreferences(prefs) {
            if (prefs.enabled !== undefined) sessionStorage.setItem('edu_reminder_enabled', String(prefs.enabled));
            if (prefs.cadence) sessionStorage.setItem('edu_reminder_cadence', prefs.cadence);
            window.dispatchEvent(new CustomEvent('auth:reminderPrefsChanged', { detail: prefs }));
        },

    getConsentAccepted() {
        return safeGetItem('edu_consent_accepted') === 'true' || sessionStorage.getItem('edu_consent_accepted') === 'true';
    },

    getAIConsentAccepted() {
        try {
            return localStorage.getItem(AI_CONSENT_KEY) === 'true' || sessionStorage.getItem(AI_CONSENT_KEY) === 'true';
        } catch {
            return false;
        }
    },

    async acceptAIConsent() {
        try {
            await api.saveConsent(true);
            try {
                localStorage.setItem(AI_CONSENT_KEY, 'true');
            } catch {
                sessionStorage.setItem(AI_CONSENT_KEY, 'true');
            }
            window.dispatchEvent(new CustomEvent('auth:aiConsentAccepted'));
            return true;
        } catch (err) {
            console.error('[Auth] Error saving AI consent:', err);
            if (window.location.hostname === 'localhost') {
                try {
                    localStorage.setItem(AI_CONSENT_KEY, 'true');
                } catch {
                    sessionStorage.setItem(AI_CONSENT_KEY, 'true');
                }
                return true;
            }
            return false;
        }
    },

    async revokeAIConsent() {
        try {
            await api.saveConsent(false);
        } catch (err) {
            console.error('[Auth] Error revoking AI consent on backend:', err);
            return false;
        }
        try {
            localStorage.setItem(AI_CONSENT_KEY, 'false');
        } catch {
            sessionStorage.setItem(AI_CONSENT_KEY, 'false');
        }
        window.dispatchEvent(new CustomEvent('auth:aiConsentRevoked'));
        return true;
    },

    async acceptPrivacyPolicy() {
        const user = this.getUser();
        const profile = {
            theme: sessionStorage.getItem('edu_theme') || 'light',
            language: sessionStorage.getItem('edu_lang') || 'es',
            consentAccepted: true
        };
        
        // Persist locally immediately to handle offline/dev modes
        safeSetItem('edu_consent_accepted', 'true');
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
        const loggedIn = sessionStorage.getItem('edu_logged_in');
        if (loggedIn === 'false') return false;
        return true;
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

    mockLoginAs(roleOrKey) {
        const key = STUDENT_KEYS.includes(roleOrKey) ? roleOrKey : (USERS[roleOrKey] ? roleOrKey : null);
        if (!key) return;
        try {
            localStorage.setItem('uade_use_mock', 'true');
        } catch {}
        sessionStorage.setItem('edu_logged_in', 'true');
        this.setRole(key);
    },

    getMockStudents() {
        return STUDENT_KEYS.map(k => ({ ...USERS[k], _key: k })).filter(Boolean);
    },

    getCurrentStudentKey() {
        return sessionStorage.getItem('edu_student_key') || 'student';
    },

    getEnrolledSubjects() {
        const role = this.getRole();
        const user = this.getUser();
        const userId = user.id;
        const enrollmentData = enrollmentService.getCachedEnrollments();
        
        if (!enrollmentData || enrollmentData.length === 0) {
            return user.subjects || [];
        }

        if (role === 'director') {
            return user.subjects || [];
        }

        if (role === 'teacher') {
            const teacherSubjects = enrollmentData
                .filter(e => e.role === 'teacher' && e.status === 'active')
                .map(e => e.subjectId);
            return (user.subjects || []).filter(s => teacherSubjects.includes(s.id));
        }

        const enrolledSubjectIds = enrollmentData
            .filter(e => e.status === 'active')
            .map(e => e.subjectId);
        return (user.subjects || []).filter(s => enrolledSubjectIds.includes(s.id));
    },

    isEnrolled(subjectId) {
        return enrollmentService.isEnrolled(subjectId);
    },

    getEnrollmentRole(subjectId) {
        return enrollmentService.getEnrollmentRole(subjectId);
    },

    async initAuth() {
        let authenticated = false;
        try {
            const response = await fetch('/.auth/me', { headers: correlationHeaders() });
            if (response.ok) {
                const payload = await response.json();
                const clientPrincipal = payload.clientPrincipal;
                if (clientPrincipal) {
                    const isDocente = clientPrincipal.userRoles.includes('Docente');
                    const isDirector = clientPrincipal.userRoles.includes('Director');
                    
                    let role = 'student';
                    if (isDirector) role = 'director';
                    else if (isDocente) role = 'teacher';
                    
                    USERS[role].name = clientPrincipal.userDetails;
                    USERS[role].email = clientPrincipal.userDetails;
                    
                    sessionStorage.setItem('edu_role', role);
                    sessionStorage.setItem('edu_logged_in', 'true');
                    authenticated = true;
                }
            }
        } catch (error) {
            console.warn('SWA Auth no alcanzado.', error);
        }
        
        if (!authenticated) {
            if (import.meta.env.DEV) {
                // Mock fallback is DEV ONLY — never run in production builds.
                console.warn('DEV ONLY: usando sesión mock. No usar en producción.');
                if (!sessionStorage.getItem('edu_role')) {
                     sessionStorage.setItem('edu_role', 'student');
                     sessionStorage.setItem('edu_uid', USERS.student.id);
                     if (USERS.student.subjects.length > 0) {
                         sessionStorage.setItem('edu_active_subject', USERS.student.subjects[0].id);
                     }
                } else if (!sessionStorage.getItem('edu_uid')) {
                    const role = sessionStorage.getItem('edu_role') || 'student';
                    sessionStorage.setItem('edu_uid', USERS[role]?.id || USERS.student.id);
                }
                if (!sessionStorage.getItem('edu_logged_in')) {
                    sessionStorage.setItem('edu_logged_in', 'true');
                }
                try {
                    if (sessionStorage.getItem('edu_logged_in') !== 'false') {
                        localStorage.setItem('uade_use_mock', 'true');
                    }
                } catch {}
                authenticated = true;
            } else {
                // Production: never silently downgrade to a mock session.
                emitAuthFallbackBlocked();
                return false;
            }
        }

        const user = this.getUser();
        const userId = user.id;
        
        // Load enrollment data from Enrollments table
        try {
            if (userId) {
                await enrollmentService.fetchMyEnrollments(userId);
            }
        } catch (err) {
            console.error('Error fetching enrollment data:', err);
        }

        // Sync subjects from backend
        try {
            const subjects = await api.getSubjects();
            if (Array.isArray(subjects)) {
                const currentRole = this.getRole();
                USERS[currentRole].subjects = subjects;
                
                const activeId = this.getActiveSubjectId();
                const enrolledSubjects = this.getEnrolledSubjects();
                if (activeId && !enrolledSubjects.some(s => s.id === activeId) && enrolledSubjects.length > 0) {
                    sessionStorage.setItem('edu_active_subject', enrolledSubjects[0].id);
                }
            }
        } catch (err) {
            console.error('Error fetching enrolled subjects:', err);
        }

        // Sync profile and consent
        try {
            const profile = await api.getProfile();
            if (profile) {
                const accepted = profile.consentAccepted ? 'true' : 'false';
                sessionStorage.setItem('edu_consent_accepted', accepted);
                safeSetItem('edu_consent_accepted', accepted);
                if (profile.theme) sessionStorage.setItem('edu_theme', profile.theme);
                if (profile.language) sessionStorage.setItem('edu_lang', profile.language);
            }
        } catch (err) {
            console.error('Error fetching user profile:', err);
        }

        // Sync reminder preferences from backend
        try {
            const prefs = await api.getReminderPreferences();
            if (prefs) {
                sessionStorage.setItem('edu_reminder_enabled', String(prefs.enabled !== false));
                sessionStorage.setItem('edu_reminder_cadence', prefs.cadence || 'both');
            }
        } catch (err) {
            console.error('Error fetching reminder preferences:', err);
        }

        // Sync AI consent from backend — preserve local accepted consent
        try {
            const consent = await api.getConsent();
            if (consent) {
                const localValue = (() => {
                    try { return localStorage.getItem(AI_CONSENT_KEY); } catch { return null; }
                })();
                if (consent.accepted === false && localValue === 'true') {
                    console.warn(`[Auth] Consent local difiere del backend — se usó valor local: backend=${consent.accepted}, local=${localValue}`);
                } else {
                    const accepted = consent.accepted ? 'true' : 'false';
                    try {
                        localStorage.setItem(AI_CONSENT_KEY, accepted);
                    } catch {
                        sessionStorage.setItem(AI_CONSENT_KEY, accepted);
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching AI consent:', err);
        }

        return authenticated;
    }
};


