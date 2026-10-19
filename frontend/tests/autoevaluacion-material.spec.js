import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

// #444 (UJ-30, pasos 6 a 8): el resultado de la práctica tiene que llevar al
// material que respalda cada fallo, permitir marcar temas flojos y ofrecer la
// consulta con evidencia. Antes el resultado no tenía ningún enlace, los chips
// eran <span> sin manejador y no había forma de consultar el tema desde ahí.

const QUIZ_QUESTIONS = [
    {
        id: 'q1',
        question: '¿Qué es la arquitectura hexagonal?',
        options: ['A1', 'A2', 'A3', 'A4'],
        correctIndex: 1,
        explanation: 'Desacopla el dominio de los adaptadores.',
        topic: 'Arquitectura',
        source: 'Transcripción del encuentro — clase1.vtt',
    },
    {
        id: 'q2',
        question: '¿Cuál es el beneficio principal del RAG?',
        options: ['B1', 'B2', 'B3', 'B4'],
        correctIndex: 2,
        explanation: 'Contextualiza respuestas con materiales propios.',
        topic: 'RAG',
        source: 'Resumen de la clase (síntesis)',
    },
];

test('el resultado lleva al material de cada fallo y deja marcar temas flojos', async ({ page }) => {
    const weakTopicPosts = [];
    let marked = [];

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

    await page.route('**/api/enrollments**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) }));
    await page.route('**/api/get-profile**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'student', uid: 'alu-001' }) }));
    await page.route('**/api/reminder-preferences**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/consent**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) }));
    await page.route('**/api/notifications/stream**', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
    await page.route('**/api/classes?**', (r) => r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], summaryReady: true, materials: [{ id: 'm-01', type: 'transcript', filename: 'clase1.vtt' }] }]),
    }));
    await page.route('**/api/class-summary/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: 'Resumen' }) }));
    await page.route('**/api/class-map/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: null }) }));
    await page.route('**/api/class-timeline/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ classId: 'class-01', markers: [], sections: [] }) }));
    await page.route('**/api/class-audio-script/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ script: null }) }));
    await page.route('**/api/subjects*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) }));
    await page.route('**/api/chat-history?**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/sga/tasks**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/tasks**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/notifications?**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/quiz-attempts**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ attempts: [] }) }));

    // La marca de temas flojos vive en el servidor, por persona y unidad.
    await page.route('**/api/quiz-weak-topics**', async (route) => {
        if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON();
            weakTopicPosts.push(body);
            marked = body.topics || [];
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ topics: marked, updatedAt: new Date().toISOString() }) });
    });

    await page.route('**/api/quiz-result**', async (route) => {
        if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON();
            const byId = new Map(QUIZ_QUESTIONS.map((q) => [q.id, q]));
            const answers = (body.answers || []).map((a) => {
                const q = byId.get(a.questionId);
                return {
                    questionId: a.questionId,
                    question: q?.question ?? '',
                    options: q?.options ?? [],
                    correctIndex: q?.correctIndex ?? 0,
                    selectedIndex: a.selectedIndex,
                    isCorrect: q ? a.selectedIndex === q.correctIndex : false,
                    explanation: q?.explanation ?? '',
                    topic: q?.topic ?? '',
                    source: q?.source ?? '',
                };
            });
            const correctCount = answers.filter((a) => a.isCorrect).length;
            const score = answers.length ? Math.round((correctCount / answers.length) * 100) : 0;
            const weakTopics = [...new Set(answers.filter((a) => !a.isCorrect && a.topic).map((a) => a.topic))];
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ subjectId: body.subjectId, userId: 'alu-001', classId: body.classId, quizId: body.quizId, score, totalQuestions: answers.length, correctCount, passed: score >= 60, weakTopics, answers, attemptCount: 1 }),
            });
        } else {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: null }) });
        }
    });

    await page.route('**/api/generate-quiz*', async (route) => {
        const body = route.request().postDataJSON();
        const publicQuestions = QUIZ_QUESTIONS.map(({ id, question, options, topic }) => ({ id, question, options, topic }));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quizId: 'quiz-1', subjectId: body.subjectId, classId: body.classId, questionCount: publicQuestions.length, questions: publicQuestions, model: 'stub' }) });
    });

    await page.goto('/#/student/class/class-01');
    await page.locator('#class-tab-quiz-btn').click();
    await page.locator('#quiz-generate-btn').click();
    await expect(page.locator('#quiz-options .quiz-option')).toHaveCount(4);

    // Responder mal a propósito (opción A) para tener fallos con material.
    await page.locator('#quiz-options .quiz-option').nth(0).click();
    await page.locator('#quiz-next-btn').click();
    await page.locator('#quiz-options .quiz-option').nth(0).click();
    await page.locator('#quiz-submit-btn').click();
    await expect(page.locator('#quiz-review-list')).toBeVisible();

    // Paso 6: cada fallo lleva al material que lo respalda, como enlace.
    const reviewLinks = page.locator('#quiz-review-list a');
    expect(await reviewLinks.count()).toBeGreaterThan(0);
    await expect(page.locator('.quiz-review-source').first()).toContainText('Transcripción del encuentro — clase1.vtt');
    await expect(page.locator('.quiz-review-source').nth(1)).toContainText('Resumen de la clase (síntesis)');
    const chatLink = page.locator('.quiz-review-source a', { hasText: 'Consultar en el chat' }).first();
    await expect(chatLink).toHaveAttribute('href', /#\/student\/chat\?classId=class-01&preset=/);

    // Paso 7: los temas flojos se marcan; los chips son controles, no texto.
    const chip = page.locator('.quiz-topic-toggle').first();
    await expect(chip).toHaveAttribute('role', 'button');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(weakTopicPosts.length).toBe(1);
    expect(weakTopicPosts[0].classId).toBe('class-01');
    expect(weakTopicPosts[0].topics.length).toBe(1);

    // Paso 8: cada tema flojo ofrece la consulta acotada a la clase.
    const consult = page.locator('.quiz-topic-consult').first();
    await expect(consult).toHaveText('Consultar este tema');
    await expect(consult).toHaveAttribute('href', /#\/student\/chat\?classId=class-01&preset=/);

    // Cerrar y reabrir: la marca sobrevive (no vive sólo en la pantalla).
    await page.goto('/#/student/dashboard');
    await page.goto('/#/student/class/class-01');
    await page.locator('#class-tab-quiz-btn').click();
    await expect(page.locator('#quiz-marked-topics')).toBeVisible();
    await expect(page.locator('.quiz-marked-topic').first()).toContainText('Arquitectura');
});
