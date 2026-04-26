import { test, expect } from '@playwright/test';

test('take screenshot', async ({ page }) => {
  await page.goto('https://agreeable-beach-002ff0c0f.6.azurestaticapps.net/');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'frontend-screenshot.png' });
  console.log('Screenshot saved to frontend-screenshot.png');
});
