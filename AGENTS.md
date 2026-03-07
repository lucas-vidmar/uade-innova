# **Contexto del Agente: Dashboard Educativo Inteligente (UADE)**

Este documento sirve como marco de referencia para la implementación del sistema RAG (Retrieval-Augmented Generation) para el proyecto de Dashboard Educativo.

## **1\. Visión General del Proyecto**

* **Objetivo:** Transformar la experiencia académica mediante IA generativa sobre materiales de clase (transcripciones, presentaciones, apuntes y bibliografía) cargados manualmente por los docentes desde la plataforma.  
* **Población Objetivo:** Piloto de 65 alumnos y docentes (1 materia).  
* **Meta de Adopción:** 60% de uso activo durante el cuatrimestre.

## **2\. Stack Tecnológico (Azure Cloud & AI)**

Para maximizar el FinOps y minimizar el CapEx, se utiliza una arquitectura **100% Serverless** (sin VMs reservadas):

* **Generative AI:** Azure OpenAI Service.
  * **Modelos:** gpt-4o-mini (Chat/Razonamiento) y text-embedding-3-small (Vectorización).
  * **Nota:** UADE ya provisionó el recurso `RS-OPENAI-LLM` en el RG `RG_UADE_INNOVA_DEV`.
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

* **Zero-Trust:** Prohibido el uso de API Keys hardcodeadas. Se deben usar **Managed Identities** para la comunicación entre servicios.  
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
    ├── appinsights.bicep    # Application Insights + Log Analytics
    └── identity.bicep       # Managed Identities + role assignments (pendiente permisos UADE)
```

### **7.3. Recursos a definir en Bicep**

| **Recurso** | **Nombre sugerido** | **Notas clave** |
|---|---|---|
| Resource Group | `RG_UADE_INNOVA_DEV` | Asignado por UADE. Todos los recursos dentro de este RG. |
| Azure OpenAI | `RS-OPENAI-LLM` (existente) | Ya provisionado por UADE en eastus2. |
| Azure Functions | `func-dashboard-ingest-{token}` | Runtime: Node.js 20. Plan: **Consumption Y1** (sin VM quota). |
| Azure Storage | `stdashboard{token}` (max 24 chars) | Contenedores: `class-materials` y `processed`. |
| Azure Static Web Apps | `stapp-dashboard-{token}` | **Free tier.** CDN global, SSL, 100 GB/mes. Sin VM quota. |
| App Insights | `appi-dashboard-{token}` | Vinculado a Functions para trazas y costos. |
| Key Vault | `kv-edu-{token}` | Almacena Pinecone API Key como secret. |
| Managed Identity | Asignada a Functions | Auth Zero-Trust contra OpenAI y Storage. (RBAC pendiente UADE.) |

---

## **8\. Estructura del Proyecto (Monorepo)**

El repositorio sigue esta estructura. El agente debe crear archivos únicamente en las rutas definidas aquí:

```
azure-educational-dashboard/
├── azure.yaml                   # Manifiesto azd
├── .env.local                   # Variables locales (NO commitear, en .gitignore)
├── infra/                       # IaC (Bicep) - ver sección 7
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

## **9\. Modelos de Datos (Entidades Clave)**

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

## **10\. Contratos de API (Azure Functions)**

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

**Response `200 OK`:**

```json
{
  "answer": "La arquitectura hexagonal...",
  "sources": [
    { "materialType": "transcript", "classId": "class-03", "chunkIndex": 12, "sourceFilename": "clase3_transcript.txt" }
  ]
}
```

---

### **GET `/api/classes?subjectId={id}`** — Lista de clases con estado de materiales

**Response `200 OK`:** Array de `Class[]` con sus `Material[]` anidados.

---

## **11\. Variables de Entorno Requeridas**

Estas variables son generadas por `azd provision` y deben estar presentes en `.env.local` (local) y en la configuración de Static Web App / Functions (producción). El agente nunca debe hardcodear estos valores.

```bash
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://<rs-openai-llm>.openai.azure.com/
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small

# Pinecone
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=dashboard-edu-pilot
PINECONE_ENVIRONMENT=...

# Azure Storage
AZURE_STORAGE_ACCOUNT_NAME=stdashboard{token}
AZURE_STORAGE_CONTAINER_MATERIALS=class-materials

# Identity (se inyecta automáticamente via Managed Identity en Azure)
AZURE_CLIENT_ID=...
AZURE_TENANT_ID=...

# App (generado por azd desde la URL de Static Web Apps)
VITE_API_BASE_URL=https://func-dashboard-ingest-{token}.azurewebsites.net/api
AZURE_STATIC_WEB_APP_URI=https://<nombre>.azurestaticapps.net
```

---

## **12\. Convenciones de Código**

* **Lenguaje backend:** TypeScript (Node.js 20) preferido. Python si la librería de parsing lo requiere.
* **Lenguaje frontend:** HTML + Vanilla JS ó React 18. Sin frameworks CSS (Vanilla CSS con variables CSS).
* **Naming de resources Azure:** kebab-case con prefijo de tipo (`func-`, `app-`, `aoai-`, `st`, `rg-`).
* **Naming de funciones:** camelCase. Naming de archivos: kebab-case.
* **Logging:** Usar `context.log()` en Functions. Todos los errores deben loguearse con el `materialId` o `classId` como contexto para facilitar el debugging en App Insights.
* **Chunking:** Tamaño de chunk: 512 tokens. Solapamiento: 50 tokens. Usar `tiktoken` para contar tokens.
* **Autenticación local:** Para desarrollo local, usar una API Key de Azure OpenAI en `.env.local`. En producción, siempre Managed Identity (nunca commitear keys).
* **Sin mocks en producción:** Los mocks de SGA (notas/asistencia) son únicamente para el prototipo de frontend. El backend debe dejar los endpoints preparados para conectar una API real.