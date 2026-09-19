import { test, expect } from '@playwright/test';

// Story 10.23 / QA-014: el dashboard del alumno PILOTO no debe renderizar
// artefactos de prueba ("Test deadlinr", chats "Que es un sistema?", marcadores
// en 0s, materias DASI/Econometría/test). El storage ya está limpio; este test
// fija la regresión de la superficie de render.
test('pilot student dashboard renders no test-artifact markers', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    // Solo materias piloto disponibles para el alumno (scope aislado).
    localStorage.setItem('uade.local.subjects', JSON.stringify([
      { id: 'arq-software-2026', name: 'Arquitectura de Software 2026' },
      { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas 2026' },
    ]));
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  // Backend limpio: subjects solo piloto, sin dasi/matematica/ing-datos/arq-soft.
  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'arq-software-2026', name: 'Arquitectura de Software 2026' },
        { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas 2026' },
      ]),
    });
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', status: 'active' },
          { subjectId: 'diseno-sistemas-2026', userId: 'alu-001', role: 'student', status: 'active' },
        ],
      }),
    });
  });

  // Deadlines piloto limpios (sin "Test deadlinr").
  await page.route('**/api/deadlines**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'deadline-p1', title: 'TP1: Diagrama de Arquitectura C4', subjectId: 'arq-software-2026', classId: 'class-01', dueDate: '2026-06-23' },
        { id: 'deadline-p2', title: 'Parcial 1 — Arquitectura y Patrones', subjectId: 'arq-software-2026', classId: 'class-04', dueDate: '2026-07-02' },
      ]),
    });
  });

  // Chats recientes limpios (sin "Que es un sistema?").
  await page.route('**/api/chat-history**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'session-a', sessionId: 'session-a', question: '¿Qué es la arquitectura hexagonal?', subjectId: 'arq-software-2026', timestamp: '2026-06-01T10:00:00Z' },
        { id: 'session-b', sessionId: 'session-b', question: '¿Diferencia entre hexagonal y cebolla?', subjectId: 'arq-software-2026', timestamp: '2026-06-02T10:00:00Z' },
      ]),
    });
  });

  // Timeline limpio (sin marcadores en 0s).
  await page.route('**/api/class-timeline/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classId: 'class-01',
        subjectId: 'arq-software-2026',
        markers: [
          { id: 'mk-01', sectionId: 'sec-01', startSecond: 600, iconType: 'question', label: 'Pregunta sobre arquitectura' },
          { id: 'mk-02', sectionId: 'sec-02', startSecond: 1200, iconType: 'assignment', label: 'Actividad guiada' },
        ],
        sections: [],
      }),
    });
  });

  await page.route('**/api/classes?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Introducción a Arquitecturas de Software', date: '2026-03-05', topics: [], summaryReady: true, materials: [{ id: 'm-01', type: 'transcript', filename: 'clase1.vtt' }] },
      ]),
    });
  });

  await page.route('**/api/class-summary/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'Resumen' }) }));
  await page.route('**/api/class-map/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: null }) }));
  await page.route('**/api/class-audio-script/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ script: null }) }));
  await page.route('**/api/sga/tasks**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/tasks**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/notifications?**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // ── 1. Dashboard: subject picker, deadlines y chats recientes ──
  await page.goto('/#/student/dashboard');
  await page.waitForSelector('#global-course-btn', { timeout: 10000 });
  await page.waitForSelector('.custom-dropdown-option', { state: 'attached', timeout: 10000 });

  // Subject picker: solo materias piloto; sin materias de prueba.
  const subjectOptions = page.locator('.custom-dropdown-option');
  await expect(subjectOptions).toHaveCount(2);
  await expect(subjectOptions.nth(0)).toContainText('Arquitectura de Software 2026');
  await expect(subjectOptions.nth(1)).toContainText('Diseño de Sistemas 2026');
  const subjectsText = (await subjectOptions.allTextContents()).join(' ');
  expect(subjectsText).not.toMatch(/DASI|Econometr|Matem|Ing\. de Datos|arq-soft/i);

  // Deadlines: sin "Test deadlinr".
  await expect(page.locator('#section-tasks')).toContainText('TP1: Diagrama de Arquitectura C4');
  await expect(page.locator('#section-tasks')).not.toContainText(/Test deadlinr/i);

  // Chats recientes: sin "Que es un sistema?" (ni duplicados).
  await expect(page.locator('#section-history')).toContainText('¿Qué es la arquitectura hexagonal?');
  await expect(page.locator('#section-history')).not.toContainText(/Que es un sistema/i);

  // ── 2. Class detail: timeline sin marcadores en 0s ──
  await page.goto('/#/student/class/class-01');
  await page.waitForSelector('.timeline-hit', { timeout: 10000 });

  await expect(page.locator('.timeline-hit')).toHaveCount(2);
  await expect(page.locator('.timeline-hit-time').first()).toHaveText('10:00');
  const timelineTimes = await page.locator('.timeline-hit-time').allTextContents();
  expect(timelineTimes.includes('0s')).toBe(false);
  const markerLabels = await page.locator('.timeline-hit').evaluateAll((els) => els.map((el) => el.getAttribute('title') || ''));
  expect(markerLabels.join(' ')).not.toMatch(/trigger check|retry old doc/i);
});
