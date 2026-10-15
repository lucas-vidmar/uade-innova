# Videos demostrativos (testreel)

Pipeline para generar los videos de demostración de la plataforma que pidió UADE
("video demostrativo de cómo está funcionando la plataforma, para mostrar
internamente", correo de Joaquín García del 31/07/2026).

Se usa [`testreel`](https://www.npmjs.com/package/testreel) (v0.2.0): define
interacciones en JSON sobre Playwright y devuelve un video con cursor animado,
chrome de ventana, fondo y zooms. Es la excepción autorizada a la regla
"prohibido Playwright" de `AGENTS.md` §1 / §4 (Pitfall 1): el usuario autorizó
Playwright/testreel para videos de demo y para E2E del frontend.

## Requisitos

```bash
npm install testreel playwright
npx playwright install chromium
ffmpeg   # necesario para MP4/GIF
```

## Credenciales

Las definiciones usan sustitución `${VAR}` de testreel: ninguna credencial vive
en el repositorio. Exportar antes de grabar:

```bash
export DEMO_BASE_URL="https://agreeable-beach-002ff0c0f.6.azurestaticapps.net"
export DEMO_STUDENT_EMAIL="..."   DEMO_STUDENT_PASSWORD="..."
export DEMO_TEACHER_EMAIL="..."   DEMO_TEACHER_PASSWORD="..."
export DEMO_DIRECTOR_EMAIL="..."  DEMO_DIRECTOR_PASSWORD="..."
export DEMO_ADMIN_EMAIL="..."     DEMO_ADMIN_PASSWORD="..."
```

## Grabar

```bash
cd scripts/demo
./run-demo.sh student          # un rol
./run-demo.sh all              # los cuatro roles
./run-demo.sh all --concat     # además, une los cuatro en un MP4 único
```

Salida en `scripts/demo/testreel-output/`: un MP4 por rol, los PNG de cada
`screenshot` y `output.json`.

## Estado de las definiciones

| Definición | Flujo | Estado |
|---|---|---|
| `recordings/student.json` | Login, dashboard, chat RAG, tareas, calendario | login y navegación verificados contra prod; interacciones en página pendientes de validar con credenciales |
| `recordings/teacher.json` | Login, mis cátedras, carga de materiales, bandeja de correcciones, analítica | idem |
| `recordings/director.json` | Login, panel directivo, intervenciones, gestión de materias | idem |
| `recordings/admin.json` | Login, panel técnico, usuarios, modelo de IA, cumplimiento | idem |

Selectores ya verificados contra producción (2026-10-15): `#login-email`,
`#login-password`, `#login-submit` y los ítems de navegación
`#nav-<id>-desktop` que expone `frontend/src/components/Sidebar.js`.
