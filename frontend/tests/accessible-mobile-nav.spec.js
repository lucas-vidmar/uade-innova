import { test, expect } from '@playwright/test';

test.use({ channel: 'chrome' });

// Mirrors the `NAV` data in frontend/src/components/Sidebar.js (30 anchors across the 4 roles).
const NAV_LABELS = {
  student: [
    'Inicio',
    'Notificaciones',
    'Tareas y Notas',
    'Mis Reportes',
    'Calendario',
    'Configuración',
  ],
  teacher: [
    'Mis Catedras',
    'Gestor de Clases',
    'Estudiantes',
    'Cargar Materiales',
    'Gestión de Materiales',
    'Bandeja de Correcciones',
    'Correcciones Transcripción',
    'Glosario',
    'RAG Sandbox',
    'Analitica',
  ],
  director: [
    'Panel Directivo',
    'SAT por Prompt',
    'Intervenciones',
    'Gestión de Clases',
    'Gestión de Materias',
    'Alumnos',
  ],
  admin: [
    'Panel Técnico',
    'Usuarios',
    'Configuración Técnica',
    'Modelo de IA',
    'Retención',
    'Gestión de Prompts',
    'Cumplimiento',
    'Archivo en Frío',
  ],
};

const ROLES_WITH_HELP = ['student', 'teacher'];

function bootstrap(page, role) {
  return page.addInitScript(({ role }) => {
    sessionStorage.setItem('edu_role', role);
    sessionStorage.setItem('edu_active_subject', 'arq-software-2026');
    sessionStorage.setItem('edu_consent_accepted', 'true');
    localStorage.setItem('uade_use_mock', 'true');
    localStorage.setItem(`onboarding-${role}-completed`, 'true');
  }, { role });
}

async function loadMobileNav(page, role) {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrap(page, role);
  await page.route('**/.auth/me', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`/#/${role}/dashboard`);

  const nav = page.locator('#mobile-bottom-nav');
  await expect(nav).toBeVisible({ timeout: 15000 });
  return nav;
}

// Mide la caja de un elemento recién cuando dejó de moverse: se exige que dos
// lecturas consecutivas, en frames distintos, coincidan. Medir un elemento en
// medio de una animación de entrada devuelve una geometría intermedia —no la del
// producto— y es lo que volvía intermitente la comprobación de #474/#518.
async function settledBox(locator) {
  let previous = null;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        if (!box) {
          previous = null;
          return false;
        }
        const still =
          previous !== null &&
          Math.abs(box.x - previous.x) < 0.5 &&
          Math.abs(box.y - previous.y) < 0.5 &&
          Math.abs(box.width - previous.width) < 0.5 &&
          Math.abs(box.height - previous.height) < 0.5;
        previous = box;
        return still;
      },
      { message: 'la geometría del elemento no se asienta', timeout: 5000 },
    )
    .toBe(true);
  return previous;
}

for (const [role, labels] of Object.entries(NAV_LABELS)) {
  test(`${role} mobile bottom nav links carry accessible names (QA-010)`, async ({ page }) => {
    const nav = await loadMobileNav(page, role);

    // Every destination resolves by its accessible name (from aria-label).
    for (const label of labels) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(1);
    }

    // Help button keeps its accessible name for student/teacher roles only.
    const helpBtn = nav.locator('.mobile-bottom-link--help');
    if (ROLES_WITH_HELP.includes(role)) {
      await expect(helpBtn).toHaveCount(1);
      await expect(helpBtn).toHaveAttribute('aria-label', 'Guía de inicio');
      await expect(nav.getByRole('button', { name: 'Guía de inicio', exact: true })).toHaveCount(1);
    } else {
      await expect(helpBtn).toHaveCount(0);
    }

    // 6 + 10 + 6 + 8 = 30 anchors across the 4 roles.
    await expect(nav.locator('a')).toHaveCount(labels.length);
  });
}

test('mobile nav link keeps an accessible name while its label span is display:none (AC #2)', async ({ page }) => {
  const nav = await loadMobileNav(page, 'student');

  const link = nav.getByRole('link', { name: 'Inicio', exact: true });
  await expect(link).toHaveCount(1);

  // CSS hides the visible label on mobile (pages.css:5160-5162)…
  await expect(link.locator('span')).toHaveCSS('display', 'none');

  // …yet the link still resolves an accessible name via aria-label.
  await expect(link).toHaveAttribute('aria-label', 'Inicio');

  // Decorative icons must not pollute the computed accessible name.
  await expect(link.locator('svg')).toHaveAttribute('aria-hidden', 'true');
});

// Regression (#474): en el teléfono la guía de inicio es un bottom sheet. Debe
// apoyarse POR ENCIMA de la franja de la navegación inferior: anclada en
// `bottom: 0` la tapaba y el puntero dejaba de llegar a los enlaces (QA-008).
test('con la guía de inicio abierta la navegación inferior sigue alcanzable (#474)', async ({ page }) => {
  const nav = await loadMobileNav(page, 'student');

  // Abrir la guía desde el propio botón de ayuda de la barra.
  await nav.getByRole('button', { name: 'Guía de inicio', exact: true }).click();
  const tooltip = page.locator('.onboarding-tooltip');
  await expect(tooltip).toBeVisible({ timeout: 10000 });

  // La tarjeta entra con una transición de 200 ms (`translateY(20px)` → 0) que
  // arranca en el `requestAnimationFrame` de `OnboardingOverlay.renderStep`. El
  // `toBeVisible()` de arriba NO espera esa transición (opacidad 0 sigue contando
  // como visible para Playwright), así que medir apenas se hace visible devolvía
  // un borde inferior hasta 20 px más abajo y la aserción pasaba o fallaba según
  // el tiempo de carga, sin que cambiara nada del producto (#474, #518). Antes de
  // medir hay que esperar el estado asentado: la transformación vuelve a la
  // identidad, que es la geometría final que exige el requisito (QA-008).
  await expect(tooltip).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

  // Y "asentado" es "quieto": la caja se lee recién cuando dos lecturas
  // consecutivas coinciden, de modo que tampoco cae en medio de un movimiento
  // posterior (un re-render de paso, un reflow).
  const t = await settledBox(tooltip);
  const n = await settledBox(nav);
  expect(t).not.toBeNull();
  expect(n).not.toBeNull();

  // La tarjeta no pisa la franja de la navegación (queda por encima).
  expect(t.y + t.height).toBeLessThanOrEqual(n.y + 1);

  // El hit-test real llega al enlace, no a la tarjeta.
  const link = nav.getByRole('link', { name: 'Tareas y Notas', exact: true });
  const box = await link.boundingBox();
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('a')?.id || null,
    [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)],
  );
  expect(topmost).toBe('nav-student-tasks-mobile');
});
