import { test, expect } from '@playwright/test';

test('student clicks transcript hit-point and opens chat with filtered context', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        classId: 'class-01',
        markers: [
          {
            id: 'mk-001',
            sectionId: 'sec-001',
            startSecond: 0,
            iconType: 'question',
            label: 'Pregunta sobre arquitectura hexagonal',
          },
        ],
        sections: [
          {
            id: 'sec-001',
            startSecond: 0,
            endSecond: 60,
            timestampLabel: '00:00:00',
            text: 'Se explica arquitectura hexagonal.',
          },
        ],
      }),
    });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/rag-query', async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        'event: metadata\ndata: {"interactionId":"r1","sources":[{"materialType":"transcript","sourceFilename":"clase1.vtt"}]}\n\n',
        'event: delta\ndata: {"content":"Respuesta enfocada en el tramo seleccionado."}\n\n',
        'event: done\ndata: {"answer":"Respuesta enfocada en el tramo seleccionado."}\n\n',
      ].join(''),
    });
  });

  await page.goto('/#/student/class/class-01');

  await page.locator('.timeline-hit').first().click();
  await expect(page.locator('.transcript-section.active')).toContainText('arquitectura hexagonal');

  await page.locator('#timeline-open-chat').click();
  await expect(page).toHaveURL(/transcriptSection=sec-001/);

  await expect(page.locator('#chat-transcript-focus')).toContainText('hexagonal');

  await page.locator('#chat-input').fill('Explicame por que es importante');
  await page.locator('#chat-send').click();

  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('tramo seleccionado');
});
