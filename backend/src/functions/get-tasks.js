import { validateFrontDoorId, parseClientPrincipal } from '../services/auth-utils.js';
/**
 * get-tasks.js — GET /api/tasks?studentId={id}
 * Retorna las tareas priorizadas del alumno.
 * Mock para el prototipo — estructura lista para conectar a SGA real.
 */
import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';

app.http('get-tasks', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'tasks',
    handler: withCorrelation(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        context.log('get-tasks triggered');

        const studentId = request.query.get('studentId');
        if (!studentId) {
            return {
                status: 400,
                body: JSON.stringify({ error: 'Parámetro requerido: studentId' }),
            };
        }

        // Security Check: Identity validation
        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || 'anonymous';
        const roles = principal?.userRoles || [];
        const isDirector = roles.includes('Director');

        if (!isDirector && studentId !== userId) {
            return {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'No tienes permiso para ver las tareas de otro estudiante.' })
            };
        }

        // ── Mock realista de tareas priorizadas ───────────────────
        // Ordenadas por: peso_académico × días_restantes (menor = más urgente)
        const now = new Date();
        const addDays = (d) => new Date(now.getTime() + d * 86400000).toISOString();

        const tasks = [
            {
                id: 'task-001',
                title: 'Trabajo Práctico N°2 — Patrones de Diseño',
                description: 'Implementar al menos 3 patrones de diseño (GoF) aplicados a un sistema de reservas. Entregar código fuente con diagrama UML.',
                subjectId: 'arq-software-2026',
                subjectName: 'Arquitectura de Software',
                type: 'tp',
                weight: 0.25,              // 25% de la nota final
                dueDate: addDays(5),
                status: 'pending',
                relatedClassIds: ['class-04', 'class-05'],
                priority: 1,               // calculado: weight / days_remaining
            },
            {
                id: 'task-002',
                title: 'Primer Parcial — Arquitecturas de Software',
                description: 'Evaluación teórico-práctica sobre las unidades 1 a 4: estilos arquitectónicos, atributos de calidad, tácticas y patrones.',
                subjectId: 'arq-software-2026',
                subjectName: 'Arquitectura de Software',
                type: 'parcial',
                weight: 0.40,
                dueDate: addDays(12),
                status: 'pending',
                relatedClassIds: ['class-01', 'class-02', 'class-03', 'class-04'],
                priority: 2,
            },
            {
                id: 'task-003',
                title: 'Lectura Obligatoria — Clean Architecture (Martin)',
                description: 'Capítulos 1 al 5. Se evaluará en el parcial.',
                subjectId: 'arq-software-2026',
                subjectName: 'Arquitectura de Software',
                type: 'lectura',
                weight: 0.05,
                dueDate: addDays(10),
                status: 'pending',
                relatedClassIds: ['class-03'],
                priority: 3,
            },
            {
                id: 'task-004',
                title: 'Trabajo Práctico N°1 — Modelado C4',
                description: 'Documentar la arquitectura del sistema propuesto en el TP usando el modelo C4 (Context, Containers, Components).',
                subjectId: 'arq-software-2026',
                subjectName: 'Arquitectura de Software',
                type: 'tp',
                weight: 0.15,
                dueDate: addDays(-2),      // ya vencida
                status: 'submitted',
                relatedClassIds: ['class-02'],
                priority: null,
            },
        ];

        // Filtrar y ordenar por prioridad (pendientes primero, luego por fecha)
        const sortedTasks = tasks
            .filter(t => t.status !== 'graded')
            .sort((a, b) => {
                if (a.status === 'submitted' && b.status !== 'submitted') return 1;
                if (b.status === 'submitted' && a.status !== 'submitted') return -1;
                return (a.priority ?? 99) - (b.priority ?? 99);
            });

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sortedTasks),
        };
    })
});
