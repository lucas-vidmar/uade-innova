# Guía de Despliegue

## Infraestructura

Todos los recursos se despliegan en `RG_UADE_INNOVA_DEV` usando Bicep + azd.

### Provisionar Infraestructura
```bash
azd provision
```
Esto crea:
- Azure Functions (Consumption Y1, Node 20)
- Azure Static Web Apps (Free Tier)
- Azure Storage (Standard_LRS)
- Azure OpenAI (S0)
- Application Insights
- Key Vault (Standard)

### Desplegar Aplicación
```bash
azd deploy
```
Esto ejecuta:
1. `prepackage` hook: build frontend con variables de entorno
2. Deploy `frontend/dist` → Static Web Apps
3. Deploy `backend/` → Azure Functions

## CI/CD

### Pipeline de Producción (branch `main`)
```
[Push to main] → Secrets Check → Backend Tests → Frontend E2E →
→ Deploy Frontend (SWA token) → Deploy Backend (publish profile) →
→ Smoke Test (curl /api/hello + SWA URL + application-state probe)
```

### Pipeline de Staging (branch `staging`)
```
[Push to staging] → Secrets Check → Backend Tests → Frontend E2E →
→ Deploy Frontend (SWA token) → Deploy Backend (azd + OIDC) →
→ Health Check (curl /api/hello + application-state probe) → Auto PR staging → main
```

### Smoke Test de Aplicación (Story 10.20 — más allá del HTTP 200)

El smoke test de producción/staging ahora ejecuta `backend/scripts/smoke-prod-application-state.js`
después de los curls de HTTP 200. El probe afirma **estado real de la aplicación**:

| Check | Assert |
|---|---|
| `identity-endpoint` | `GET {SMOKE_SWA_URL}/.auth/me` → 200 + JSON con clave `clientPrincipal` |
| `auth-redirect` | `GET {SMOKE_SWA_URL}/.auth/login/aad` → cadena 3xx que llega a `login.microsoftonline.com` |
| `app-shell` | `GET {SMOKE_SWA_URL}/` → 200 + HTML con `id="app"` y entry point JS (`/src/main.js` en dev/raw, `/assets/*.js` en build de producción) |
| `no-dead-end-browser` *(opcional)* | Playwright: cargar la raíz y verificar que el JS redirige a `login.microsoftonline.com` |
| `authenticated-marker` *(opcional)* | Tras sign-in con identidad smoke, el DOM tiene `data-app-state="authenticated"` (marker T1) |
| `function-health` *(opcional)* | `/api/hello` con header `x-azure-fdid` cuando hay Front Door |

El probe termina con exit ≠ 0 (y anotación `::error::`) si **cualquier** check ejecutado falla →
bloquea el release. Checks no habilitados imprimen `SKIP` (no bloquean).

**Secrets requeridos (nunca commitear):**
| Secret | Descripción |
|---|---|
| `SMOKE_SWA_URL` | URL de la Static Web App desplegada (obligatorio; el probe falla si falta) |
| `SMOKE_AUTH_ENABLED` | `true` habilita el check de marker autenticado (requiere identidad smoke, Story 10-25) |
| `SMOKE_TEST_EMAIL` | Email de la identidad smoke (allowlist) |
| `SMOKE_TEST_CLIENT_ID` | Client ID de la identidad smoke |
| `SMOKE_TEST_CLIENT_SECRET` | Secreto de la identidad smoke |
| `SMOKE_BROWSER_CHECK` | `true` habilita el check de browser no-dead-end (Playwright) |
| `SMOKE_TIMEOUT_MS` | Timeout por request (default 15000) |

**Ejecución local:**
```bash
SMOKE_SWA_URL=https://<swa-host>.azurestaticapps.net node backend/scripts/smoke-prod-application-state.js
```
Para los checks de browser, instalar deps de frontend (`cd frontend && npm ci`) o setear `SMOKE_PLAYWRIGHT_PATH`.

### Relación con QA-009 / QA-001

Este probe cierra **QA-009** (issue #266): el smoke test previo solo validaba HTTP 200 y un
release con la página de dead-end de auth (`No se pudo verificar tu identidad.` de **QA-001**,
`docs/qa-browser-report-2026-08-14.md:72-88`) pasaba el gate. Ahora el probe afirma el
endpoint de identidad EasyAuth (`/.auth/me`), el redirect a Microsoft (`/.auth/login/aad`),
el shell de la app y (cuando hay identidad smoke) el marker de estado autenticado
`data-app-state="authenticated"` — un dead-end no produce ninguna de esas señales.

## Variables de Entorno Requeridas

### Backend (App Settings en Azure Functions)
| Variable | Fuente |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | azd output |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | text-embedding-3-small |
| `AI_FOUNDRY_DEEPSEEK_ENDPOINT` | Azure AI Foundry |
| `AI_FOUNDRY_DEEPSEEK_KEY` | Key Vault reference |
| `PINECONE_HOST` | Pinecone console |
| `PINECONE_API_KEY` | Key Vault reference |
| `AZURE_STORAGE_CONNECTION_STRING` | azd output |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | azd output |
| `FRONT_DOOR_ID` | Azure Front Door (si aplica) |

### Frontend (Static Web Apps App Settings)
| Variable | Fuente |
|---|---|
| `VITE_API_BASE_URL` | Functions URL |
| `VITE_AZURE_OPENAI_ENDPOINT` | OpenAI endpoint |
| `VITE_AZURE_OPENAI_CHAT_DEPLOYMENT` | Chat model name |

## Deployments Especiales

### Actualizar solo Frontend
```bash
cd frontend && npm run build
azd deploy frontend
```

### Actualizar solo Backend
```bash
azd deploy backend
```

## Troubleshooting

| Problema | Comando |
|---|---|
| Ver logs | `az functionapp logs tail -n func-dashboard-ingest-{token} -g RG_UADE_INNOVA_DEV` |
| Listar recursos | `az resource list --resource-group RG_UADE_INNOVA_DEV --output table` |
| Obtener deployment token SWA | `az staticwebapp secrets list --name stapp-dashboard-{token} -g RG_UADE_INNOVA_DEV` |
| Tests locales | `cd backend && npm test` |

## Destruir Entorno
```bash
azd down
```
⚠️ Esto elimina todos los recursos de Azure en el resource group.
