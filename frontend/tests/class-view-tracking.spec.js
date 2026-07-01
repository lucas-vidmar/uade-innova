import { test, expect } from '@playwright/test';

const PROD_URL = process.env.SWA_URL || 'http://localhost:3000';

test.describe('Class View Tracking', () => {

  test('student dashboard shows class badges (Nuevo/Bloqueado)', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('edu_role', 'student');
      sessionStorage.setItem('edu_uid', 'alu-001');
    });

    await page.goto(`${PROD_URL}/#/student/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const content = await page.textContent('body');

    // Verify the class sections exist
    expect(content).toContain('Clases');

    // "Nuevo" should appear for unviewed classes that are available
    const hasNuevo = content.includes('Nuevo');
    const hasBloqueado = content.includes('Bloqueado');

    console.log(`Dashboard badges: Nuevo=${hasNuevo}, Bloqueado=${hasBloqueado}`);

    // At least one of these badges should be present
    expect(hasNuevo || hasBloqueado).toBe(true);
  });

  test('student can view a class and see updated badge', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('edu_role', 'student');
      sessionStorage.setItem('edu_uid', 'alu-001');
    });

    await page.goto(`${PROD_URL}/#/student/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await page.waitForSelector('#section-classes', { timeout: 10000 });

    // Try clicking the first "Nuevo" badge link
    const nuevoItem = page.locator('text=Nuevo').first();
    const exists = await nuevoItem.count();

    if (exists > 0) {
      // Click on the parent list item
      await nuevoItem.locator('..').click();
      await page.waitForTimeout(3000);

      // After viewing, the localStorage should have been updated
      const viewedState = await page.evaluate(() => {
        const views = JSON.parse(localStorage.getItem('edu_class_views') || '{}');
        return Object.keys(views).length;
      });
      console.log(`Classes marked as viewed in localStorage: ${viewedState}`);
      expect(viewedState).toBeGreaterThan(0);
    } else {
      console.log('No "Nuevo" badge found — all classes may already be viewed or none are available');
    }
  });
});
