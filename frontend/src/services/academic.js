/* ============================================================
   Academic Service — Abstraction for SGA (Grades/Attendance)
   Provides an interface for institutional data with mock fallback.
   ============================================================ */

const USE_MOCK = true;

/* ── Mock Data ───────────────────────────────────────────── */
const MOCK_TASKS = [
    { id: 't-01', title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-03-28', weight: 25, status: 'pending', classIds: ['class-01', 'class-02'], grade: null },
    { id: 't-02', title: 'Quiz Online — Estilos Arquitectónicos', dueDate: '2026-03-20', weight: 10, status: 'completed', classIds: ['class-02'], grade: 8.5 },
    { id: 't-03', title: 'Parcial 1 — Arquitectura y Patrones', dueDate: '2026-04-16', weight: 35, status: 'pending', classIds: ['class-01', 'class-02', 'class-03', 'class-04'], grade: null },
    { id: 't-04', title: 'Lectura: "Clean Architecture" (caps 1-5)', dueDate: '2026-03-19', weight: 5, status: 'completed', classIds: ['class-01'], grade: 10 },
];

const MOCK_EARLY_ALERTS = [
    { id: 'alu-012', name: 'Tomás García', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'high', attendance: '45%', avgGrade: 4.2 },
    { id: 'alu-031', name: 'Lucía Martínez', subjectId: 'diseno-sistemas-2026', subject: 'Sistemas Dist.', risk: 'medium', attendance: '62%', avgGrade: 5.1 },
    { id: 'alu-008', name: 'Nicolás Peralta', subjectId: 'arq-software-2026', subject: 'Arq. de Software', risk: 'medium', attendance: '70%', avgGrade: 5.8 },
];

/* ── Helpers ─────────────────────────────────────────────── */
function delay(ms = 400) { return new Promise(r => setTimeout(r, ms)); }

/* ── Academic Client ─────────────────────────────────────── */
export const academic = {
    /**
     * Obtiene las tareas y notas de un alumno.
     * @param {string} studentId 
     * @returns {Promise<Array>}
     */
    async getTasks(studentId) {
        if (USE_MOCK) {
            await delay();
            return MOCK_TASKS;
        }
        // Placeholder for real SGA API integration
        return [];
    },

    /**
     * Obtiene las alertas tempranas de alumnos en riesgo.
     * @param {string} subjectId 
     * @returns {Promise<Array>}
     */
    async getEarlyAlerts(subjectId) {
        if (USE_MOCK) {
            await delay();
            return subjectId 
                ? MOCK_EARLY_ALERTS.filter(a => a.subjectId === subjectId)
                : MOCK_EARLY_ALERTS;
        }
        // Placeholder for real SGA Risk API integration
        return [];
    },

    /**
     * Obtiene estadísticas de asistencia agregadas.
     * @param {string} subjectId 
     * @returns {Promise<object>}
     */
    async getAttendanceStats(subjectId) {
        if (USE_MOCK) {
            await delay();
            return {
                average: 78,
                critical: 3,
                trend: 'stable'
            };
        }
        return { average: 0, critical: 0, trend: 'none' };
    }
};
