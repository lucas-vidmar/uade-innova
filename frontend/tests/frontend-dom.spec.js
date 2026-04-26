import { test, expect } from '@playwright/test';

test('dump dom', async ({ page }) => {
  await page.goto('https://agreeable-beach-002ff0c0f.6.azurestaticapps.net/');
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => document.body.innerText);
  console.log('--- DOM ---');
  console.log(text);
  console.log('-----------');
});
