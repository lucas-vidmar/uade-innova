/* ============================================================
   Auth Service — email+password login (app-owned Users table) +
   DEV-only mock fallback for local development (Story 1.1a/1.4/1.5)

   Production authenticates against `/api/auth/login` and holds an opaque
   session token in sessionStorage (`edu_token`) sent as `Authorization: Bearer`.
   Role/scope are resolved by the SERVER from the Users + Enrollments tables —
   the browser never chooses its own role or email.
   ============================================================ */
import { api } from './api.js';
import { enrollments as enrollmentService } from './enrollments.js';
import { safeSetItem, safeGetItem } from './local-storage.js';
import { mergeSubjectsWithLocal, DEFAULT_SUBJECT } from './subjects.api.js';
import { themeManager } from './theme.js';
import { hydrateOnboardingRecord } from './onboarding.js';

const AI_CONSENT_KEY = 'edu_ai_consent_accepted';
const SESSION_TOKEN_KEY = 'edu_token';

// Fix #361 (UJ-03): claves de UI guardadas por dispositivo, sin dueño. En un
// equipo compartido sobreviven al cierre de sesión y la siguiente persona las
// hereda (tema, preferencias del asistente, caché de consentimiento). Se
// limpian al cerrar sesión; lo que corresponde al usuario se rehidrata desde su
// perfil del servidor en el próximo ingreso.
const DEVICE_SCOPED_KEYS = [
    'uade_innova_theme',
    'edu_bot_tone',
    'edu_bot_length',
    'edu_bot_include_sources',
    'edu_ai_consent_accepted',
    'edu_consent_accepted',
    'edu_last_visit',
    'uade.processing.tracked-jobs',
    'uade.local.classes-by-subject',
];

/**
 * True when client-side mock identities are allowed (dev / preview only). The
 * mock surface (demo role switcher, mock students, setRole) must NEVER be
 * reachable in a production build: role/email come from the server-resolved
 * Users/Enrollments tables only.
 */
export function isDevMockEnabled() {
    try {
        return import.meta.env.DEV || import.meta.env.VITE_MOCK_AUTH_ENABLED === 'true';
    } catch {
        return false;
    }
}

function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'UI';
    return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

// ── DEV-only mock identities. Never used to authorize production requests;
//    the server derives role/scope from Users/Enrollments, never from here. ─────
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

        // Production: identity resolved by the server (Users table) and cached
        // in sessionStorage after login / initAuth.
        const uid = sessionStorage.getItem('edu_uid') || '';
        const displayName = name || email || 'Usuario';
        return {
            id: uid || `u-${String(email || role).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64) || role}`,
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
        // Fail closed (fix #342): no default role. Callers (router) must treat
        // a missing role as unauthenticated and land on #/login instead of
        // rendering the student shell by default.
        return sessionStorage.getItem('edu_role') || null;
    },

    isLoggedIn() {
        // Fail closed (fix #342): a missing flag means logged OUT. The old
        // `!== 'false'` check treated a fresh tab (no flag) as authenticated.
        return sessionStorage.getItem('edu_logged_in') === 'true';
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

    /**
     * Persiste las preferencias del asistente en UserProfiles (story 11-5-1).
     * localStorage se mantiene como cache/fallback; el servidor es la fuente
     * durable para que sobrevivan cambio de dispositivo o limpieza del browser.
     * @returns {Promise<boolean>} true si el backend confirmó el guardado.
     */
    async saveBotPreferences(prefs) {
        this.setBotPreferences(prefs);
        try {
            await api.saveProfile({
                botTone: prefs.tone,
                botLength: prefs.length,
                includeSources: prefs.includeSources,
            });
            return true;
        } catch (err) {
            console.error('[Auth] Error persistiendo preferencias del asistente al backend:', err);
            return false;
        }
    },

    /**
     * Hidrata las preferencias del asistente desde el perfil de UserProfiles
     * (story 11-5-1) cuando el servidor trae valores.
     */
    hydrateBotPreferences(profile) {
        if (!profile) return;
        const tone = profile.botTone || profile.bot_tone;
        const length = profile.botLength || profile.bot_length;
        const includeSources = profile.includeSources ?? profile.include_sources;
        if (tone) localStorage.setItem('edu_bot_tone', tone);
        if (length) localStorage.setItem('edu_bot_length', length);
        if (includeSources !== undefined && includeSources !== null) localStorage.setItem('edu_bot_include_sources', String(Boolean(includeSources)));
        window.dispatchEvent(new CustomEvent('auth:botPrefsChanged', {
            detail: { tone, length, includeSources: Boolean(includeSources) },
        }));
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
            // UJ-35: la franja horaria y la decisión por fecha también son de la
            // persona; se cachean para que la UI no las pierda entre vistas.
            if (prefs.timeWindow) sessionStorage.setItem('edu_reminder_time_window', prefs.timeWindow);
            if (prefs.datePrefs && typeof prefs.datePrefs === 'object') {
                sessionStorage.setItem('edu_reminder_date_prefs', JSON.stringify(prefs.datePrefs));
            }
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
        // Fail closed (fix #342): only an explicit 'true' counts. A missing
        // flag (fresh tab, cleared storage) is unauthenticated.
        return sessionStorage.getItem('edu_logged_in') === 'true';
    },

    isAccessDenied() {
        return sessionStorage.getItem('edu_access_denied') === 'true';
    },

    /**
     * Clears the local session state. The server session is revoked by the
     * caller (logout()) when the backend is reachable.
     */
    clearSession() {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem('edu_role');
        sessionStorage.removeItem('edu_uid');
        sessionStorage.removeItem('edu_email');
        sessionStorage.removeItem('edu_name');
        sessionStorage.removeItem('edu_access_denied');
        sessionStorage.removeItem('edu_scope_subjects');
        sessionStorage.removeItem('edu_active_subject');
        sessionStorage.setItem('edu_logged_in', 'false');
        // Fix #361 (UJ-03): tampoco debe quedar la UI del dispositivo para la
        // siguiente persona del equipo compartido (tema, preferencias, cachés).
        for (const key of DEVICE_SCOPED_KEYS) {
            try { localStorage.removeItem(key); } catch (_) {}
        }
    },

    /**
     * Persiste el tema elegido en el perfil del usuario (UserProfiles) además de
     * la caché local, para que viaje entre equipos y no dependa del dispositivo.
     * Fix #361 (UJ-03).
     * @param {string} theme 'light' | 'dark'
     * @returns {Promise<boolean>} true si el servidor confirmó el guardado.
     */
    async saveThemePreference(theme) {
        if (!theme) return false;
        try {
            sessionStorage.setItem('edu_theme', theme);
        } catch (_) {}
        try {
            await api.saveProfile({ theme });
            return true;
        } catch (err) {
            console.warn('[Auth] No se pudo persistir el tema en el perfil:', err?.message || err);
            return false;
        }
    },

    /**
     * Logs out: revokes the server session (best-effort), clears local state
     * and lands on the login page.
     */
    async logout() {
        console.log('[Auth] Logging out...');
        const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
        if (token && !isDevMockEnabled()) {
            try {
                await api.logout();
            } catch (err) {
                console.warn('[Auth] Server logout failed (clearing locally):', err);
            }
        }
        this.clearSession();
        window.dispatchEvent(new CustomEvent('auth:loggedOut'));
        window.location.hash = '#/login';
    },

    /**
     * Signs out the current session (mock in dev, server session in production).
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

    /**
     * Server-resolved subject scope cached at login/profile time (#332).
     * Survives reloads (sessionStorage) unlike the in-memory subject cache,
     * and unlike the enrollment cache it does not depend on a fresh fetch.
     * @returns {string[]} subject ids from the last server-resolved scope.
     */
    getScopeSubjectIds() {
        try {
            const raw = sessionStorage.getItem('edu_scope_subjects');
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter(s => typeof s === 'string' && s.length > 0) : [];
        } catch {
            return [];
        }
    },

    getEnrolledSubjects() {
        const role = this.getRole();
        const user = this.getUser();
        const enrollmentData = enrollmentService.getCachedEnrollments();

        if (!enrollmentData || enrollmentData.length === 0) {
            // #332: after a reload the enrollment cache may still be cold while
            // the server-resolved scope from login()/resolveServerProfile sits
            // in sessionStorage. Fall back to that scope intersected with the
            // known subjects — never to the full subject list — so a valid
            // session rehydrates instead of fail-closing to an empty dashboard.
            if (role === 'teacher' || role === 'student') {
                const scoped = this.getScopeSubjectIds();
                if (scoped.length > 0) {
                    const scopedSubjects = (user.subjects || []).filter(s => scoped.includes(s.id));
                    if (scopedSubjects.length > 0) return scopedSubjects;
                }
            }
            // Fail-closed for scoped roles: without enrollments a student/teacher sees nothing,
            // director/admin see all. Prevents the leak where a loading/failed fetch showed all 4 subjects.
            if (role === 'director' || role === 'admin') return user.subjects || [];
            return [];
        }

        if (role === 'director' || role === 'admin') {
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
     * Authenticates with email + password against /api/auth/login and stores the
     * opaque session token + server-resolved identity. Role/scope come from the
     * server (Users + Enrollments); the browser never submits them.
     * @returns {Promise<Object>} resolved user
     */
    async login(email, password) {
        const result = await api.login(email, password);
        const { token, user } = result;
        if (!token || !user) {
            throw new Error('El servidor no devolvió una sesión válida.');
        }
        sessionStorage.setItem(SESSION_TOKEN_KEY, token);
        sessionStorage.setItem('edu_logged_in', 'true');
        sessionStorage.setItem('edu_uid', user.id);
        sessionStorage.setItem('edu_role', user.role);
        sessionStorage.setItem('edu_email', user.email);
        sessionStorage.setItem('edu_name', `${user.name || ''} ${user.surname || ''}`.trim());
        if (user.scope && Array.isArray(user.scope.subjects)) {
            sessionStorage.setItem('edu_scope_subjects', JSON.stringify(user.scope.subjects));
        }
        try {
            localStorage.setItem('uade_use_mock', 'false');
        } catch {}

        await this.hydrateSession();
        return user;
    },

    /**
     * Self-service password change: verifies the current password server-side,
     * updates the hash and revokes other sessions.
     * @returns {Promise<boolean>}
     */
    async changePassword(currentPassword, newPassword) {
        await api.changePassword(currentPassword, newPassword);
        return true;
    },

    /**
     * Applies the server profile (role/email/scope + preferences) and loads the
     * user's enrollments/subjects/consent into the session. Shared by login()
     * and initAuth().
     */
    async hydrateSession() {
        const user = this.getUser();
        const userId = user.id;
        try {
            sessionStorage.setItem('edu_uid', userId);
        } catch (_) {}

        try {
            if (userId) {
                await enrollmentService.fetchMyEnrollments(userId);
            }
        } catch (err) {
            console.error('Error fetching enrollment data:', err);
        }

        try {
            const subjects = await api.getSubjects();
            if (Array.isArray(subjects)) {
                _subjectsCache = subjects;
                const currentRole = this.getRole();
                if (isDevMockEnabled() && currentRole && USERS[currentRole]) {
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

        try {
            const prefs = await api.getReminderPreferences();
            if (prefs) {
                sessionStorage.setItem('edu_reminder_enabled', String(prefs.enabled !== false));
                sessionStorage.setItem('edu_reminder_cadence', prefs.cadence || 'both');
            }
        } catch (err) {
            console.error('Error fetching reminder preferences:', err);
        }

        try {
            const consent = await api.getConsent();
            if (consent) {
                // #327 fail-closed sync, backend wins: the local cache must
                // never claim "accepted" while the backend gate says 403.
                // Previously a local-true shadowed backend-false (the exact
                // "Settings shows Aceptado but RAG 403s" symptom).
                const accepted = consent.accepted ? 'true' : 'false';
                try {
                    localStorage.setItem(AI_CONSENT_KEY, accepted);
                } catch {
                    sessionStorage.setItem(AI_CONSENT_KEY, accepted);
                }
            }
        } catch (err) {
            console.error('Error fetching AI consent:', err);
        }
    },

    /**
     * Resolves the server profile (role/email/scope + prefs). Returns the profile
     * object or null. On a hard denial (ACCESS_DENIED) flags edu_access_denied.
     */
    async resolveServerProfile() {
        try {
            const profile = await api.getProfile();
            if (profile) {
                const accepted = profile.consentAccepted ? 'true' : 'false';
                sessionStorage.setItem('edu_consent_accepted', accepted);
                safeSetItem('edu_consent_accepted', accepted);
                if (profile.theme) {
                    sessionStorage.setItem('edu_theme', profile.theme);
                    // Fix #361 (UJ-03): el tema del perfil pertenece a la identidad
                    // activa y manda sobre lo que dejó la persona anterior del equipo.
                    themeManager.applyTheme(profile.theme);
                }
                if (profile.language) sessionStorage.setItem('edu_lang', profile.language);
                this.hydrateBotPreferences(profile);
                // #375: la constancia de la entrada guiada viaja con el perfil.
                hydrateOnboardingRecord({ ...profile, role: profile.role || this.getRole() });
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
                sessionStorage.setItem('edu_access_denied', 'true');
            }
            return profile;
        } catch (err) {
            console.error('[Auth] Error resolving server profile:', err);
            const denied = err?.code === 'ACCESS_DENIED' || err?.status === 403;
            if (denied && !isDevMockEnabled()) {
                sessionStorage.setItem('edu_access_denied', 'true');
            }
            throw err;
        }
    },

    /**
     * Initializes the session:
     *  - Dev: boots the local mock session (never in production).
     *  - Production: requires an opaque session token; resolves role/scope from
     *    the SERVER profile (Users + Enrollments). Without a token returns false
     *    so main.js renders the email/password login form.
     */
    async initAuth() {
        const devMock = isDevMockEnabled();

        if (devMock) {
            // Mock fallback is DEV ONLY — never run in production builds.
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
                localStorage.setItem('uade_use_mock', 'true');
            } catch {}
        } else {
            const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
            if (!token) {
                // Production without a session → render the login form.
                this.clearSession();
                return false;
            }
        }

        // ── Resolve role/scope from the SERVER profile (Users + Enrollments) ──
        let profile = null;
        try {
            profile = await this.resolveServerProfile();
        } catch (err) {
            if (!devMock && (err?.status === 401 || err?.code === 'AUTH_REQUIRED' || err?.code === 'INVALID_SESSION')) {
                // Invalid/expired session in production: force re-login.
                this.clearSession();
                return false;
            }
            // Transient/5xx errors do not lock a valid user out.
            console.warn('[Auth] Sin rol del servidor (posible error transitorio), continuando con sesión.');
        }

        if (this.isAccessDenied()) {
            sessionStorage.setItem('edu_logged_in', 'true');
            return true;
        }

        if (!devMock && profile && (profile.code === 'AUTH_REQUIRED' || profile.code === 'INVALID_SESSION')) {
            this.clearSession();
            return false;
        }

        await this.hydrateSession();
        return true;
    }
};
