/* ============================================================
   Auth Service — Microsoft-account sign-in (SWA EasyAuth) +
   DEV-only mock fallback for local development (Story 1.1a)
   ============================================================ */
import { api } from './api.js';
import { enrollments as enrollmentService } from './enrollments.js';
import { safeSetItem, safeGetItem } from './local-storage.js';
import { mergeSubjectsWithLocal, DEFAULT_SUBJECT } from './subjects.api.js';

const AI_CONSENT_KEY = 'edu_ai_consent_accepted';

const CORRELATION_HEADER = 'x-correlation-id';
const TRACEPARENT_HEADER = 'traceparent';

/**
 * True when client-side mock identities are allowed. The mock surface (demo
 * role switcher, mock students, setRole) must NEVER be reachable in a production
 * build: role/email come from the server-resolved allowlist only (Story 1.1a).
 */
export function isDevMockEnabled() {
    try {
        return import.meta.env.DEV || import.meta.env.VITE_MOCK_AUTH_ENABLED === 'true';
    } catch {
        return false;
    }
}

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

// ── DEV-only mock identities. Never used to authorize production requests;
//    the server derives role/scope from the allowlist, never from here. ─────
// Exported so admin surfaces can render the static pilot allowlist when the
// remote `/api/manage/users` list is empty/unreachable.
export const USERS = {
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

// Server-synced subjects for the current session (in-memory; never a role source).
let _subjectsCache = [];

function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'UI';
    return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

export const auth = {
    getUser() {
        const role = sessionStorage.getItem('edu_role') || 'student';
        const email = sessionStorage.getItem('edu_email') || '';
        const name = sessionStorage.getItem('edu_name') || '';

        // DEV mock identity (never used for production authorization).
        if (isDevMockEnabled()) {
            const studentKey = role === 'student'
                ? (sessionStorage.getItem('edu_student_key') || 'student')
                : role;
            const baseUser = USERS[studentKey] || USERS[role] || USERS.student;
            return {
                ...baseUser,
                subjects: mergeSubjectsWithLocal(baseUser.subjects || []),
                enrollments: enrollmentService.getCachedEnrollments(),
            };
        }

        // Production: profile resolved by the server from the allowlist.
        const base = USERS[role];
        const displayName = name || email || base?.name || 'Usuario';
        return {
            id: `u-${String(email || role).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64) || role}`,
            name: displayName,
            email,
            role,
            avatar: initialsOf(displayName),
            subjects: mergeSubjectsWithLocal(_subjectsCache),
            enrollments: enrollmentService.getCachedEnrollments(),
        };
    },

    setRole(role) {
        if (!isDevMockEnabled()) return;
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
        if (!user.subjects || user.subjects.length === 0) return DEFAULT_SUBJECT.id;
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
            if (isDevMockEnabled()) {
                try {
                    localStorage.setItem(AI_CONSENT_KEY, 'true');
                } catch {
                    sessionStorage.setItem(AI_CONSENT_KEY, 'true');
                }
                window.dispatchEvent(new CustomEvent('auth:aiConsentAccepted'));
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
            // We return true if in dev because we've already persisted locally
            return isDevMockEnabled();
        }
    },

    isAuthenticated() {
        const loggedIn = sessionStorage.getItem('edu_logged_in');
        if (loggedIn === 'false') return false;
        return true;
    },

    isAccessDenied() {
        return sessionStorage.getItem('edu_access_denied') === 'true';
    },

    async logout() {
        console.log('[Auth] Logging out...');
        sessionStorage.clear();
        // SWA standard logout endpoint
        window.location.href = '/.auth/logout?post_logout_redirect_uri=/';
    },

    /**
     * Signs out the current session, using the real SWA endpoint in production
     * and the local mock path in dev.
     */
    performLogout() {
        if (isDevMockEnabled()) {
            sessionStorage.setItem('edu_logged_in', 'false');
            window.dispatchEvent(new CustomEvent('auth:loggedOut'));
            window.location.reload();
            return;
        }
        this.logout();
    },

    mockLogout() {
        if (!isDevMockEnabled()) return;
        sessionStorage.setItem('edu_logged_in', 'false');
        window.dispatchEvent(new CustomEvent('auth:loggedOut'));
    },

    mockLoginAs(roleOrKey) {
        if (!isDevMockEnabled()) return;
        const key = STUDENT_KEYS.includes(roleOrKey) ? roleOrKey : (USERS[roleOrKey] ? roleOrKey : null);
        if (!key) return;
        try {
            localStorage.setItem('uade_use_mock', 'true');
        } catch {}
        sessionStorage.setItem('edu_logged_in', 'true');
        this.setRole(key);
    },

    getMockStudents() {
        if (!isDevMockEnabled()) return [];
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

    /**
     * Initializes the session:
     *  - Production: reads `/.auth/me` (SWA EasyAuth). Unauthenticated users are
     *    redirected to Microsoft sign-in (`/.auth/login/aad`) — never a dead-end.
     *    The role/scope are resolved from the SERVER profile (allowlist); a
     *    denied identity is flagged for the access-denied page.
     *  - Dev: falls back to the local mock session (never in production).
     */
    async initAuth() {
        let authenticated = false;
        let email = null;
        let principal = null;

        try {
            const response = await fetch('/.auth/me', { headers: correlationHeaders(), credentials: 'include' });
            if (response.ok) {
                const payload = await response.json();
                const clientPrincipal = payload.clientPrincipal;
                if (clientPrincipal && clientPrincipal.userId) {
                    principal = clientPrincipal;
                    authenticated = true;
                    email = String(clientPrincipal.userDetails || '').trim() || null;
                    try {
                        if (email) sessionStorage.setItem('edu_email', email);
                        if (clientPrincipal.userDetails) sessionStorage.setItem('edu_name', clientPrincipal.userDetails);
                    } catch (_) {}
                    sessionStorage.setItem('edu_logged_in', 'true');
                }
            }
        } catch (error) {
            console.warn('SWA Auth no alcanzado.', error);
        }

        if (!authenticated) {
            if (isDevMockEnabled()) {
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
                // Offer Microsoft-account sign-in instead of a dead-end (QA-001).
                emitAuthFallbackBlocked();
                const returnUrl = encodeURIComponent(window.location.href);
                window.location.assign(`/.auth/login/aad?post_login_redirect_uri=${returnUrl}`);
                return false;
            }
        }

        // ── Resolve role/scope from the SERVER profile (allowlist) ──────────
        // The browser never chooses its role or email; only the server's
        // allowlist-derived profile may set them (Story 1.1a).
        try {
            const profile = await api.getProfile();
            if (profile) {
                const accepted = profile.consentAccepted ? 'true' : 'false';
                sessionStorage.setItem('edu_consent_accepted', accepted);
                safeSetItem('edu_consent_accepted', accepted);
                if (profile.theme) sessionStorage.setItem('edu_theme', profile.theme);
                if (profile.language) sessionStorage.setItem('edu_lang', profile.language);
            }

            if (profile && profile.role) {
                sessionStorage.setItem('edu_role', profile.role);
                sessionStorage.removeItem('edu_access_denied');
                if (profile.email) sessionStorage.setItem('edu_email', profile.email);
                if (profile.name) sessionStorage.setItem('edu_name', profile.name);
                if (profile.scope && Array.isArray(profile.scope.subjects)) {
                    sessionStorage.setItem('edu_scope_subjects', JSON.stringify(profile.scope.subjects));
                }
            } else if (profile && profile.code === 'ACCESS_DENIED') {
                // Server explicitly denied this identity (403 semantics).
                sessionStorage.setItem('edu_access_denied', 'true');
            } else if (!isDevMockEnabled() && !profile) {
                // Production with no server-resolved role and no explicit denial:
                // transient error — do NOT lock the user out; keep session usable.
                console.warn('[Auth] Sin rol del servidor (posible error transitorio), continuando con sesión.');
            }
        } catch (err) {
            console.error('[Auth] Error resolving server profile:', err);
            // Only a 403/ACCESS_DENIED is a hard denial. Network/5xx errors are
            // transient — do not bounce a valid user to the access-denied page.
            const denied = err?.code === 'ACCESS_DENIED' || err?.status === 403;
            if (denied && !isDevMockEnabled()) {
                sessionStorage.setItem('edu_access_denied', 'true');
            }
        }

        if (auth.isAccessDenied()) {
            sessionStorage.setItem('edu_logged_in', 'true');
            return true;
        }

        const user = this.getUser();
        const userId = user.id;
        try {
            sessionStorage.setItem('edu_uid', userId);
        } catch (_) {}

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
                _subjectsCache = subjects;
                const currentRole = this.getRole();
                if (isDevMockEnabled()) {
                    USERS[currentRole].subjects = subjects;
                }

                const activeId = this.getActiveSubjectId();
                const enrolledSubjects = this.getEnrolledSubjects();
                if (activeId && !enrolledSubjects.some(s => s.id === activeId) && enrolledSubjects.length > 0) {
                    sessionStorage.setItem('edu_active_subject', enrolledSubjects[0].id);
                }
            }
        } catch (err) {
            console.error('Error fetching enrolled subjects:', err);
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
