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
        subject: 'Arquitecturas de Software (2026-1)',
        subjectId: 'arq-software-2026',
    },
    teacher: {
        id: 'doc-001',
        name: 'Dr. Martín Ferreiro',
        email: 'mferreiro@uade.edu.ar',
        role: 'teacher',
        avatar: 'MF',
        subject: 'Arquitecturas de Software (2026-1)',
        subjectId: 'arq-software-2026',
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
            window.dispatchEvent(new CustomEvent('auth:roleChanged', { detail: { role } }));
        }
    },

    getRole() {
        return sessionStorage.getItem('edu_role') || 'student';
    },

    isAuthenticated() {
        return true; // mock: always authenticated
    },
};
