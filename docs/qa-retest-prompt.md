# Prompt para el Agente de Testing — Retest de los 6 Fixes QA

Copia y pega este prompt para delegar al agente de testing (vía Orca u otro agente de QA). El agente debe leerlo completo y ejecutarlo.

---

Eres el agente de testing del Dashboard Educativo Inteligente (UADE Innova). El equipo de desarrollo resolvió los 6 hallazgos de la auditoría QA (`docs/qa-comprehensive-audit-report.md` y `docs/mega-flows-qa-report.md`) y desplegó los fixes a producción. Tu tarea es **re-testear cada fix en el ambiente desplegado**, confirmar que los defectos quedaron resueltos, y cerrar las issues de GitHub correspondientes cuando verifiques que están OK.

## Contexto

- **Ambiente desplegado (producción):** https://agreeable-beach-002ff0c0f.6.azurestaticapps.net (Azure Static Web App `stapp-dashboard-q47bia47kk3na`, RG `RG_UADE_INNOVA_DEV`)
- **Reporte detallado de cambios (LEERLO ANTES DE TESTEAR):** `docs/qa-fixes-report-2026-08-17.md` — contiene qué cambió en cada fix, evidencia de verificación previa y un checklist de regresión por fix.
- **Issues de GitHub asociadas (dejar abiertas hasta verificar):**
  - #291 — fix(frontend): Default subject fallback prevents empty-state lockout (DEFECT-01, Critical)
  - #292 — fix(admin): Populate user allowlist table when remote users list is empty (DEFECT-02, High)
  - #293 — fix(frontend): Keep #/login on screen for logged-out/sessionless users (DEFECT-03, Medium)
  - #294 — feat(student): Podcast player with playback speed controls in class detail (UX-02)
  - #295 — feat(student): 'Consultar con IA' trigger on graded SGA tasks (UX-03)
  - #296 — fix(teacher): 'Agregar Término' CTA in glossary empty state (UX-01)
- **Comandos útiles:** `gh issue list --repo lucas-vidmar/uade-innova`, `gh issue view <n> --repo lucas-vidmar/uade-innova`, `gh issue close <n> --repo lucas-vidmar/uade-innova --reason completed`.

## Metodología de testeo

Usá el **navegador embebido de Orca** (NO Playwright/Chrome MCP): ciclo `orca goto --url <url> --json` → `orca snapshot --json` → interactuar (`orca click/fill`) → `orca snapshot --json`.

Notas de ambiente:
- El sitio desplegado requiere **Microsoft sign-in (AAD)** — usá una identidad de la allowlist si tenés credenciales de smoke test, o testear los flujos interactivos en un build local de desarrollo (mock auth) corriendo la MISMA rama `main` (ver sección "Testing local opcional").
- Para verificar el caso "backend caído / cold start" del fix #291, podés testear localmente con el backend apagado o simular el fallo del endpoint.

## Qué testear (por fix)

### 1. DEFECT-01 — Default subject fallback (#291)
- Student Dashboard (`/#/student/dashboard`): DEBE renderizar contexto "Arquitectura de Software (2026-1)", input de chat y chips de prompt (después de aceptar términos). NO debe aparecer el empty state *"No hay materias vinculadas a tu cuenta."*.
- Teacher Upload (`/#/teacher/upload`) y Teacher Dashboard: sin empty state, dropzone y tarjetas visibles.
- Probar también con backend caído (local): la UI debe seguir interactiva.

### 2. DEFECT-02 — Admin user allowlist table (#292)
- `/#/admin/users` (rol admin): la tabla DEBE mostrar los 8 perfiles del piloto (Lucas Vidmar, María González, Carlos Mendoza, Sofía Ramírez, Tomás Herrera, Profesor Xavier, Joaquín García, Admin Técnico) con badge de rol (`student`/`teacher`/`director`/`admin`) y tag de alcance "Arquitectura de Software (2026-1)" cuando la API remota esté vacía.
- Si la API devuelve usuarios, la tabla remota debe seguir primando (el fallback no pisa datos reales).

### 3. DEFECT-03 — `#/login` handling (#293)
- Con sesión logged-out: navegar a `/#/login` → la card "Iniciá sesión" con el link "Iniciar sesión con Microsoft" debe quedarse visible (NO auto-redirigir al dashboard).
- Con sesión autenticada: `/#/login` debe redirigir a `#/{rol}/dashboard`.

### 4. UX-02 — Podcast player con velocidad (#294)
- En el detalle de una clase con resumen de audio publicado: la card "Podcast de Estudio (IA)" debe mostrar `<audio controls>` + botones de velocidad **1x / 1.25x / 1.5x**.
- Clickear cada velocidad debe cambiar el `playbackRate` y resaltar el botón activo. Al cargar una pista nueva, la velocidad debe resetear a 1x.
- Si el ambiente desplegado no tiene audio sembrado para una clase, verificar el widget inyectando el markup del reporte en la ruta y probando la lógica de velocidad.

### 5. UX-03 — "Consultar con IA" en tareas (#295)
- En `/#/student/tasks` (rol student): las filas de tareas **completadas/calificadas** deben mostrar el botón "🤖 Consultar con IA".
- Las tareas pendientes NO deben mostrarlo.
- Clickearlo debe abrir el chat pre-cargado con: *"Hola, tengo una consulta sobre la correccion y criterios de evaluacion de <título de la tarea>"*. (Recordá: primero hay que aceptar los términos/consentimiento para que el chat sea visible.)

### 6. UX-01 — Glossary "Agregar Término" (#296)
- `/#/teacher/glossary` (rol teacher, con materia activa): el botón "+ Agregar Término" debe estar en el header **y** dentro de la card de empty state ("Sin términos aún").
- Clickear cualquiera de los dos debe agregar una fila editable con el input "Término" enfocado y el botón "Guardar Glosario".

## Criterio de cierre

- Por cada fix: si todos los puntos de su checklist pasan en el ambiente verificado, cerrar la issue con `gh issue close <n> --reason completed` y comentar la evidencia (qué ruta, qué se vio, screenshots si aplica).
- Si algún punto falla, NO cerrar la issue: comentar el hallazgo con detalle reproducible (pasos, snapshot/console) para que el equipo de desarrollo itere.
- Al finalizar, reportar un resumen: qué se verificó, qué se cerró, qué quedó pendiente.

## Testing local opcional (si no hay credenciales AAD para producción)
1. `git checkout main && git pull origin main`
2. `ln -sfn /Users/lucasvidmar/Documents/azure-educational-dashboard/frontend/node_modules frontend/node_modules` (si hace falta) y `cd frontend && npm run dev -- --port <puerto> --strictPort`
3. En dev, el mock auth está activo (`import.meta.env.DEV`). Cambiar rol con: `import('/src/services/auth.js').then(m=>m.auth.mockLoginAs('<student|teacher|director|admin>'))` y navegar por hash. Para simular logged-out: `sessionStorage.setItem('edu_logged_in','false')` antes de ir a `#/login`.
4. Los URLs de producción apuntan al mismo backend (proxy de Vite a las Functions de producción), así que el comportamiento es representativo.