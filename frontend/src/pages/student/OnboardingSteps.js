/* ============================================================
   Student Onboarding Steps — placeholder (Story 3.6)
   ============================================================ */
export const STUDENT_ONBOARDING_STEPS = [
  {
    id: 'select-class',
    title: 'Seleccionar clase',
    description: 'Seleccioná la clase activa desde el selector de materias para ver su contenido.',
    targetSelector: '#global-course-btn',
    sectionName: 'Selector de materias (barra superior)',
    position: 'bottom',
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>',
  },
  {
    id: 'chat',
    title: 'Hacé consultas al chat IA',
    description: 'Preguntale al asistente sobre los materiales de clase. Usa el buscador semántico para encontrar respuestas precisas.',
    targetSelector: '.chat-input',
    sectionName: 'Chat de consultas',
    position: 'top',
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
  },
  {
    id: 'sources',
    title: 'Fuentes y referencias',
    description: 'Cada respuesta del chat incluye referencias al material original. Hacé clic en las fuentes para ver el detalle.',
    targetSelector: '.sources-panel',
    sectionName: 'Panel de fuentes',
    position: 'top',
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  },
  {
    id: 'report',
    title: 'Reportá un problema',
    description: 'Si una respuesta no es correcta, podés reportarla para que el docente revise y mejore la calidad.',
    targetSelector: '.report-btn',
    sectionName: 'Botón de reporte',
    position: 'bottom',
    icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.72 3h16.92a2 2 0 0 0 1.72-3L13.7 3.86a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  },
];
