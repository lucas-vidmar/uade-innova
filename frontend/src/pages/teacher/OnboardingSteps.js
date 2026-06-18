/* ============================================================
   Teacher Onboarding Steps — 4-step guided tour for first login
   ============================================================ */

/**
 * Step schema:
 *   { id, title, description, targetSelector?, targetSelectorMobile?, sectionName?, position?, icon? }
 *
 * targetSelector — CSS selector for the element to highlight (desktop).
 * targetSelectorMobile — CSS selector for mobile fallback (optional).
 * sectionName   — displayed on mobile when positional arrows can't be used.
 * position      — arrow position relative to target: 'top' | 'bottom' | 'left' | 'right'.
 * icon          — optional inline SVG shown at top of each step card.
 */

const ICONS = {
  dashboard: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/></svg>',
  upload: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5-5 5 5"/><path d="M12 5v12"/></svg>',
  corrections: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
  materials: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" stroke-width="1.5"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
};

export const TEACHER_ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: 'Panel de control',
    description: 'Acá podés ver tus materias y clases. Cada clase muestra el estado de sus materiales para que sepas qué falta cargar.',
    targetSelector: '#nav-teacher-dashboard-desktop',
    targetSelectorMobile: '#nav-teacher-dashboard-mobile',
    sectionName: 'Panel de control (menú lateral izquierdo)',
    position: 'right',
    icon: ICONS.dashboard,
  },
  {
    id: 'upload',
    title: 'Carga de materiales',
    description: 'Clickeá "Cargar Materiales" para subir transcripciones, presentaciones, apuntes o bibliografía para cada clase.',
    targetSelector: '#nav-teacher-upload-desktop',
    targetSelectorMobile: '#nav-teacher-upload-mobile',
    sectionName: 'Cargar Materiales (menú lateral izquierdo)',
    position: 'right',
    icon: ICONS.upload,
  },
  {
    id: 'corrections',
    title: 'Correcciones de transcripción',
    description: 'Revisá las transcripciones automáticas en "Correcciones de Transcripción". El sistema sugiere correcciones basadas en el glosario técnico.',
    targetSelector: '#nav-teacher-transcription-corrections-desktop',
    targetSelectorMobile: '#nav-teacher-transcription-corrections-mobile',
    sectionName: 'Correcciones de Transcripción (menú lateral izquierdo)',
    position: 'right',
    icon: ICONS.corrections,
  },
  {
    id: 'materials-priority',
    title: 'Prioridad de materiales',
    description: 'Configurá la prioridad de tus materiales desde "Gestión de Materiales" para que el chat use primero los mejores recursos.',
    targetSelector: '#nav-teacher-materials-desktop',
    targetSelectorMobile: '#nav-teacher-materials-mobile',
    sectionName: 'Gestión de Materiales (menú lateral izquierdo)',
    position: 'right',
    icon: ICONS.materials,
  },
];
