# Story 11.5.2 — Keyword/Concept Reporting from Chat (Reporte de Concepto Faltante)

## Resumen

Se implementó el reporte de concepto/keyword faltante desde el chat, satisfaciendo los AC de la story 11.5.2 (`11-5-2-keyword-concept-reporting-from-chat`, issue #281, epic 11). Código, tests (unit + E2E) y despliegue a Azure completados. La verificación en navegador en vivo quedó bloqueada por autenticación Entra SSO y por el gap de RBAC de Blob Storage (documentado, pre-existente, afecta a TODOS los reportes de chat).

## Cambios de código

**Backend** (`backend/`):
- `src/functions/chat-api.js` — El handler `chat-report-issue` ahora soporta `type='missing-keyword'`: mapea `reportType`, valida keyword obligatoria (≥2 chars → 400), resuelve el nombre de clase desde `classes-config/{subjectId}.json` (`resolveClassName`), compone el mensaje del docente (`missingKeywordTeacherMessage` → "Un alumno reportó que el concepto '[keyword]' no aparece en los materiales de [ClassName]"), persiste la alerta con `type='missing-keyword'`, `keyword` y `message`, y usa `alertId` tipado (`missing-kw-{messageId}`) para evitar colisión de reportes.
- `src/functions/chat-api.test.js` — 3 tests nuevos de `missing-keyword` (con clase resuelve el nombre y el mensaje completo; sin clase usa fallback "de la materia"; keyword vacío → 400). 6/6 pasan.
- `src/functions/corrections/get-pending-reports/index.js` — expone el campo `message` en el payload de `corrections-pending` para que el docente lo reciba.
- `src/services/state-store.js` — agrega el campo `message` al esquema de entidad de correcciones (`toCorrectionEntity`/`fromCorrectionEntity`).

**Frontend** (`frontend/`):
- `src/components/ChatWidget.js` — Botón "Reportar concepto faltante" en las acciones de cada mensaje del asistente, modal `showMissingKeywordModal()` con los 3 campos del AC ("¿Qué concepto no encontraste?" textarea requerido, "¿En qué clase esperabas encontrarlo?" selector opcional, "Enviar reporte"), y handler `report-missing-keyword-btn` que llama a `api.reportMissingKeyword` con `question`+`answer`.
- `src/services/rag.api.js` — `reportMissingKeyword()` (POST `/api/chat-report-issue` con `type='missing-keyword'` y `issueDetail=keyword`).
- `src/services/api.js` — re-export de `reportMissingKeyword`.
- `src/pages/teacher/Dashboard.js` — La sección "Alertas de Calidad IA" muestra `item.message || item.issueDetail` (el docente ve la frase completa con keyword + clase).
- `src/styles/pages.css` — estilos `.report-missing-keyword-btn`.
- `tests/ai-feedback-report.spec.js` — E2E nuevo del flujo completo (modal, validación, POST con type=missing-keyword, dashboard del docente muestra la frase).

## Verificación

- Backend: `npm test` → **829/829 pass** (incluye 3 tests nuevos de missing-keyword).
- Frontend E2E: `npx playwright test tests/ai-feedback-report.spec.js` → **2/2 pass** (reporte incorrecto + reporte de keyword).
- Build: `npm run build` (Vite) → exitoso.
- Regresiones E2E: `correction-detail-not-found.spec.js` y `follow-up-chat.spec.js` fallan **también en la baseline limpia** (pre-existentes, no relacionados con este cambio).

## Despliegue (Azure en vivo)

- **Backend**: `func azure functionapp publish func-dashboard-ingest-q47bia47kk3na` → exitoso. Rutas sincronizadas (`chat-report-issue` registrada).
- **Frontend**: `swa deploy ./dist` → `https://agreeable-beach-002ff0c0f.6.azurestaticapps.net` exitoso, con `VITE_API_BASE_URL` apuntando al Function App.

## Bloqueo de verificación en navegador en vivo (no es fallo de código)

1. **Entra SSO**: la SWA redirige a `login.microsoftonline.com`; no dispongo de las credenciales smoke (secrets de GitHub) para autenticarme en el navegador Orca.
2. **Blob Storage RBAC (`AuthorizationFailure` 403)**: en App Insights se observa que las escrituras a blob fallan ("This request is not authorized...", story 10.13/#220, AGENTS.md §12 — RBAC no otorgado aún por UADE). Esto afecta a `chat-report-issue` (escribe en `teacher-alerts`) **y a todos los reportes de chat**, incluido el tipo pre-existente `ai-feedback-issue` (verificado: ambos devuelven 500 con mock auth). No es un defecto introducido por este cambio.

## Cierre

- `sprint-status.yaml`: `11-5-2-keyword-concept-reporting-from-chat -> done` (con comentario `# synced: ... -> done`).
- Issue GitHub #281: cerrado.
- Spec: `_bmad-output/implementation-artifacts/spec-11-5-2-keyword-concept-reporting-from-chat.md` → `status: done` con Spec Change Log de los hallazgos de review (surfacing del `message` al docente, alertId tipado, envío de `answer`).

## Pendiente (depende de UADE)

- Otorgar RBAC (`Storage Blob Data Contributor`, etc.) para que los reportes de chat persistan en producción (desbloquea la verificación E2E en vivo completa).
