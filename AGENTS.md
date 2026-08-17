# **Contexto del Agente: Dashboard Educativo Inteligente (UADE)**

Este documento sirve como marco de referencia para la implementación del sistema RAG (Retrieval-Augmented Generation) para el proyecto de Dashboard Educativo.

## **1\. Visión General del Proyecto**

* **Objetivo:** Transformar la experiencia académica mediante IA generativa sobre materiales de clase (transcripciones, presentaciones, apuntes y bibliografía) cargados manualmente por los docentes desde la plataforma.  
* **Población Objetivo:** Piloto de 65 alumnos y docentes (1 materia).  
* **Meta de Adopción:** 60% de uso activo durante el cuatrimestre.

## **2\. Stack Tecnológico (Azure Cloud & AI)**

Para maximizar el FinOps y minimizar el CapEx, se utiliza una arquitectura **100% Serverless** (sin VMs reservadas):

* **Generative AI:** Híbrido (Azure AI Foundry + Azure OpenAI).
  * **Modelos:** DeepSeek V4 Flash (Chat/Razonamiento vía Azure AI Foundry) y text-embedding-3-small (Vectorización vía Azure OpenAI).
  * **Nota:** UADE ya provisionó el recurso `RS-OPENAI-LLM` para embeddings. El modelo DeepSeek se consume desde el catálogo de modelos de Azure AI Foundry.
* **Vector Database:** Pinecone (Tier: Serverless/Standard).
  * **Dimensión:** 1536 (específico para el modelo de embeddings v3).
  * **Métrica:** Cosine Similarity.
* **Compute (Backend):** Azure Functions **Consumption Plan Y1** \+ Node.js 20.
  * Sin VM reservada. Escala a 0. Pago por ejecución (primeros 1M/mes gratis).
* **Frontend Hosting:** Azure **Static Web Apps** (Free tier).
  * CDN global, SSL automático, 100 GB bandwidth/mes. Sin VM quota.
* **Identity:** Microsoft Entra ID (OIDC / SSO UADE).
* **Observability:** Azure Application Insights (Monitoreo de latencia y costos por token).

## **3\. Arquitectura del Sistema (4 Capas)**

1. **Capa de Ingesta (Upload-Triggered):** El docente sube materiales de clase (TXT/DOCX/VTT para transcripciones, PPTX/PDF para presentaciones, DOCX/PDF para apuntes y bibliografía) desde el panel de la plataforma \-\> Trigger a Azure Functions vía HTTP.  
2. **Capa de Conocimiento:** Parsing y extracción de texto por tipo de archivo \-\> Chunking \-\> Generación de Embeddings \-\> Upsert a Pinecone con metadatos (subject\_id, lecture\_date, material\_type).  
3. **Capa de Inferencia (RAG Pipeline):**  
   * Query del alumno \-\> Embedding de la pregunta.  
   * Similarity Search en Pinecone con filtrado por metadatos (clase/materia seleccionada).  
   * Augmentation (System Prompt \+ Context \+ Query).  
   * Generación de respuesta con referencias al material fuente.  
4. **Capa de Presentación:** Dashboard en React/HTML integrado con SSO.

## **4\. Restricciones Técnicas y Seguridad**

* **Seguridad:** Los secretos (Pinecone, Azure OpenAI, DeepSeek/AI Foundry, Storage) viven en Azure Key Vault y se inyectan en Functions vía `@Microsoft.KeyVault(SecretUri=...)` references. El acceso a Storage y Azure OpenAI usa **Managed Identity** (`DefaultAzureCredential`) una vez que UADE otorgue los roles RBAC (ver §12 y `docs/secrets-inventory.md`). Mientras el rol `Key Vault Secrets User` no esté asignado, las references se resuelven vacías y el código cae a credenciales locales/placeholders.  
* **Region:** East US o Brazil South (priorizar disponibilidad de GPT-4o mini).  
* **FinOps:** El costo objetivo por alumno debe ser \< $1.50 USD/mes.  
* **RAG Tuning:** Implementar filtrado por metadatos (subject\_id, lecture\_date) para evitar filtraciones de contexto entre materias.

## **5\. Roadmap Inmediato (Vibecoding Phase)**

1. \[ \] Definición de Infraestructura como Código (Bicep/azd).  
2. \[ \] Panel del Docente: UI de carga de materiales por clase (transcripción, presentación, apuntes, bibliografía).  
3. \[ \] Pipeline de ingesta: Azure Function que parsea archivos cargados, genera chunks y embeddings, y los persiste en Pinecone.  
4. \[ \] Chat básico: Interfaz de consulta para alumnos que consuma el índice de Pinecone con filtrado por clase/materia.  
5. \[ \] Integración de SSO con Microsoft Entra ID.

## **6\. Comandos de Referencia**

* Inicializar proyecto azd: `azd init`
* Desplegar infraestructura: `azd provision` (desde la raíz del proyecto)
* Destruir entorno: `azd down`
* Ver logs de Functions: `func start` (local) / `az functionapp logs tail`
* Listar recursos del RG: `az resource list --resource-group RG_UADE_INNOVA_DEV --output table`
* Obtener deployment token de Static Web App: `az staticwebapp secrets list --name <nombre> --resource-group RG_UADE_INNOVA_DEV`

---

## **7\. Infraestructura como Código (azd + Bicep)**

La infraestructura se gestiona 100% como código. El agente debe respetar esta estructura y nunca crear recursos manualmente desde el portal de Azure.

### **7.1. Flujo de trabajo IaC**

1. Todos los recursos de Azure se definen en archivos `.bicep` dentro de la carpeta `infra/`.
2. El archivo `azure.yaml` en la raíz es el manifiesto principal del proyecto para `azd`.
3. Al ejecutar `azd provision`, se despliegan todos los recursos y se genera un `.env` local con los endpoints y secretos (que NUNCA se commitea al repo).
4. El agente debe leer `infra/main.bicep` para entender qué recursos existen antes de escribir código que los consuma.

### **7.2. Estructura de archivos Bicep**

```
infra/
├── main.bicep              # Orquestador principal: llama a todos los módulos
├── main.parameters.json    # Parámetros de entorno (dev/prod)
└── modules/
    ├── openai.bicep         # Azure OpenAI + deployments de modelos
    ├── functions.bicep      # Azure Functions (Consumption Plan Y1 — serverless real)
    ├── staticwebapp.bicep   # Azure Static Web Apps (Free tier — sin VM quota)
    ├── storage.bicep        # Azure Blob Storage (archivos de clase)
    ├── keyvault.bicep       # Azure Key Vault (Pinecone API Key)
    └── appinsights.bicep    # Application Insights + Log Analytics
```

### **7.3. Recursos a definir en Bicep**

| **Recurso** | **Nombre sugerido** | **Notas clave** |
|---|---|---|---|
| Resource Group | `RG_UADE_INNOVA_DEV` | Asignado por UADE. Todos los recursos dentro de este RG. |
| Azure OpenAI | `RS-OPENAI-LLM` (existente) | Ya provisionado por UADE en eastus2. Solo para embeddings. |
| Azure AI Services | `aiservices-dashboard` | **AIServices-kind** (no OpenAI-kind). Hostea DeepSeek V4 Flash con `--model-format DeepSeek`. Requiere `api-key` header. |
| Azure Functions | `func-dashboard-ingest-{token}` | Runtime: Node.js 20. Plan: **Consumption Y1** (sin VM quota). |
| Azure Storage | `stdashboard{token}` (max 24 chars) | Contenedores: `class-materials` y `processed`. |
| Azure Static Web Apps | `stapp-dashboard-{token}` | **Free tier.** CDN global, SSL, 100 GB/mes. Sin VM quota. |
| App Insights | `appi-dashboard-{token}` | Vinculado a Functions para trazas y costos. |
| Key Vault | `kv-edu-{token}` | Almacena Pinecone API Key como secret. |

---

## **8\. Estructura del Proyecto (Monorepo)**

El repositorio sigue esta estructura. El agente debe crear archivos únicamente en las rutas definidas aquí:

```
azure-educational-dashboard/
├── azure.yaml                   # Manifiesto azd
├── .env.local                   # Variables locales (NO commitear, en .gitignore)
├── infra/                       # IaC (Bicep) - ver sección 7
│
├── _bmad/                       # BMad framework (workflows, agents, config)
│   ├── config.toml              # Config principal del proyecto
│   ├── core/                    # Módulo Core de BMad
│   ├── bmm/                     # Módulo BMad Method (análisis, planificación, impl.)
│   ├── custom/                  # Overrides personalizados
│   └── stories/                 # Story files activos
│
├── _bmad-output/                # Artefactos generados por BMad
│   ├── planning-artifacts/      # PRDs, UX, arquitectura, epics
│   └── implementation-artifacts/# Specs, stories, code reviews, sprint status
│
├── docs/                        # Conocimiento del proyecto (project_knowledge)
│   ├── Documento de Alcance Funcional.md
│   ├── architecture-review.md
│   └── ... (ver §17)
│
├── frontend/                    # Dashboard web (HTML + Vanilla JS o React)
│   ├── index.html
│   ├── src/
│   │   ├── pages/
│   │   │   ├── student/         # Vistas del alumno (chat, tareas, calendario)
│   │   │   ├── teacher/         # Vistas del docente (carga de materiales, validación)
│   │   │   └── director/        # Vistas del director (métricas y alertas)
│   │   ├── components/          # Componentes reutilizables (UploadPanel, ChatWidget, etc.)
│   │   └── services/            # Clientes HTTP hacia el backend (api.js)
│   └── package.json
│
├── backend/                     # Azure Functions (Node.js o Python)
│   ├── host.json
│   ├── local.settings.json      # Config local (NO commitear)
│   └── functions/
│       ├── ingest-material/     # POST: recibe archivo, parsea, embeds, upsert Pinecone
│       ├── rag-query/           # POST: recibe pregunta, hace RAG, devuelve respuesta
│       ├── get-classes/         # GET: lista clases y estado de materiales por materia
│       └── get-tasks/           # GET: retorna tareas priorizadas del alumno
│
└── scripts/                     # Scripts utilitarios (seed de datos, testing manual)
    └── seed-pinecone.js
```

---

## **9\. Tracking de Épicas y User Stories (Fuente de Verdad: GitHub Issues)**

> **⚠️ CRÍTICO — No replicar localmente:** Las épicas y user stories del proyecto se trackean **integramente en GitHub Issues**. No se deben crear ni mantener réplicas locales de épicas, stories, planes de implementación ni walkthroughs en archivos `.md` dentro del repositorio.

### **9.1. Fuente Única de Verdad**

* **Repositorio:** `lucas-vidmar/uade-innova` en GitHub.
* **Épicas:** Issues con título que comienza con `[Epic X]` (ej: `[Epic 2] Teacher Onboarding Guide`).
* **User Stories:** Issues con labels `epic-X` que las vinculan a su épica correspondiente.
* **Estados:** El estado real de cada historia (`OPEN`/`CLOSED`) vive únicamente en GitHub.

### **9.2. Convenciones de Issues**

| Tipo | Patrón de Título | Labels |
|---|---|---|
| Épica | `[Epic N] Título descriptivo` | `epic-N` + categoría opcional |
| User Story | Título descriptivo de la funcionalidad | `epic-N` obligatorio |

### **9.3. Workflow de Sprint**

1. **Consultar estado:** Antes de cualquier análisis de sprint, el agente debe ejecutar `gh issue list` para obtener la lista actualizada de issues desde GitHub.
2. **No inferir desde archivos locales:** Los artefactos históricos (implementation plans, walkthroughs) se mantienen en `_bmad-output/implementation-artifacts/` pero **no reflejan el estado actual del backlog**. **NUNCA** usarlos para determinar el estado de una historia.
3. **Sprint status:** El archivo `sprint-status.yaml` se genera automáticamente a partir de los issues de GitHub y se actualiza mediante `bmad-sprint-planning`. Se encuentra en `_bmad-output/implementation-artifacts/sprint-status.yaml`.

### **9.4. Comandos de Referencia para GitHub**

```bash
# Listar todas las issues (abiertas y cerradas)
gh issue list --repo lucas-vidmar/uade-innova --limit 200 --state all --json number,title,state,labels

# Listar issues de una épica específica
gh issue list --repo lucas-vidmar/uade-innova --label "epic-2" --state all

# Ver detalle de una issue
gh issue view <number> --repo lucas-vidmar/uade-innova
```

---

## **10\. Modelos de Datos (Entidades Clave)**

El agente debe usar estas definiciones de tipos para garantizar consistencia entre frontend, backend y Pinecone.

### **Material** (unidad de carga del docente)

```typescript
interface Material {
  id: string;                  // UUID generado al subir
  classId: string;             // ID de la clase a la que pertenece
  subjectId: string;           // ID de la materia (para filtros RAG)
  type: "transcript" | "presentation" | "notes" | "bibliography";
  filename: string;
  mimeType: string;
  status: "pending" | "processing" | "ready" | "error";
  uploadedAt: string;          // ISO 8601
  processedAt?: string;        // ISO 8601, se setea al finalizar el pipeline
  blobUrl: string;             // URL del archivo en Azure Blob Storage
}
```

### **Class** (clase del cronograma)

```typescript
interface Class {
  id: string;
  subjectId: string;
  title: string;               // Ej: "Clase 3 - Arquitecturas de Software"
  date: string;                // ISO 8601
  topics: string[];            // Temas planificados
  materials: Material[];       // Materiales cargados para esta clase
  summaryReady: boolean;       // true si el docente ya validó el resumen IA
}
```

### **PineconeVector** (metadatos de cada chunk indexado)

```typescript
interface PineconeMetadata {
  subjectId: string;
  classId: string;
  materialId: string;
  materialType: "transcript" | "presentation" | "notes" | "bibliography";
  chunkIndex: number;
  sourceFilename: string;
  lectureDate: string;         // ISO 8601 — usado para filtros RAG por clase
}
```

---

## **11\. Contratos de API (Azure Functions)**

### **POST `/api/ingest-material`** — Pipeline de ingesta

**Descripción:** Recibe un archivo subido por el docente, lo parsea según tipo, genera chunks y embeddings, y los persiste en Pinecone. También sube el archivo crudo a Blob Storage.

**Request:** `multipart/form-data`

| Campo | Tipo | Descripción |
|---|---|---|
| `file` | `File` | Archivo a procesar |
| `classId` | `string` | ID de la clase destino |
| `subjectId` | `string` | ID de la materia |
| `materialType` | `"transcript" \| "presentation" \| "notes" \| "bibliography"` | Tipo de material |

**Response `202 Accepted`:**

```json
{ "materialId": "uuid", "status": "processing" }
```

**Pipeline interno (dentro de la Function):**

1. Subir archivo crudo a `Blob Storage / class-materials/{classId}/{materialId}`
2. Extraer texto según tipo: `.vtt/.txt` → directo, `.docx` → mammoth, `.pdf` → pdf-parse, `.pptx` → pptxgen
3. Dividir en chunks de 512 tokens con 50 tokens de solapamiento
4. Generar embeddings con `text-embedding-3-small` (Azure OpenAI)
5. Upsert en Pinecone con metadatos `PineconeMetadata`
6. Actualizar estado del `Material` a `"ready"` en la base de datos/Storage

---

### **POST `/api/rag-query`** — Chat RAG

**Request:**

```json
{
  "question": "¿Qué es la arquitectura hexagonal?",
  "classIds": ["class-03", "class-04"],
  "subjectId": "arq-software-2026"
}
```

**Response `200 OK` (non-streaming):**

```json
{
  "answer": "La arquitectura hexagonal...",
  "sources": [
    { "materialType": "transcript", "classId": "class-03", "chunkIndex": 12, "sourceFilename": "clase3_transcript.txt" }
  ]
}
```

**Response (SSE streaming):**

`event: metadata`
`data: {"interactionId":"...","sources":[...],"model":"deepseek-v4-flash"}`

`event: delta`
`data: {"content":"..."}`

`event: done`
`data: {"answer":"..."}`

The `model` field in metadata carries the active chat model name (deepseek-v4-flash or gpt-4o-mini). The frontend ChatWidget displays "Powered by {model}" below the assistant bubble.

---

### **GET `/api/classes?subjectId={id}`** — Lista de clases con estado de materiales

**Response `200 OK`:** Array de `Class[]` con sus `Material[]` anidados.

---

## **12\. Variables de Entorno Requeridas**

Estas variables son generadas por `azd provision`. En **producción** los secretos viven en Azure Key Vault
(`kv-edu-{token}`) y se inyectan en Functions vía `@Microsoft.KeyVault(SecretUri=...)` references — NUNCA
como valores planos en App Settings. El acceso a Storage y Azure OpenAI pasa por **Managed Identity**
(`DefaultAzureCredential`) una vez que UADE otorgue los role assignments RBAC (ver §4 y
`docs/secrets-inventory.md`). Localmente se cargan desde `backend/local.settings.json` / `.env.local`
(gitignored) generados con `scripts/bootstrap-local-secrets.sh` — el agente nunca debe hardcodear estos valores.

```bash
# Azure OpenAI (Embeddings & TTS) — KEY EN KEY VAULT (secret AZURE-OPENAI-API-KEY)
AZURE_OPENAI_ENDPOINT=https://<rs-openai-llm>.openai.azure.com/
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small
AZURE_OPENAI_TTS_DEPLOYMENT=tts-1
AZURE_OPENAI_API_KEY=@Microsoft.KeyVault(SecretUri=https://<kv-edu-*>.vault.azure.net/secrets/AZURE-OPENAI-API-KEY/)

# DeepSeek V4 Flash (via Azure AI Services — AIServices kind) — KEY EN KEY VAULT (secret AI-FOUNDRY-DEEPSEEK-KEY)
# AIServices-kind NO soporta Managed Identity (rechaza Bearer): la clave vive en Key Vault.
AI_FOUNDRY_DEEPSEEK_ENDPOINT=https://aiservices-dashboard.cognitiveservices.azure.com/openai/deployments/deepseek-v4-flash
AI_FOUNDRY_DEEPSEEK_KEY=@Microsoft.KeyVault(SecretUri=https://<kv-edu-*>.vault.azure.net/secrets/AI-FOUNDRY-DEEPSEEK-KEY/)
AI_FOUNDRY_DEEPSEEK_MODEL=deepseek-v4-flash

# Auth Note: DeepSeek uses base `OpenAI` SDK class + custom `fetch` override that
# removes `Authorization: Bearer` and sets `api-key` header instead. This is required
# because AIServices-kind accounts (not OpenAI-kind) reject Bearer tokens.

# Entra ID OIDC (Story 10.11 / #218) — Placeholder hasta que UADE provisione el app registration.
# Cuando están configurados, `withAuth` valida `Authorization: Bearer` via OIDC discovery + JWKS.
# AUTH_MOCK_ENABLED=true permite el fallback mock en producción (continuidad del piloto);
# revertir a false cuando #194 (SSO) esté activo.
ENTRA_TENANT_ID=@Microsoft.KeyVault(SecretUri=...secrets/ENTRA-TENANT-ID/)
ENTRA_CLIENT_ID=@Microsoft.KeyVault(SecretUri=...secrets/ENTRA-CLIENT-ID/)
AUTH_MOCK_ENABLED=true

# Pinecone — KEY EN KEY VAULT (secret PINECONE-API-KEY)
PINECONE_HOST=https://<index-name>-<environment>.svc.pinecone.io
PINECONE_INDEX_NAME=dashboard-edu-pilot
PINECONE_API_KEY=@Microsoft.KeyVault(SecretUri=...secrets/PINECONE-API-KEY/)

# Azure Storage — acceso vía Managed Identity (DefaultAzureCredential) en producción;
# connection string en Key Vault (secret AZURE-STORAGE-CONNECTION-STRING) como respaldo.
AZURE_STORAGE_ACCOUNT_NAME=stdashboard{token}
AZURE_STORAGE_CONTAINER_MATERIALS=class-materials

# App (generado por azd desde la URL de Static Web Apps)
VITE_API_BASE_URL=https://func-dashboard-ingest-{token}.azurewebsites.net/api
AZURE_STATIC_WEB_APP_URI=https://<nombre>.azurestaticapps.net
```

> **⚠️ RBAC requirement (story 10.13 / #220):** Las references de Key Vault se resuelven con la identidad
> de la Function App. Requieren que UADE otorgue (permisos Owner en el RG):
> `Key Vault Secrets User`, `Storage Blob Data Contributor`, `Storage Table Data Contributor`,
> `Cognitive Services OpenAI User`. Hasta que eso ocurra, los secrets se resuelven vacíos (fallback a
> placeholders/API keys locales). Ver `docs/secrets-inventory.md` para el inventario completo.

---

## **13\. Convenciones de Código**

* **Lenguaje backend:** TypeScript (Node.js 20) preferido. Python si la librería de parsing lo requiere.
* **Lenguaje frontend:** HTML + Vanilla JS ó React 18. Sin frameworks CSS (Vanilla CSS con variables CSS).
* **Naming de resources Azure:** kebab-case con prefijo de tipo (`func-`, `app-`, `aoai-`, `st`, `rg-`).
* **Naming de funciones:** camelCase. Naming de archivos: kebab-case.
* **Logging:** Usar `context.log()` en Functions. Todos los errores deben loguearse con el `materialId` o `classId` como contexto para facilitar el debugging en App Insights.
* **Chunking:** Tamaño de chunk: 512 tokens. Solapamiento: 50 tokens. Usar `tiktoken` para contar tokens.
* **Autenticación:** En **producción** los secretos se resuelven desde Key Vault vía references de Functions y el acceso a Storage/OpenAI usa Managed Identity (`DefaultAzureCredential`) cuando los roles RBAC están otorgados (ver §12 y `docs/secrets-inventory.md`). En **local** se usan valores de `backend/local.settings.json` / `.env.local` (gitignored) generados con `scripts/bootstrap-local-secrets.sh`. Nunca commitear keys al repositorio.
* **Sin mocks en producción:** Los mocks de SGA (notas/asistencia) son únicamente para el prototipo de frontend. El backend debe dejar los endpoints preparados para conectar una API real.

---

## **14. Azure Diagram Agent Skill (Draw.io Integration)**

Cuando el usuario solicite diagramas de arquitectura, flujo o red, el agente debe actuar como un experto **Azure Solutions Architect** y utilizar la herramienta `drawio-mcp`.

### **13.1. Reglas de Diagramación (SKILL.md)**

Para evitar diagramas saturados (*cluttered*), se deben seguir estos patrones:

| # | Problema | Solución |
|---|---------|---------|
| 1 | Labels repetidos en 3+ aristas | Usar labels específicos para cada destino (ej: `POST /login`, `SQL Auth`). |
| 2 | 3+ líneas saliendo de una cara | Spread `exitX` valores con al menos 0.15 de gap + Waypoints. |
| 3 | Observabilidad dentro de VNet | **Monitor, Log Analytics y Sentinel** deben estar FUERA de la VNet (a la derecha). |
| 4 | Iconos flotantes | Anclar iconos decorativos (VNet, Region) a la esquina superior derecha (`top-right`). |
| 5 | XML de una sola línea | Generar `mxGraphModel` con un `<mxCell>` por línea e identación clara. |

### **13.2. Estilo de Iconos (Azure2)**

Utilizar el catálogo `Azure2` con formato de imagen (no formas nativas):
`style="image;aspect=fixed;...;image=img/lib/azure2/<category>/<Icon>.svg;"`

### **13.3. Checklist de Finalización**
- [ ] Labels únicos por arista.
- [ ] Faneo de aristas con `exitX` >= 0.15.
- [ ] Telemetría y Seguridad (Monitor/Sentinel) fuera de la zona de red.
- [ ] Iconos de zona anclados.
- [ ] XML indentado y legible.

### **13.4. Instrucción de Herramienta**
Invocar `drawio-mcp` para crear el diagrama y guardar el resultado como `.drawio` envuelto en un tag `<mxfile><diagram>...</diagram></mxfile>` si se requiere un archivo físico.

---

## **15. CI/CD — Deployment Tokens (Workaround mientras no hay RBAC)**

Actualmente el CI/CD usa **SWA deployment token** + **Function App publish profile** porque el Service Principal no tiene RBAC en el RG (falta permiso Owner para asignarlo).

### **15.1. Workarounds Técnicos**

| Componente | Método | Token/Secret |
|---|---|---|
| Frontend (SWA) | `Azure/static-web-apps-deploy@v1` | `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| Backend (Functions) | `Azure/functions-action@v1` | `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` |

### **15.2. ⚠ Deuda Técnica — Migrar a OIDC + azd**

Cuando se tenga acceso Owner en el RG (`RG_UADE_INNOVA_DEV`), migrar a:

```bash
# 1. Asignar Contributor al SP existente
az role assignment create \
  --assignee 09abbcbe-e229-499b-8d94-4bea1f9eab3e \
  --role Contributor \
  --scope /subscriptions/e581a4ea-1c70-477b-9258-98a51fac57cf/resourceGroups/RG_UADE_INNOVA_DEV

# 2. Crear federated credentials en el SP para main y staging
#    (Entra ID → App registrations → func-dashboard-ingest-... → Certificates & secrets → Federated credentials)

# 3. Actualizar secrets de GitHub:
#    - Eliminar: AZURE_STATIC_WEB_APPS_API_TOKEN, AZURE_FUNCTIONAPP_PUBLISH_PROFILE
#    - Setear:   AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, AZURE_ENV_NAME, AZURE_LOCATION
```

Luego revertir los workflows a usar `azure/login@v2` + `azd deploy`.

### **15.3. Smoke Test de Aplicación (Story 10.20 — más allá del HTTP 200)**

El smoke test de producción (`deploy-production.yml` → `smoke-test`) y de staging
(`staging.yml` → `health-check`) ejecuta `node backend/scripts/smoke-prod-application-state.js`
**después** de los curls de HTTP 200. El probe afirma estado real de la aplicación y
**bloquea el release** (exit ≠ 0 + anotación `::error::`) si cualquier check ejecutado falla.

**Checks del probe:**
- `identity-endpoint` — `GET {SMOKE_SWA_URL}/.auth/me` → 200 + JSON con clave `clientPrincipal`
- `auth-redirect` — `GET {SMOKE_SWA_URL}/.auth/login/aad` → cadena 3xx que llega a `login.microsoftonline.com`
- `app-shell` — `GET {SMOKE_SWA_URL}/` → 200 + HTML con `id="app"` y entry point JS (`/src/main.js` en dev/raw, `/assets/*.js` en build de producción)
- `no-dead-end-browser` *(opcional)* — Playwright: la raíz debe redirigir a `login.microsoftonline.com`
- `authenticated-marker` *(opcional)* — tras sign-in, el DOM tiene `data-app-state="authenticated"` (marker T1 en `frontend/src/main.js`)
- `function-health` *(opcional)* — `/api/hello` con header `x-azure-fdid` cuando hay Front Door

**Secrets requeridos (nunca commitear, ver §12/§13):**
`SMOKE_SWA_URL` (obligatorio), `SMOKE_AUTH_ENABLED`, `SMOKE_TEST_EMAIL`,
`SMOKE_TEST_CLIENT_ID`, `SMOKE_TEST_CLIENT_SECRET`, `SMOKE_BROWSER_CHECK`, `SMOKE_TIMEOUT_MS`.
La identidad smoke debe estar en la allowlist del backend (Story 10-25 / #266). Checks
deshabilitados imprimen `SKIP`; `SMOKE_AUTH_ENABLED=true` sin identidad → fail cerrado.

**Ejecución local:**
```bash
SMOKE_SWA_URL=https://<swa-host>.azurestaticapps.net node backend/scripts/smoke-prod-application-state.js
# Browser checks: cd frontend && npm ci  (o SMOKE_PLAYWRIGHT_PATH=...)
```

### **15.4. Canary de Aislamiento de Fuentes RAG (Story 3.7 / #261 — cierra QA-002)**

El smoke gate de producción (`deploy-production.yml` → `smoke-test`) y de staging
(`staging.yml` → `health-check`) ejecuta `node backend/scripts/canary-rag-source-isolation.js`
**después** del probe 15.3. Es un probe HTTPS standalone que consulta el `POST /api/rag-query`
desplegado con un scope por rol (student/teacher/director/admin) y **afirma que cada source
devuelto tiene el `subjectId` solicitado y que `classId`/`classIds` intersecta el scope pedido**.
`subjectId` se verifica siempre; `classId` solo en fuentes no-`bibliography` (el filtro Pinecone
tiene fallback de bibliografía entre clases del mismo subject). Un mismatch, un `sources[]` vacío
("aislamiento no verificable") o un HTTP 401/403/429 → exit ≠ 0 + `::error::` → **bloquea el release**.

**Gating / fail closed:** las queries RAG solo corren con `RAG_CANARY_ENABLED=true`. Una vez habilitado,
los 4 emails por rol son obligatorios (`RAG_CANARY_STUDENT_EMAIL`, `RAG_CANARY_TEACHER_EMAIL`,
`RAG_CANARY_DIRECTOR_EMAIL`, `RAG_CANARY_ADMIN_EMAIL`) y faltantes → fail cerrado. Requiere además que
esas identidades estén en `ALLOWED_USERS_JSON` (Key Vault-referenced; **nunca commitear emails/keys**)
y que pasen las gates de `rag-query.js`: enrollment activo + consent aceptado (student/admin) y
materiales `reviewed=true` en el scope. Ese provisioning depende de UADE admin y está **bloqueado**;
hasta entonces el workflow corre el canary con `RAG_CANARY_ENABLED=false` (imprime `SKIP`).

**Secrets (nunca commitear, ver §12/§13):**
`RAG_CANARY_ENABLED`, `RAG_CANARY_FUNCTION_URL`, `RAG_CANARY_FRONT_DOOR_ID`,
`RAG_CANARY_SUBJECT_ID` (default `arq-software-2026`), `RAG_CANARY_CLASS_IDS` (default `class-01`),
`RAG_CANARY_QUESTION`, `RAG_CANARY_TIMEOUT_MS`, `RAG_CANARY_{STUDENT,TEACHER,DIRECTOR,ADMIN}_EMAIL`
(y opcionalmente `RAG_CANARY_<ROLE>_{SUBJECT_ID,CLASS_IDS,QUESTION}`). Documentación completa y
ejecución local en `docs/deployment-guide.md` §CI/CD.

## **16. Ciclo de Vida de Implementación y Verificación**

Para garantizar la calidad y disponibilidad del dashboard, se establece el siguiente flujo obligatorio para cada tarea de implementación:

1.  **Despliegue Mandatorio**: Todo cambio de código o nueva funcionalidad debe ser desplegado a Azure inmediatamente después de su implementación local utilizando el comando `azd deploy`.
2.  **Prueba en Producción/Staging**: No es suficiente con pruebas locales. El agente DEBE acceder a la URL pública de la Azure Static Web App utilizando el **navegador embebido de Orca** (NO Playwright MCP / NO Chrome MCP). Usá el ciclo `orca goto --url <url>` → `orca snapshot` → interactuar → `orca snapshot` (ver `.agents/rules/deployment-verification.md` para los comandos completos).
3.  **Verificación E2E**: Se debe verificar el funcionamiento de la característica implementada directamente en el navegador, asegurando que la integración con Azure Functions y otros servicios sea correcta.
4.  **Cierre de Tarea**: Una tarea solo se considera finalizada una vez que se ha confirmado visualmente su funcionamiento en el entorno desplegado.

---

## **18. Azure Cost Management — Configuración para Costos Reales**

El dashboard del director puede mostrar costos reales de Azure en vez del cálculo por tokens. Requiere:

### **18.1. Crear Service Principal y asignar rol**

Ejecutar con una cuenta que tenga permisos de **Owner** en la suscripción o **User Access Administrator**:

```bash
# 1. Crear Service Principal con rol Cost Management Reader en la suscripción
az ad sp create-for-rbac \
  --name sp-cost-mgmt-dashboard \
  --role "Cost Management Reader" \
  --scope /subscriptions/e581a4ea-1c70-477b-9258-98a51fac57cf

# Este comando devuelve:
# {
#   "appId": "<AZURE_CLIENT_ID>",
#   "displayName": "sp-cost-mgmt-dashboard",
#   "password": "<AZURE_CLIENT_SECRET>",
#   "tenant": "<AZURE_TENANT_ID>"
# }
```

### **18.2. Configurar variables de entorno en la Function App**

```bash
az functionapp config appsettings set \
  --name func-dashboard-ingest-q47bia47kk3na \
  --resource-group RG_UADE_INNOVA_DEV \
  --settings \
    AZURE_CLIENT_ID="<appId-del-paso-anterior>" \
    AZURE_CLIENT_SECRET="<password-del-paso-anterior>" \
    AZURE_TENANT_ID="<tenant-del-paso-anterior>"
```

`AZURE_SUBSCRIPTION_ID` ya está configurada en `e581a4ea-1c70-477b-9258-98a51fac57cf`.

### **18.3. Verificar**

Acceder al dashboard del director (`#/director/dashboard`). La card de costos debe mostrar:
```
Fuente: Azure Cost Management API · Incluye N servicios
```

### **18.4. Variables de entorno adicionales (opcionales)**

| Variable | Default | Descripción |
|---|---|---|
| `DIRECTOR_BUDGET_MONTHLY_USD` | `10000` | Presupuesto mensual en USD |
| `BUDGET_WEEKEND_FACTOR` | `0.6` | Factor de actividad en fines de semana (0-1) |
| `AI_INPUT_COST_PER_MILLION_TOKENS` | `0.15` | Costo por millón de tokens input (fallback token-based) |
| `AI_OUTPUT_COST_PER_MILLION_TOKENS` | `0.60` | Costo por millón de tokens output (fallback token-based) |

---

## **17. Índice de Conocimiento del Proyecto (`docs/`)**

El directorio `docs/` es la fuente de `project_knowledge` (configurado en `_bmad/bmm/config.yaml`). Contiene documentación persistente del proyecto. Los agentes deben leer estos archivos según corresponda al contexto de la tarea.

| Archivo | Descripción |
|---|---|
| `docs/Documento de Alcance Funcional.md` | Alcance funcional completo del dashboard educativo |
| `docs/Dashboard educativo inteligente con IA integrando transcripts de Microsoft Stream.txt` | Contexto y visión del proyecto |
| `docs/architecture-review.md` | Decisiones y revisión de arquitectura del sistema |
| `docs/api-error-contracts.md` | Contratos de errores para las APIs del backend |
| `docs/correlation-middleware.md` | Documentación del middleware de correlación para trazabilidad |
| `docs/graph-api-credentials.md` | Configuración de credenciales para Microsoft Graph API |
| `docs/kql-correlation-queries.md` | Consultas KQL para correlación en Application Insights |
| `docs/notifications-api.json` | Especificación OpenAPI del sistema de notificaciones |
| `docs/project-scan-report.json` | Reporte de escaneo del proyecto |
| `docs/project-status.md` | Estado general del proyecto |
| `docs/reindex-vector-classid-migration.md` | Plan de migración de índices vectoriales con nuevo classId |
| `docs/sga-openapi.json` | Especificación OpenAPI del SGA (Sistema de Gestión Académica) |
