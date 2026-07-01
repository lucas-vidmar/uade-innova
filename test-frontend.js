const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));
  page.on('response', response => {
    if(!response.ok()) console.log('RESPONSE NOT OK:', response.url(), response.status());
  });
  const url = process.env.SWA_URL || 'http://localhost:3000';
  await page.goto(url);
  await page.waitForTimeout(5000);
  await browser.close();
})();
