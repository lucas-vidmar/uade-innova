import { test, expect } from '@playwright/test';

// UJ-30, pasos 1 y 2 (issue #446): la práctica es de la UNIDAD. El panel anuncia
// qué temas abarca antes de empezar y deja acotarlos a los que más preocupan.
// La práctica por clase del detalle de clase tiene que seguir funcionando igual.
//
// Las respuestas de la API se simulan con `page.route` (es el patrón de la suite):
// lo que se verifica acá es el alcance del panel y el pedido que arma, no el
// modelo. La corrección del servidor tiene sus propias pruebas en
// `backend/src/functions/quiz-api.scope.test.js`.

test.use({ channel: 'chrome' });

const SCOPE = {
  subjectId: 'arq-software-2026',
  scope: { kind: 'unit', classCount: 3, classIds: ['class-01', 'class-02', 'class-03'], topicCount: 4, materialCount: 4 },
  classes: [
    {
      classId: 'class-01',
      title: 'Clase 1 — Introducción',
      date: '2026-03-05',
      topics: ['Arquitectura', 'Capas'],
      topicsDeclared: true,
      markedTopics: ['Capas'],
      materialCount: 2,
      materials: [
        { type: 'transcript', filename: 'clase1.vtt', label: 'Transcripción del encuentro — clase1.vtt' },
        { type: 'presentation', filename: 'intro.pdf', label: 'Presentación — intro.pdf' },
      ],
      hasMaterialText: true,
    },
    {
      classId: 'class-02',
      title: 'Clase 2 — Diseño guiado por el dominio',
      date: '2026-03-12',
      topics: ['DDD'],
      topicsDeclared: true,
      markedTopics: ['DDD'],
      materialCount: 2,
      materials: [
        { type: 'transcript', filename: 'clase2.vtt', label: 'Transcripción del encuentro — clase2.vtt' },
        { type: 'notes', filename: 'ddd.md', label: 'Notas — ddd.md' },
      ],
      hasMaterialText: true,
    },
    {
      classId: 'class-03',
      title: 'Clase 3 — Eventos',
      date: '2026-03-19',
      topics: ['Clase 3 — Eventos'],
      topicsDeclared: false,
      markedTopics: [],
      materialCount: 0,
      materials: [],
      hasMaterialText: false,
    },
  ],
  topics: [
    { topic: 'Arquitectura', classId: 'class-01', classTitle: 'Clase 1 — Introducción', declared: true, markedWeak: false },
    { topic: 'Capas', classId: 'class-01', classTitle: 'Clase 1 — Introducción', declared: true, markedWeak: true },
    { topic: 'DDD', classId: 'class-02', classTitle: 'Clase 2 — Diseño guiado por el dominio', declared: true, markedWeak: true },
    { topic: 'Clase 3 — Eventos', classId: 'class-03', classTitle: 'Clase 3 — Eventos', declared: false, markedWeak: false },
  ],
  headline: 'Esta práctica abarca los 4 temas de 3 clases publicadas de la unidad.',
  coverage: { classCount: 3, topicCount: 4, materialCount: 4 },
  generatedAt: '2026-10-20T10:00:00.000Z',
};

// El servidor no entrega correctIndex ni explanation antes de corregir; al
// cerrar, cada respuesta viaja con la clase del material que la respalda.
const UNIT_QUESTIONS = [
  { id: 'q1', question: '¿Qué desacopla la arquitectura hexagonal?', options: ['El dominio de los adaptadores', 'La base del ORM', 'El front del back', 'El build del deploy'], topic: 'DDD', classId: 'class-02', source: 'Resumen — Clase 2 — Diseño guiado por el dominio', correctIndex: 0 },
  { id: 'q2', question: '¿Qué caracteriza a un evento de dominio?', options: ['Es un log', 'Es un hecho del negocio ya ocurrido', 'Es una tabla', 'Es una migración'], topic: 'Clase 3 — Eventos', classId: 'class-03', source: 'Resumen — Clase 3 — Eventos', correctIndex: 1 },
];

function seedSession(page) {
  return page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-003');
    sessionStorage.setItem('edu_token', 'token-de-prueba');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_scope_subjects', JSON.stringify(['arq-software-2026']));
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });
}

async function mockUnitApi(page, captured) {
  await page.route('**/api/subjects*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]),
  }));
  await page.route('**/api/enrollments**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }),
  }));
  await page.route('**/api/quiz-scope**', async (route) => {
    captured.push({ kind: 'scope' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCOPE) });
  });
  await page.route('**/api/quiz-attempts**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ attempts: [] }),
  }));
  await page.route('**/api/quiz-weak-topics**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ topics: [], updatedAt: null }),
  }));
  await page.route('**/api/quiz-result**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: null }) });
      return;
    }
    const body = route.request().postDataJSON();
    captured.push({ kind: 'result', body });
    const byId = new Map(UNIT_QUESTIONS.map((q) => [q.id, q]));
    const answers = (body.answers || []).map((a) => {
      const q = byId.get(a.questionId);
      const isCorrect = a.selectedIndex === q.correctIndex;
      return {
        questionId: a.questionId,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        selectedIndex: a.selectedIndex,
        isCorrect,
        explanation: 'explicación',
        topic: q.topic,
        source: q.source,
        classId: q.classId,
      };
    });
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const score = Math.round((correctCount / answers.length) * 100);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        subjectId: body.subjectId,
        userId: 'alu-003',
        classId: body.classId || '__unit__',
        quizId: body.quizId,
        score,
        totalQuestions: answers.length,
        correctCount,
        passed: score >= 60,
        weakTopics: [...new Set(answers.filter((a) => !a.isCorrect).map((a) => a.topic))],
        answers,
        attemptCount: 1,
      }),
    });
  });
  await page.route('**/api/generate-quiz**', async (route) => {
    const body = route.request().postDataJSON();
    captured.push({ kind: 'generate', body });
    const questions = UNIT_QUESTIONS.map(({ id, question, options, topic }) => ({ id, question, options, topic }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        quizId: 'quiz-unit-1',
        subjectId: body.subjectId,
        scope: body.scope || 'class',
        classId: body.classId ?? null,
        classIds: body.classIds || [],
        questionCount: questions.length,
        questions,
        model: 'modelo-de-prueba',
      }),
    });
  });
}

test('la práctica de la unidad anuncia sus temas antes de empezar y deja acotarlos', async ({ page }) => {
  const captured = [];
  await seedSession(page);
  await mockUnitApi(page, captured);

  await page.goto('/#/student/unit-practice');

  // Paso 1: el alcance se anuncia antes de generar, con sus temas.
  const panel = page.locator('#quiz-scope-announcement');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Esta práctica abarca los 4 temas de 3 clases publicadas de la unidad.');
  await expect(page.locator('.quiz-scope-class')).toHaveCount(3);
  await expect(panel).toContainText('DDD');
  await expect(panel).toContainText('Arquitectura');
  await expect(page.locator('#quiz-scope-summary')).toContainText('unidad completa');
  // Y los temas que ya había marcado como flojos llegan elegidos como prioridad.
  await expect(page.locator('.quiz-priority-btn.active')).toHaveCount(2);
  // Nada de esto generó un cuestionario.
  expect(captured.some((c) => c.kind === 'generate')).toBe(false);

  // Paso 2: acotar el alcance antes de empezar.
  await page.locator('.quiz-scope-class[data-class-id="class-03"]').uncheck();
  await expect(page.locator('#quiz-scope-summary')).toContainText('acotado: 3 de 4 temas');
  await page.locator('.quiz-scope-class[data-class-id="class-01"]').uncheck();
  await page.locator('.quiz-scope-class[data-class-id="class-02"]').uncheck();
  await expect(page.locator('#quiz-scope-summary')).toContainText('0 de 4 temas');
  await expect(page.locator('#quiz-scope-warning')).toBeVisible();
  await expect(page.locator('#quiz-generate-btn')).toBeDisabled();

  // Volver a elegir un tema habilita la práctica: el acotamiento nunca la deja vacía.
  await page.locator('.quiz-scope-class[data-class-id="class-02"]').check();
  await expect(page.locator('#quiz-generate-btn')).toBeEnabled();
  await expect(page.locator('#quiz-scope-summary')).toContainText('1 de 4 temas');

  await page.locator('#quiz-generate-btn').click();
  await expect(page.getByText('Pregunta 1 de 2')).toBeVisible();

  // El pedido lleva el alcance y sólo las clases elegidas.
  const generate = captured.find((c) => c.kind === 'generate');
  expect(generate.body.scope).toBe('unit');
  expect(generate.body.classIds).toEqual(['class-02']);
  expect(generate.body.classId).toBeUndefined();
  expect(generate.body.questionCount).toBe(5);
});

test('el repaso de un fallo de la unidad vuelve al encuentro del tema que lo respalda', async ({ page }) => {
  const captured = [];
  await seedSession(page);
  await mockUnitApi(page, captured);

  await page.goto('/#/student/unit-practice');
  await page.locator('#quiz-generate-btn').click();

  await expect(page.getByText('Pregunta 1 de 2')).toBeVisible();
  await page.locator('#quiz-options .quiz-option').nth(1).click();
  await page.locator('#quiz-next-btn').click();
  await page.locator('#quiz-options .quiz-option').nth(1).click();
  await page.locator('#quiz-submit-btn').click();

  // El cierre del intento de unidad no se declara de una clase: manda su alcance.
  const result = captured.find((c) => c.kind === 'result');
  expect(result.body.scope).toBe('unit');
  expect(result.body.classId).toBeUndefined();

  await expect(page.locator('.quiz-pass-banner')).toContainText('50%');
  const links = page.locator('.quiz-review-item .quiz-review-link');
  await expect(links.first()).toHaveAttribute('href', /student\/class\/class-02/);
});

test('la práctica por clase sigue pidiendo su clase y ofrece la de la unidad como camino aparte', async ({ page }) => {
  const captured = [];
  await seedSession(page);
  await mockUnitApi(page, captured);

  await page.route('**/api/classes**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 'class-01',
      subjectId: 'arq-software-2026',
      title: 'Clase 1 — Introducción',
      date: '2026-03-05',
      topics: [],
      publicationState: 'publicado',
      materials: [{ id: 'm-01', type: 'transcript', filename: 'clase1.vtt' }],
    }]),
  }));
  await page.route('**/api/class-summary/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'Resumen' }),
  }));
  await page.route('**/api/class-map/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: null }),
  }));
  await page.route('**/api/class-timeline/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ classId: 'class-01', markers: [], sections: [] }),
  }));
  await page.route('**/api/class-audio-script/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ script: null }),
  }));

  await page.goto('/#/student/class/class-01');
  await page.locator('#class-tab-quiz-btn').click();

  // El panel de la clase sigue siendo el de siempre y no pide el alcance de la unidad.
  await expect(page.locator('#class-quiz-mount')).toContainText('Poné a prueba tu comprensión de esta clase.');
  await expect(page.locator('#quiz-scope-announcement')).toHaveCount(0);
  await expect(page.locator('#class-quiz-unit-link')).toHaveAttribute('href', '#/student/unit-practice');

  await page.locator('#quiz-generate-btn').click();
  await expect(page.getByText('Pregunta 1 de 2')).toBeVisible();

  const generate = captured.find((c) => c.kind === 'generate');
  expect(generate.body.classId).toBe('class-01');
  expect(generate.body.scope).toBeUndefined();
  expect(generate.body.classIds).toBeUndefined();
});
