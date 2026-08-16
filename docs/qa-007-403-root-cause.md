# QA-007 — Root Cause de los 403 en vistas respaldadas por producción

- **Story:** 10.24 — Restore Unavailable Production-Backed Views (issue #270, label `epic-10`)
- **Fecha de diagnóstico:** 2026-08-16
- **Estado:** Verdicto confirmado contra la MVP allowlist antes del cierre (AC #3)

## 1. Alcance

Cuatro superficies devuelven 403/"no disponible" en producción:

1. Docente `Analítica` (`GET /api/analytics`, `GET /api/safety-rate`)
2. Director `Gestión de Prompts` (`GET /api/prompts`)
3. Docente `Reportes de Calidad IA` (`GET /api/corrections-pending`) y alumno `Mis Reportes` (`GET /api/student-reports`)
4. Stream de notificaciones (`GET /api/notifications/stream` + `GET /api/notifications`)

## 2. Evidencia recopilada (producción, no dev-mock)

### 2.1 Allowlist desplegada (`ALLOWED_USERS_JSON`, Function App `func-dashboard-ingest-q47bia47kk3na`)

Leída vía `az functionapp config appsettings list`. Ocho entradas email → rol + subjects:

| Email | Rol | Subjects |
|---|---|---|
| `lvidmar@uade.edu.ar` | `student` | `arq-software-2026` |
| `mgonzalez@uade.edu.ar` | `student` | `arq-software-2026` |
| `cmendoza@uade.edu.ar` | `student` | `arq-software-2026` |
| `sramirez@uade.edu.ar` | `student` | `arq-software-2026` |
| `therrera@uade.edu.ar` | `student` | `arq-software-2026` |
| `xavier@uade.edu.ar` | `teacher` | `arq-software-2026` |
| `jgarciag@uade.edu.ar` | `director` | `arq-software-2026` |
| `admin@uade.edu.ar` | `admin` | `arq-software-2026` |

Las entradas NO llevan ningún `userId`/pilot key: la allowlist define rol+scope, pero no el vínculo al dato operativo.

### 2.2 Postura Front Door (config)

- `FRONT_DOOR_ID` = referencia `@Microsoft.KeyVault(SecretUri=https://kv-edu-q47bia47kk3na.vault.azure.net/secrets/FRONT-DOOR-ID/)` sin resolver.
- El módulo Front Door está **deshabilitado/comentado** (`infra/main.bicep:346-379`).
- `validateFrontDoorId` (`backend/src/services/auth-utils.js:214-225`) retorna `true` para valores placeholder/no resueltos.
- **Config Front Door: DESCARTADA** — no es la causa de los 403.

### 2.3 Espacios de identidad en conflicto

| Espacio | Valor | Dónde |
|---|---|---|
| `principal.userId`/`oid` (SWA EasyAuth) | OID de Microsoft (GUID) | `x-ms-client-principal` |
| Email verificado (allowlist) | `xavier@uade.edu.ar` | claims / `userDetails` / `x-ms-client-principal-name` |
| `userId` que envía el frontend | `u-${email sanitizado}` (ej. `u-xavier_uade_edu_ar`) | `frontend/src/services/auth.js:184` |
| Pilot keys en datos | `alu-001`, `doc-001`, `dir-001` | `Enrollments` RowKey, `recipientUserIds` de notificaciones, `studentId` de correcciones |

Las inscripciones de producción están keyed por pilot keys (`scripts/pilot-enrollments.csv`: `alu-001..alu-050`, `doc-001`, `doc-002`). El seeder (`backend/scripts/seed-enrollments.js`) está **inhabilitado para producción** (Story 10.23).

### 2.4 `AUTH_MOCK_ENABLED=true`

Escape hatch de continuidad del piloto (punto de fuga: permite identidades mock sin email). El reporte QA-007 fue ejecutado con identidades mock (`doc-001`) contra el backend de producción; la allowlist fail-closed las deniega (`ACCESS_DENIED`).

## 3. Verdicto (auth scope vs config vs identity)

**Causa raíz dominante: mismatch de identidad / scope de auth — la identidad resuelta por allowlist no se usa para keyear los datos operativos (inscripciones y notificaciones).**

1. **`ACCESS_DENIED` por identidad no listada (mock)**: QA-007 usó el path dev-mock contra producción → la allowlist fail-closed deniega (`with-auth.js:74-78`). Bajo identidades reales listadas, este caso desaparece. No es un bug del backend: es el comportamiento esperado del gate.

2. **`ENROLLMENT_INACTIVE` (teacher gates)**: `analytics.js:57`, `safety-rate` `analytics.js:164`, `corrections/get-pending-reports/index.js:82` llaman `getEnrollment(subjectId, principal.userId)`. Bajo identidad real, `principal.userId` = OID (o el email sintetizado), pero la tabla `Enrollments` está keyed por pilot keys (`doc-001`). El lookup exacto por RowKey falla → 403 "not assigned to this subject" para docentes **autorizados** por allowlist.

3. **`FORBIDDEN` por scope de notificación (stream 403 loop)**: `resolveEffectiveUserId` (`notifications.js:63-87`) compara el `userId` client-sent (`u-<email>`) contra `principal.userId`/`oid` (OID). En producción siempre difieren → `forbidden: true` → 403 en `get-notifications` y `stream-notifications`. El frontend (`notification-stream.js:34-62`) reconecta con backoff ante **cualquier** error → **loop 403 con backoff exponencial** (AC #2).

4. **`u-<email>` en el frontend no matchea datos**: incluso si el 403 se resolviera, los `recipientUserIds`/`studentId` de notificaciones y correcciones usan pilot keys, no emails ni OIDs.

**Config descartada:** Front Door no aplica. La allowlist está configurada y correcta en emails/roles/scope; lo que falta es el puente identidad → dato (pilot key).

**Conclusión:** es un problema de **identity/scope de auth**, no de configuración ausente ni de backend inactivo. La remediación NO afloja el gate: la allowlist sigue siendo la fuente de verdad de rol+scope; solo se agrega el mapeo email → pilot key para keyear datos.

## 4. Decisión de diseño (canonical userId)

**El `userId` canónico de aplicación es el pilot key resuelto desde la allowlist (`entry.userId`), con fallback al email verificado.**

- Cada entrada de allowlist acepta un campo opcional `userId` (pilot key de datos, ej. `alu-001`, `doc-001`).
- `withAuth` expone `context.user.id` = `entry.userId ?? email` (identidad de aplicación) y mantiene `context.user.userId` (id raw del principal, OID) solo para logging.
- Los gates de subject (`getEnrollment(subjectId, userId)`) y de notificaciones (`resolveEffectiveUserId`, `canReceiveNotification`, `canMarkNotifications`) consumen **solo** `context.user.id` — nunca el `userId` client-sent ni el OID para keyear datos.
- El rol y el scope siguen viniendo de la allowlist (`with-auth.js` override) — no se debilita la autorización.

## 5. Remediation por superficie

| Superficie | Cambio backend | Cambio frontend |
|---|---|---|
| Analítica (docente) | `analytics.js`: gate de enrollment usa `context.user.id`; respuestas 403 estructuradas (`FORBIDDEN`/`ENROLLMENT_INACTIVE`) | `Analytics.js`: render de error específico con `code` + siguiente paso; Retry solo para transitorios/5xx |
| Gestión de Prompts | `prompts-api.js`: 403 estructurado (`FORBIDDEN`, "Director o Admin requerido") | `PromptManager.js`: render del mensaje específico |
| SAT Analytics (docente/director) | gate de rol ya ok (allowlist override) | `SatAnalytics.js`: render de error específico |
| Reportes Calidad IA (docente) | `corrections/get-pending-reports/index.js`: enrollment usa `context.user.id` | `CorrectionInbox.js`: distinguir denegación 403 (acción) vs parcial (warning) |
| Mis Reportes (alumno) | `chat-api.js` `student-reports`: enrollment + filtro `c.studentId === userId` usan `context.user.id` | `Reports.js`: mensaje 403 específico |
| Stream notificaciones | `notifications.js`: `resolveEffectiveUserId` resuelve desde `context.user.id`; 403/401 estructurados; **HTTP streaming habilitado** (`app.setup({ enableHttpStream: true })` en `src/index.js`) — sin esto el host bufferiza el body SSE infinito y nunca entrega el snapshot | `notification-stream.js`: estado terminal en 403 (sin reconnect); `Sidebar.js` muestra mensaje accionable |
| Endpoints enrollments | `enrollments-api.js`: self-lookup usa `context.user.id` | — |

## 5.1 Hallazgo adicional: el canal SSE nunca entregó snapshots en producción

Durante la verificación del stream se detectó que el **success path SSE nunca funcionó en el host**: con `body: ReadableStream` y HTTP streaming deshabilitado, el worker (`@azure/functions`) ejecuta `response.arrayBuffer()` sobre el stream infinito → la respuesta queda colgada sin cabeceras (HTTP 000 vía curl; el cliente de navegador simplemente no recibe respuesta). Previamente no se veía porque las identidades reales siempre caían en el 403 del scope mismatch antes de alcanzar el 200.

**Fix:** `app.setup({ enableHttpStream: true })` en `backend/src/index.js` (best-effort con try/catch; host < v4.28 degrada sin romper el startup). Verificado: `GET /api/notifications/stream` ahora entrega `event: snapshot` con las notificaciones del `recipientUserIds` correcto.

## 6. Acciones de configuración

1. Actualizar `ALLOWED_USERS_JSON` en la Function App agregando `userId` (pilot key) a cada entrada (mapeo documentado en `frontend/src/services/auth.js` `USERS`):
   - `lvidmar@uade.edu.ar → alu-001`, `mgonzalez@uade.edu.ar → alu-002`, `cmendoza@uade.edu.ar → alu-003`, `sramirez@uade.edu.ar → alu-004`, `therrera@uade.edu.ar → alu-005`, `xavier@uade.edu.ar → doc-001`, `jgarciag@uade.edu.ar → dir-001`, `admin@uade.edu.ar → adm-001`
2. Mantener `AUTH_MOCK_ENABLED=true` solo como escape hatch de continuidad del piloto (revertir a `false` cuando #194 SSO esté activo).

## 7. Verificación y riesgos

- **Verificación pendiente (AGENTS.md §16):** `azd deploy` + navegador embebido de Orca. La verificación con identidad Microsoft real requiere credenciales fuera del repo; el worker verifica: (a) superficie con error accionable ante identidad no autorizada, (b) stream sin loop 403, (c) render de datos con identidad autorizada si hay sesión SWA disponible.
- **Riesgos:** (1) el bridge `userId` depende de que la allowlist deployada incluya el campo; si una entrada no lo tiene, fallback a email (sin datos, pero sin 403). (2) Los 403 de Front Door seguirán sin aplicar hasta habilitar el módulo — documentado, no bloqueante. (3) La verificación con identidades reales queda como deuda operativa si no hay credenciales de prueba disponibles en el entorno del worker.
