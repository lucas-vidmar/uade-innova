import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

const QUIZ_QUESTIONS = [
    {
        id: 'q1',
        question: '¿Qué es la arquitectura hexagonal?',
        options: ['Un patrón de diseño gráfico', 'Desacopla el dominio de los adaptadores', 'Un tipo de base de datos', 'Un framework de frontend'],
        correctIndex: 1,
        explanation: 'La arquitectura hexagonal desacopla el núcleo de dominio de los adaptadores externos.',
        topic: 'Arquitectura',
    },
    {
        id: 'q2',
        question: '¿Cuál es el beneficio principal del RAG?',
        options: ['Reduce costos de hosting', 'Genera imágenes', 'Contextualiza respuestas con materiales propios', 'Acelera la red'],
        correctIndex: 2,
        explanation: 'RAG recupera contexto de los materiales para fundamentar respuestas.',
        topic: 'RAG',
    },
];

test('student generates quiz, answers questions and sees results with weak topics', async ({ page }) => {
  const capturedRequests = [];

  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-01',
          subjectId: 'arq-software-2026',
          title: 'Clase 1 — Arquitectura',
          date: '2026-03-05',
          topics: [],
          summaryReady: true,
          materials: [{ id: 'm-01', type: 'transcript', filename: 'clase1.vtt' }],
        },
      ]),
    });
  });

  await page.route('**/api/class-summary/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'Resumen' }) });
  });

  await page.route('**/api/class-map/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: null }) });
  });

  await page.route('**/api/class-timeline/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ classId: 'class-01', markers: [], sections: [] }) });
  });

  await page.route('**/api/class-audio-script/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ script: null }) });
  });

  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/sga/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Quiz result: GET returns null initially (no prior attempt)
  await page.route('**/api/quiz-result**', async route => {
    const method = route.request().method();
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      capturedRequests.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          subjectId: body.subjectId,
          userId: 'alu-001',
          classId: body.classId,
          score: body.score,
          totalQuestions: body.totalQuestions,
          correctCount: body.correctCount,
          passed: body.passed,
          weakTopics: body.weakTopics,
          answers: body.answers,
          attemptCount: 1,
        }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: null }) });
    }
  });

  await page.route('**/api/generate-quiz', async route => {
    const body = route.request().postDataJSON();
    capturedRequests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ quizId: 'quiz-1', subjectId: body.subjectId, classId: body.classId, questionCount: QUIZ_QUESTIONS.length, questions: QUIZ_QUESTIONS, model: 'deepseek-v4-flash' }),
    });
  });

  await page.goto('/#/student/class/class-01');

  // Autoevaluación tab visible
  await expect(page.locator('#class-tab-quiz-btn')).toBeVisible();

  // Switch to Autoevaluación
  await page.locator('#class-tab-quiz-btn').click();

  // Generate button + count selector visible
  await expect(page.locator('#quiz-generate-btn')).toBeVisible();
  await expect(page.locator('.quiz-count-btn')).toHaveCount(3);

  // Select 8 questions then revert to 5 (default)
  await page.locator('.quiz-count-btn[data-count="8"]').click();
  await page.locator('.quiz-count-btn[data-count="5"]').click();

  // Generate quiz
  await page.locator('#quiz-generate-btn').click();

  // First question rendered with options
  await expect(page.getByText('Pregunta 1 de 2')).toBeVisible();
  await expect(page.locator('#quiz-options .quiz-option')).toHaveCount(4);

  // Answer Q1 correctly
  await page.locator('#quiz-options .quiz-option').nth(1).click();
  await page.locator('#quiz-next-btn').click();

  // Q2: answer incorrectly to generate a weak topic
  await expect(page.getByText('Pregunta 2 de 2')).toBeVisible();
  await page.locator('#quiz-options .quiz-option').nth(0).click();

  // Submit → results
  await page.locator('#quiz-submit-btn').click();

  // Score 50% → "A repasar" (below 60%)
  const passBanner = page.locator('.quiz-pass-banner');
  await expect(passBanner).toContainText('A repasar');
  await expect(passBanner).toContainText('50%');
  await expect(passBanner).toContainText('1 de 2 correctas');
  await expect(page.getByText('Temas recomendados para repasar')).toBeVisible();

  // Review shows correct + incorrect answers
  await expect(page.locator('.quiz-review-item')).toHaveCount(2);
  await expect(page.locator('.quiz-review-item').first()).toContainText('Correcta');
  await expect(page.locator('.quiz-review-item').nth(1)).toContainText('Tu respuesta');

  // Request payloads were sent correctly
  const generateReq = capturedRequests.find(r => r.classId === 'class-01' && r.questionCount !== undefined && !('score' in r));
  expect(generateReq).toBeTruthy();
  expect(generateReq.subjectId).toBe('arq-software-2026');
  expect(generateReq.questionCount).toBe(5);

  const resultReq = capturedRequests.find(r => typeof r.score === 'number');
  expect(resultReq).toBeTruthy();
  expect(resultReq.score).toBe(50);
  expect(resultReq.passed).toBe(false);
  expect(resultReq.weakTopics).toContain('RAG');
});

test('student sees prior saved quiz score on autoevaluación tab', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
    sessionStorage.setItem('edu_logged_in', 'true');
  });

  await page.route('**/api/enrollments**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'class-01',
          subjectId: 'arq-software-2026',
          title: 'Clase 1 — Arquitectura',
          date: '2026-03-05',
          topics: [],
          summaryReady: true,
          materials: [],
        },
      ]),
    });
  });

  await page.route('**/api/class-summary/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'Resumen' }) });
  });

  await page.route('**/api/class-map/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: null }) });
  });

  await page.route('**/api/class-timeline/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ classId: 'class-01', markers: [], sections: [] }) });
  });

  await page.route('**/api/class-audio-script/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ script: null }) });
  });

  await page.route('**/api/subjects', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/sga/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/quiz-result**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { subjectId: 'arq-software-2026', userId: 'alu-001', classId: 'class-01', score: 80, totalQuestions: 5, correctCount: 4, passed: true, weakTopics: [], answers: [], attemptCount: 1 },
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto('/#/student/class/class-01');
  await page.locator('#class-tab-quiz-btn').click();

  // Prior score badge visible
  await expect(page.getByText('Tu último intento')).toBeVisible();
  await expect(page.getByText('80%')).toBeVisible();
  await expect(page.getByText('¡Aprobado!')).toBeVisible();
  await expect(page.locator('#quiz-generate-btn')).toBeVisible();
});
