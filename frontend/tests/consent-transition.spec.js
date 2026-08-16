import { test, expect } from '@playwright/test';

test.use({ browserName: 'chromium' });

test('chat becomes usable immediately after accepting AI terms without reload', async ({ page }) => {
  // Marker survives only if no reload/navigation happens.
  await page.addInitScript(() => {
    window.__consentTestMarker = 'marker-' + Math.random();
    localStorage.setItem('uade_use_mock', 'false');
    localStorage.setItem('onboarding-student-completed', 'true');
    localStorage.setItem('onboarding-teacher-completed', 'true');
    localStorage.setItem('onboarding-director-completed', 'true');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.removeItem('edu_ai_consent_accepted');
    localStorage.removeItem('edu_ai_consent_accepted');
  });

  let consentPost = 0;
  await page.route('**/api/consent?**', async route => {
    if (route.request().method() === 'POST') {
      consentPost += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { accepted: true } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { accepted: false } }) });
  });

  await page.route('**/api/terms?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { content: 'Términos de uso de prueba.' } }) });
  });

  await page.route('**/api/enrollments?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('**/api/subjects?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'arq-software-2026', name: 'Arquitectura de Software 2026' }]) });
  });

  await page.route('**/api/get-profile?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true }) });
  });

  await page.route('**/api/reminder-preferences?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, cadence: 'both' }) });
  });

  await page.route('**/api/sga/tasks?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/tasks?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/deadlines?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/notifications?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/classes?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'class-01', subjectId: 'arq-software-2026', title: 'Clase 1 — Arquitectura', date: '2026-03-05', topics: [], materials: [], summaryReady: true },
      ]),
    });
  });

  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.route('**/api/rag-query?**', async route => {
    const chunks = [
      'event: metadata\ndata: {"interactionId":"test-consent-1","sources":[{"materialType":"transcript","sourceFilename":"clase1.txt"}]}\n\n',
      'event: delta\ndata: {"content":"El chat quedó desbloqueado sin recargar la página."}\n\n',
      'event: done\ndata: {"answer":"El chat quedó desbloqueado sin recargar la página."}\n\n',
    ];
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: chunks.join('') });
  });

  await page.goto('/#/student/dashboard');
  const urlBefore = page.url();

  const blocker = page.getByText('Aceptá los términos para usar el chat');
  await expect(blocker).toBeVisible();
  await expect(page.locator('#open-consent-modal-btn')).toBeVisible();

  const markerBefore = await page.evaluate(() => window.__consentTestMarker);

  // Accept terms in the consent modal
  await page.locator('#open-consent-modal-btn').click();
  await expect(page.locator('#privacy-modal')).toBeVisible();
  await page.locator('#consent-checkbox').check();
  await page.locator('#consent-continue-btn').click();

  // Blocker is replaced by the full chat UI without any reload/navigation
  await expect(page.locator('#chat-input')).toBeVisible({ timeout: 10000 });
  await expect(blocker).toHaveCount(0);
  await expect(page.locator('#privacy-modal')).toHaveCount(0);

  // No navigation/reload occurred
  const markerAfter = await page.evaluate(() => window.__consentTestMarker);
  expect(markerAfter).toBe(markerBefore);
  expect(page.url()).toBe(urlBefore);
  expect(consentPost).toBe(1);

  // Chat is usable: select class, type, send, receive streaming answer
  const input = page.locator('#chat-input');
  await page.locator('.source-pill').first().click();
  await expect(input).toBeEnabled();
  await expect(page.locator('#chat-send')).toBeEnabled();

  await input.fill('¿Se desbloqueó el chat?');
  await page.locator('#chat-send').click();
  await expect(page.locator('.chat-msg-assistant .chat-bubble-assistant').last()).toContainText('sin recargar', { timeout: 20000 });

  // Still no reload after sending a message
  const markerEnd = await page.evaluate(() => window.__consentTestMarker);
  expect(markerEnd).toBe(markerBefore);
});
