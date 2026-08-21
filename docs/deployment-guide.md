# Guía de Despliegue

## Infraestructura

Todos los recursos se despliegan en `RG_UADE_INNOVA_DEV` usando Bicep + azd (`azure.yaml:12`, `infra/main.bicep:144`).

### Modelo de entornos y aislamiento por worktree (Orca)

| Entorno | `azd env` | Cuándo usar | Comando |
|---|---|---|---|
| **Compartido `uade-dev`** | `uade-dev` | Solo `integrator`/`main`/`staging`/CI. Aislado por autorización humana. | `azd env select uade-dev && azd deploy` |
| **Efímero por worktree** | `wt-<slug>` | Cuando un `worker` necesita Azure real sin colisionar con otros paralelos. Token distinto (`uniqueString(subId, envName, loc)`). | `./scripts/new-worktree-env.sh` |
| **Local (default para workers)** | — | Desarrollo y verificación sin deploy. No consume Azure. | `cd backend && npm test && npm start` + `cd frontend && npm run dev` |

**Regla:** los worktrees `worker` **no** ejecutan `azd deploy`/`azd provision` contra `uade-dev`. Ver `AGENTS.md:10-13` y `scripts/new-worktree-env.sh:1-30`.

#### Worktree local (sin Azure) — flujo por defecto
```bash
cd backend && npm test && npm start   # Azurite + Functions en 7071
cd frontend && npm run dev            # Vite en 5173
# Verificación con Orca embebido (no Playwright):
orca goto --url http://localhost:5173 --json && orca snapshot --json
```

#### Worktree con Azure real (opt-in efímero)
```bash
./scripts/new-worktree-env.sh              # o: ./scripts/new-worktree-env.sh my-feature
# → crea azd env wt-<slug>, hereda AZURE_LOCATION/SUBSCRIPTION de uade-dev,
#   provisiona Function App + SWA + Storage dedicados en el mismo RG
azd env get-values                         # verificar AZURE_STATIC_WEB_APP_URI / AZURE_FUNCTION_APP_URI
azd deploy                                 # deploya solo a wt-<slug>
orca goto --url $AZURE_STATIC_WEB_APP_URI --json

# Al terminar la historia — limpiar (no afecta uade-dev):
./scripts/cleanup-worktree-env.sh          # o: ./scripts/cleanup-worktree-env.sh my-feature
./scripts/cleanup-worktree-env.sh --list   # listar wt-* activos
./scripts/cleanup-worktree-env.sh --all    # purgar todos (con confirmación)
```

> **Costo:** plan Y1 Consumption + SWA Free escalan a 0. Mantener efímeros solo lo necesario; el CI y `cleanup-worktree-env.sh` purgan `wt-*`. Pinecone `dashboard-edu-pilot` sigue compartido (namespace por env pendiente).

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
1. `prepackage` hook: build frontend con variables de entorno (`azure.yaml:27-35`)
2. Deploy `frontend/dist` → Static Web Apps
3. Deploy `backend/` → Azure Functions

> En worktrees `worker` este `azd deploy` aplica solo si estás en un env `wt-*` efímero. En el env `uade-dev` está reservado a `integrator`.

## CI/CD

### Pipeline de Producción (branch `main`)
```
[Push to main] → Secrets Check → Backend Tests → Frontend E2E →
→ Deploy Frontend (SWA token) → Deploy Backend (publish profile) →
→ Smoke Test (curl /api/hello + SWA URL + application-state probe + RAG source-isolation canary)
```

### Pipeline de Staging (branch `staging`)
```
[Push to staging] → Secrets Check → Backend Tests → Frontend E2E →
→ Deploy Frontend (SWA token) → Deploy Backend (azd + OIDC) →
→ Health Check (curl /api/hello + application-state probe + RAG canary) → Auto PR staging → main
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

### Canary de Aislamiento de Fuentes RAG (Story 3.7 / #261)

Cierra **QA-002** (`docs/qa-browser-report-2026-08-14.md:90-115`): una query RAG scoped a
`subjectId=arq-software-2026` / `classId=class-01` devolvió fuentes de otra materia. El canary es un
**probe HTTPS standalone** (`backend/scripts/canary-rag-source-isolation.js`) que consulta el
`POST /api/rag-query` desplegado y **afirma que cada source devuelto pertenece al subjectId y a las
clases solicitadas**. Un mismatch (o un `sources[]` vacío = "aislamiento no verificable") termina con
exit ≠ 0 → el smoke gate **bloquea el release** (AC #1/#2).

**Cobertura por rol (AC #3):** cada rol configurado (`student`, `teacher`, `director`, `admin`) envía
su propio email allowlisted vía header `x-ms-client-principal-name` + `x-azure-fdid` (Front Door), con
query en modo blocking (`stream:false`). Se exige **exactamente un scope por rol**; si un rol no tiene
email configurado, el canary falla (fail closed). Los sources `bibliography` quedan exentos del match
de clase (el filtro Pinecone tiene fallback de bibliografía entre clases del mismo subject), pero
`subjectId` **siempre** se verifica.

**Variables de entorno (GitHub secrets — nunca commitear emails/credenciales):**
| Variable | Descripción |
|---|---|
| `RAG_CANARY_ENABLED` | `true` ejecuta las queries RAG del canary; default `false` (off hasta provisionar identidades) |
| `RAG_CANARY_FUNCTION_URL` | URL de la Function App (ej `https://func-dashboard-ingest-<token>.azurewebsites.net`); requerida si enabled |
| `RAG_CANARY_FRONT_DOOR_ID` | ID de Front Door (header `x-azure-fdid`); requerida si enabled |
| `RAG_CANARY_SUBJECT_ID` | Default `arq-software-2026` |
| `RAG_CANARY_CLASS_IDS` | Default `class-01` (comma-separated) |
| `RAG_CANARY_QUESTION` | Pregunta por scope (default: `¿Qué es la arquitectura de software?`) |
| `RAG_CANARY_TIMEOUT_MS` | Timeout por request (default `30000`) |
| `RAG_CANARY_STUDENT_EMAIL` / `RAG_CANARY_TEACHER_EMAIL` / `RAG_CANARY_DIRECTOR_EMAIL` / `RAG_CANARY_ADMIN_EMAIL` | Identidades allowlisted por rol |
| `RAG_CANARY_<ROLE>_SUBJECT_ID` / `_CLASS_IDS` / `_QUESTION` | Overrides opcionales por rol (default al valor compartido) |

**Ejecución local:**
```bash
RAG_CANARY_ENABLED=true \
RAG_CANARY_FUNCTION_URL=https://func-dashboard-ingest-<token>.azurewebsites.net \
RAG_CANARY_FRONT_DOOR_ID=<fd-id> \
RAG_CANARY_STUDENT_EMAIL=<email> RAG_CANARY_TEACHER_EMAIL=<email> \
RAG_CANARY_DIRECTOR_EMAIL=<email> RAG_CANARY_ADMIN_EMAIL=<email> \
node backend/scripts/canary-rag-source-isolation.js
```

**Provisioning requerido (bloqueado hasta que UADE admin lo aplique):** el canary depende de que las
identidades estén en `ALLOWED_USERS_JSON` (app setting de la Function App, Key Vault-referenced; nunca
commitear) y de que los scopes pasen las gates de `rag-query.js`:
- **Allowlist:** agregar 4 entradas `[{"email":"<canary-student>","role":"student","subjects":["arq-software-2026"]}, ...]`
  con un email por rol (student/teacher/director/admin).
- **Enrollment:** cada identidad no-docente/director (student/admin) debe tener enrollment `active` en
  `Enrollments` (Tabla) para `arq-software-2026` (`rag-query.js` → `ENROLLMENT_REQUIRED`).
- **Consent:** cada identidad student/admin debe tener `consentAccepted=true` en `UserProfiles`
  (`rag-query.js` → `CONSENT_REQUIRED`).
- **Materiales revisados:** los materiales del scope (ej `m-01`/`m-02` de `class-01`) deben estar
  marcados `reviewed=true` en la tabla `materials` para que la retrieval devuelva sources
  (`rag-query.js` → filtro de revisión).

Hasta que eso se provisione, el workflow corre el canary con `RAG_CANARY_ENABLED=false` → imprime
`SKIP` y no bloquea el deploy. Al setear `true`, los secrets faltantes hacen **fail closed** (el paso
de secrets-check y el propio script fallan).

### Relación con QA-009 / QA-001

Este probe cierra **QA-009** (issue #266): el smoke test previo solo validaba HTTP 200 y un
release con la página de dead-end de auth (`No se pudo verificar tu identidad.` de **QA-001**,
`docs/qa-browser-report-2026-08-14.md:72-88`) pasaba el gate. Ahora el probe afirma el
endpoint de identidad EasyAuth (`/.auth/me`), el redirect a Microsoft (`/.auth/login/aad`),
el shell de la app y (cuando hay identidad smoke) el marker de estado autenticado
`data-app-state="authenticated"` — un dead-end no produce ninguna de esas señales.

### Smoke de Identidades Allowlist por Rol (Story 10.25 — QA-001/QA-009)

El gate de producción (`deploy-production.yml` → `smoke-test`) y de staging
(`staging.yml` → `health-check`) también ejecuta `backend/scripts/smoke-allowlist-identities.js`
**después** del probe de 10.20. Afirma que **una identidad smoke por rol** (student, teacher,
director, admin) resuelve a través de la allowlist server-side y alcanza su dashboard mapeado,
y que una **identidad no listada** recibe 403 `ACCESS_DENIED` (fail closed, sin dashboard).

| Check | Assert |
|---|---|
| `allowlist-{role}` | `GET {SMOKE_FUNCTION_URL}/api/get-profile` con header `x-ms-client-principal-name: <email>` → 200 + `role` = rol frontend esperado + `scope` resuelto por allowlist → dashboard `#/{role}/dashboard` |
| `allowlist-unlisted-denied` | Mismo endpoint con email no listado → 403 + `code: ACCESS_DENIED` (fail closed) |
| `dashboard-{role}` *(opcional)* | Browser (Playwright): sign-in con la identidad del rol → marker `data-app-state="authenticated"` + hash `#/{role}/dashboard` + marker DOM de la página |
| `access-denied-browser` *(opcional)* | Browser: sign-in con identidad no listada → página `Acceso denegado` con controles `Reintentar` + `Cerrar sesión` |

El gate **falla cerrado**: `SMOKE_ALLOWLIST_ENABLED=true` sin los secrets por rol → exit ≠ 0
(bloquea el release). Deshabilitado → imprime `SKIP` y no bloquea. Una identidad no listada
que NO recibe 403 falla el gate.

**Secrets requeridos (nunca commitear — GitHub secrets):**
| Secret | Descripción |
|---|---|
| `SMOKE_ALLOWLIST_ENABLED` | `true` habilita el gate (requiere los secrets por rol; default off) |
| `SMOKE_FUNCTION_URL` | Derivado en CI desde `AZURE_FUNCTIONAPP_NAME`; no es secret |
| `SMOKE_FRONT_DOOR_ID` | Opcional — id de Front Door para el header `x-azure-fdid` |
| `SMOKE_STUDENT_EMAIL` / `SMOKE_STUDENT_PASSWORD` | Identidad smoke del rol student |
| `SMOKE_TEACHER_EMAIL` / `SMOKE_TEACHER_PASSWORD` | Identidad smoke del rol teacher |
| `SMOKE_DIRECTOR_EMAIL` / `SMOKE_DIRECTOR_PASSWORD` | Identidad smoke del rol director |
| `SMOKE_ADMIN_EMAIL` / `SMOKE_ADMIN_PASSWORD` | Identidad smoke del rol admin |
| `SMOKE_UNLISTED_EMAIL` / `SMOKE_UNLISTED_PASSWORD` | Identidad no listada (denial) |
| `SMOKE_BROWSER_CHECK` | `true` habilita los checks de browser por rol (requiere passwords) |

**Provisioning de las identidades (AC2 — credenciales fuera del repo):**
Las identidades se provisionan en dos lugares, ambos fuera del repositorio:

1. **Allowlist server-side** — app setting `ALLOWED_USERS_JSON` de la Function App
   (Key Vault-referenced, nunca en el repo). Forma de cada entrada (shape en
   `backend/src/services/allowlist.js:14-18`, roles válidos en `:20`):
   ```json
   [
     {"email":"<student-smoke-email>","role":"student","subjects":["arq-software-2026"],"userId":"alu-smoke"},
     {"email":"<teacher-smoke-email>","role":"teacher","subjects":["arq-software-2026"],"userId":"doc-smoke"},
     {"email":"<director-smoke-email>","role":"director","subjects":["arq-software-2026"],"userId":"dir-smoke"},
     {"email":"<admin-smoke-email>","role":"admin","subjects":["arq-software-2026"],"userId":"adm-smoke"}
   ]
   ```
   Comando de referencia (el valor del secret vive en Key Vault):
   ```bash
   az functionapp config appsettings set \
     --name func-dashboard-ingest-{token} --resource-group RG_UADE_INNOVA_DEV \
     --settings "ALLOWED_USERS_JSON=@Microsoft.KeyVault(SecretUri=https://<kv-edu-{token}>.vault.azure.net/secrets/ALLOWED-USERS-JSON/)"
   ```
   ⚠️ Mientras el rol `Key Vault Secrets User` no esté asignado (ver §4/§12), la reference se
   resuelve vacía y la allowlist queda "no configurada" (comportamiento legacy, `allowlist.js:128-134`).

2. **GitHub secrets** — emails/passwords de las identidades como `SMOKE_*` (nunca commitear).

**Seed de administrador (Story 10.25 / #271):** `backend/scripts/seed-initial-data.js` ahora
incluye el perfil y las inscripciones de `adm-001` (rol admin, ambas materias piloto) — sin
ellas, una identidad admin no pasa los endpoints role-gated. El resto de las identidades smoke
reusan los seeds existentes (`dir-001`, `doc-001`, `alu-001..alu-005`).

**Ejecución local:**
```bash
SMOKE_ALLOWLIST_ENABLED=true SMOKE_FUNCTION_URL=https://func-...azurewebsites.net \
  SMOKE_STUDENT_EMAIL=<email> node backend/scripts/smoke-allowlist-identities.js
# Browser checks: SMOKE_BROWSER_CHECK=true + passwords + SMOKE_SWA_URL + frontend deps (npm ci)
```

## Variables de Entorno Requeridas

### Backend (App Settings en Azure Functions)
| Variable | Fuente |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | azd output |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | text-embedding-3-small |
| `AZURE_OPENAI_API_KEY` | Key Vault reference (`AZURE-OPENAI-API-KEY`) |
| `AI_FOUNDRY_DEEPSEEK_ENDPOINT` | Azure AI Foundry (no-secreto) |
| `AI_FOUNDRY_DEEPSEEK_MODEL` | deepseek-v4-flash (no-secreto) |
| `AI_FOUNDRY_DEEPSEEK_KEY` | Key Vault reference (`AI-FOUNDRY-DEEPSEEK-KEY`) |
| `PINECONE_HOST` | Pinecone console |
| `PINECONE_API_KEY` | Key Vault reference (`PINECONE-API-KEY`) |
| `AZURE_STORAGE_CONNECTION_STRING` | Key Vault reference (`AZURE-STORAGE-CONNECTION-STRING`) |
| `AZURE_STORAGE_ACCESS_KEY` | Key Vault reference (`AZURE-STORAGE-ACCESS-KEY`); Managed Identity en producción |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | azd output |
| `FRONT_DOOR_ID` | Eliminado (Front Door disabled — referencia latente limpiada en story 10.13) |

> **⚠️ RBAC (story 10.13):** las Key Vault references se resuelven con la identidad de la Function App.
> Requiere `Key Vault Secrets User`, `Storage Blob Data Contributor`, `Storage Table Data Contributor`,
> `Cognitive Services OpenAI User` (UADE, Owner en el RG). Ver `docs/secrets-inventory.md`.

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
| Ver logs (env actual) | `az functionapp logs tail -n func-dashboard-ingest-{token} -g RG_UADE_INNOVA_DEV` (`azd env get-values` para el token del env activo) |
| Listar recursos por env | `az resource list --resource-group RG_UADE_INNOVA_DEV --query "[?tags.\"azd-env-name\"=='$(azd env list --output json \| jq -r '.[] \| select(.isDefault==true) \| .name')']" --output table` |
| Listar todos los recursos del RG | `az resource list --resource-group RG_UADE_INNOVA_DEV --output table` |
| Obtener deployment token SWA | `az staticwebapp secrets list --name stapp-dashboard-{token} -g RG_UADE_INNOVA_DEV` |
| Tests locales | `cd backend && npm test` |
| Ver env activo | `azd env list` / `azd env get-values` |
| Worktrees colisionan en uade-dev | Verificar que `AGENTS.md:10-13` se respete; usar `./scripts/new-worktree-env.sh` para aislar |

## Destruir Entorno
```bash
azd down
```
⚠️ Esto elimina todos los recursos de Azure en el resource group.
