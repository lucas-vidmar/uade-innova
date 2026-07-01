import { test, expect } from '@playwright/test';

test('log console errors', async ({ page }) => {
  const logs = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  
  page.on('requestfailed', request => {
    logs.push(`[failed req] ${request.url()} - ${request.failure()?.errorText}`);
  });

  page.on('response', response => {
    if(!response.ok()) {
      logs.push(`[failed res] ${response.url()} - ${response.status()}`);
    }
  });

  await page.goto('/');
  await page.waitForTimeout(4000);
  
  console.log('--- BROWSER LOGS ---');
  logs.forEach(l => console.log(l));
  console.log('--------------------');
});
