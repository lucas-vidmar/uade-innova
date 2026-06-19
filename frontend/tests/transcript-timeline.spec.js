import { test, expect } from '@playwright/test';

test('student clicks transcript hit-point and sees transcript section activated and chat link updated', async ({ page }) => {
  await page.addInitScript(() => {
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

  await page.route('**/api/sga/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/#/student/class/class-01');

  await page.locator('.timeline-hit').first().click();
  await expect(page.locator('.transcript-section.active')).toContainText('arquitectura hexagonal');

  const chatLink = page.locator('#timeline-open-chat');
  await expect(chatLink).toHaveAttribute('aria-disabled', 'false');
  await expect(chatLink).toHaveAttribute('href', /transcriptSection=sec-001/);
  await expect(chatLink).toHaveAttribute('href', /focusLabel=/);
});
