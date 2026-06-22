# Arquitectura de Integración

## Comunicación entre Partes

```
Frontend (Static Web Apps)                  Backend (Azure Functions)
         │                                          │
         │  1. HTTP/HTTPS (REST + SSE)              │
         │  ──────────────────────────────────────>  │
         │     GET /api/classes, POST /api/rag-query │
         │     GET /api/notifications/stream (SSE)   │
         │                                          │
         │  2. Static Web Apps EasyAuth              │
         │  ──────────────────────────────────────>  │
         │     x-ms-client-principal (base64)        │
         │     x-azure-fdid (Front Door ID)          │
         │                                          │
         │  3. .auth/me (SWA internal)               │
         │  <──────────────────────────────────────  │
         │     clientPrincipal (userRoles, userId)   │
         │                                          │
         │  4. Correlation Headers                   │
         │  <──────────────────────────────────────  │
         │     x-correlation-id, traceparent         │
         │                                          │

Frontend (Vite build) → Static Web Apps
Backend (Functions) → Azure Storage, Pinecone, OpenAI
```

## Puntos de Integración

### 1. Frontend → Backend (REST API)
- **Protocolo**: HTTPS
- **Autenticación**: SWA EasyAuth (headers `x-ms-client-principal`)
- **Headers de correlación**: `x-correlation-id`, `traceparent` (W3C)
- **Formato**: JSON (request/response)
- **SSE**: Endpoint `/api/notifications/stream` y `/api/rag-query` (streaming)

### 2. Backend → Azure OpenAI
- **Propósito**: Embeddings y TTS
- **Autenticación**: API Key o Managed Identity
- **Modelos**: `text-embedding-3-small`, `tts-1`

### 3. Backend → Azure AI Foundry (DeepSeek)
- **Propósito**: Chat/razonamiento para RAG
- **Autenticación**: API Key
- **Modelo**: `deepseek-v4-flash`

### 4. Backend → Pinecone
- **Propósito**: Almacenamiento y búsqueda vectorial
- **Autenticación**: API Key
- **Operaciones**: upsert, query, delete, stats

### 5. Backend → Azure Storage
- **Propósito**: Blobs (archivos, logs, estados) + Tables (datos operacionales)
- **Autenticación**: Access Key o Managed Identity

### 6. Backend → Application Insights
- **Propósito**: Telemetría personalizada
- **Autenticación**: Connection String

## Dependencias Compartidas

| Dependencia | Partes que la usan |
|---|---|
| API Base URL (`VITE_API_BASE_URL`) | Frontend → Backend |
| Application Insights | Backend (telemetría) + Frontend (vía SWA) |
| Azure Storage connection string | Backend (blobs + tables) |
| Key Vault references | Backend (secrets via app settings) |

## Flujo de Datos: Ingesta de Material

```
Docente → Frontend (FileUpload)
  → POST /api/ingest-material (multipart)
    → Backend: validate + uploadStream a Blob
      → Blob Trigger: process-material.js
        → parseFile → chunkText → generateEmbeddings → Pinecone upsert
        → generateSummary → generateMap (paralelo)
        → save processed JSON → telemetry
  ← Response: { materialId, status: "processing" }
  ← Frontend: polling via processingNotifications
```

## Flujo de Datos: Consulta RAG

```
Alumno → Frontend (ChatWidget)
  → POST /api/rag-query (JSON)
    → Backend: verify enrollment + consent
      → generateEmbedding → Pinecone querySimilar
      → buildHybridContext → DeepSeek chatCompletion
    ← SSE stream (metadata → delta → done)
  ← Frontend: render Markdown + citas + feedback
```
