/* ============================================================
   Auth Service — Mock SSO for local development
   ============================================================ */

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
    },
};

export const auth = {
    getUser() {
        const role = sessionStorage.getItem('edu_role') || 'student';
        return USERS[role] || USERS.student;
    },

    setRole(role) {
        if (USERS[role]) {
            sessionStorage.setItem('edu_role', role);

            // Default active subject for UI
            const user = USERS[role];
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

    isAuthenticated() {
        // En desarrollo local (Vite lo inyecta), permitimos el bypass. 
        // En build de producción real, esto obligaría a fallar si no hay SSO real.
        const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
        return isDev;
    },
};
