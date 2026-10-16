import { test, expect } from '@playwright/test';

const CLASS_WITH_AUDIO = {
  id: 'class-01',
  subjectId: 'arq-software-2026',
  title: 'Clase 1 — Arquitectura',
  date: '2026-03-05',
  topics: [],
  materials: [],
  summaryReady: true,
  audio: { status: 'ready' },
};

const CLASS_WITHOUT_AUDIO = {
  id: 'class-02',
  subjectId: 'arq-software-2026',
  title: 'Clase 2 — DDD',
  date: '2026-03-12',
  topics: [],
  materials: [],
  summaryReady: true,
  audio: null,
};

async function seedSession(page) {
  await page.addInitScript(() => {
    localStorage.setItem('uade_use_mock', 'false');
    sessionStorage.setItem('edu_role', 'student');
    sessionStorage.setItem('edu_uid', 'alu-001');
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_logged_in', 'true');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    sessionStorage.setItem('edu_ai_consent_accepted', 'true');
  });
  await page.route('**/api/get-profile?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ consentAccepted: true, role: 'student' }) });
  });
}

async function seedClassRoutes(page, classes, audioScript, classAudioBody) {
  await page.route('**/api/classes?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(classes) });
  });
  await page.route('**/api/class-summary/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: { content: 'Resumen de la clase' } }) });
  });
  await page.route('**/api/class-map/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mapCode: '' }) });
  });
  await page.route('**/api/class-timeline/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sections: [], markers: [] }) });
  });
  await page.route('**/api/class-audio-script/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(audioScript) });
  });
  await page.route('**/api/class-audio/**', async route => {
    await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: classAudioBody || Buffer.from('ID3') });
  });
  await page.route('**/api/chat-history?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/tasks**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/deadlines?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

test('student sees the TTS audio player when the class has a ready podcast', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');
  await seedSession(page);
  await seedClassRoutes(page, [CLASS_WITH_AUDIO], { validated: true, ttsGeneratedAt: '2026-08-01T00:00:00Z' });

  await page.goto('http://localhost:3000/#/student/class/class-01', { waitUntil: 'domcontentloaded' });
  const player = page.locator('[data-testid="tts-audio-player"]');
  await expect(player).toBeVisible({ timeout: 10000 });

  await expect(player.locator('[data-testid="audio-player-label"]')).toContainText('Podcast de la clase');
  await expect(player.locator('[data-testid="audio-player-play"]')).toBeVisible();
  await expect(player.locator('[data-testid="audio-player-progress"]')).toBeVisible();
  await expect(player.locator('[data-testid="audio-player-download"]')).toBeVisible();
});

test('student sees a "Generar audio" button when the class has no podcast yet', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This usability check must run on Chrome/Chromium.');
  await seedSession(page);
  await seedClassRoutes(page, [CLASS_WITHOUT_AUDIO], { validated: false, ttsGeneratedAt: null });

  await page.goto('http://localhost:3000/#/student/class/class-02', { waitUntil: 'domcontentloaded' });
  const generateBtn = page.locator('[data-testid="btn-generate-audio"]');
  await expect(generateBtn).toBeVisible({ timeout: 10000 });
  await expect(generateBtn).toHaveText('Generar audio');
});
