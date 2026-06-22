# Arquitectura — Backend (Azure Functions + RAG)

## Resumen Ejecutivo

Backend serverless con ~55 endpoints HTTP, 6 funciones timer-triggered y 1 blob-triggered. Implementa un pipeline RAG completo: ingesta de materiales → chunking → embeddings → Pinecone → retrieval aumentado con DeepSeek V4 Flash. Desplegado en Azure Functions Consumption Plan.

## Stack Tecnológico

| Categoría | Tecnología |
|---|---|
| Runtime | Node.js 20 (Azure Functions Consumption Y1) |
| Lenguaje | JavaScript (ES Modules) |
| Chat LLM | DeepSeek V4 Flash (Azure AI Foundry) |
| Embeddings | text-embedding-3-small (Azure OpenAI) |
| TTS | Azure OpenAI TTS |
| Vector DB | Pinecone Serverless (cosine, dim 1536) |
| Blob Storage | Azure Blob Storage (class-materials, processed, chat-logs, etc.) |
| DB Operacional | Azure Table Storage (11 tablas) |
| Observabilidad | Azure Application Insights |
| Secrets | Azure Key Vault |
| Auth | Azure Static Web Apps EasyAuth + Front Door |

## Patrón Arquitectónico

**Serverless Microservicios + Pipeline RAG**

```
HTTP Request → SWA EasyAuth → Azure Front Door → Azure Functions
                                                      │
                                ┌─────────────────────┼─────────────────────┐
                                │                     │                     │
                          correlation.js         auth-utils.js       error-categories.js
                          (W3C trace)        (parseClientPrincipal)   (CategorizedError)
                                │
                    ┌───────────┴───────────┐
                    │                       │
            ┌───────▼───────┐       ┌───────▼───────┐
            │  HTTP Funcs   │       │ Timer/Blob    │
            │  (~55)        │       │ Funcs (~7)    │
            └───────┬───────┘       └───────┬───────┘
                    │                       │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │    Servicios Core     │
                    │  ai.js  pipeline.js   │
                    │  vector-store.js      │
                    │  parser.js  storage.js│
                    │  state-store.js       │
                    │  rag-ranking.js       │
                    └───────────┬───────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   Pinecone DB           Azure Storage            Azure OpenAI
   (vectors)         (Blobs + Tables)        (embeddings + TTS)
```

## Pipeline de Ingesta

```
Upload (multipart) → validateFrontDoorId → validateEnrollment
  → uploadStream a Blob Storage (class-materials/)
  → Blob Trigger → process-material.js
       → runPipeline:
           1. parseFile (mammoth/pdf-parse/adm-zip)
           2. chunkText (512 tokens, 50 overlap, tiktoken)
           3. generateEmbeddingsBatch (20 lote, 3 retries)
           4. upsertVectors a Pinecone (batch 100)
           5. generateClassSummary + generateClassMap (paralelo)
           6. saveJson a processed/ container
           7. telemetry → App Insights
```

## Pipeline RAG (Query)

```
Pregunta → rag-query.js
  1. rewriteWithHistory (follow-up questions)
  2. generateEmbedding (text-embedding-3-small)
  3. verified-answer pre-search (score > 0.85 → skip LLM)
  4. querySimilar en Pinecone (filter por classIds)
  5. buildHybridContext (ranking + diversidad por fuente)
  6. buildAugmentedPrompt (system + context + question)
  7. chatCompletion (DeepSeek V4 Flash, temp 0.3, max 1500)
  8. SSE streaming (metadata → delta → done) o blocking
  9. telemetry → App Insights
```

## Base de Datos

### Azure Table Storage (11 tablas)
| Tabla | Propósito |
|---|---|
| `materials` | Estado de materiales (subjectId + materialId) |
| `classes` | Configuración de clases por materia |
| `Enrollments` | Inscripciones de usuarios |
| `UserProfiles` | Perfiles de usuario |
| `UserConsent` | Consentimientos |
| `Corrections` | Correcciones de respuestas |
| `CorrectionsPending` | Correcciones pendientes |
| `Conversations` | Conversaciones guardadas |
| `ConversationRatings` | Ratings de conversaciones |
| `Interventions` | Intervenciones de alumnos |
| `RiskThresholds` | Umbrales de riesgo |
| `SessionMetrics` | Métricas de sesión |
| `NotificationPreferences` | Preferencias de notificaciones |
| `UserEvents` | Eventos de usuario |
| `SubjectWeights` | Pesos de materiales por materia |

### Azure Blob Storage (7 contenedores)
| Contenedor | Propósito |
|---|---|
| `class-materials` | Archivos subidos por docentes |
| `processed` | Texto procesado + metadatos |
| `chat-logs` | Logs de conversaciones |
| `deadlines` | Configuración de deadlines |
| `class-summaries` | Resúmenes IA de clases |
| `class-maps` | Mapas conceptuales |
| `compliance` | Políticas de retención |
| `teacher-alerts` | Alertas de feedback IA |
| `vector-snapshots` | Snapshots de Pinecone |
| `notifications` | Notificaciones por materia |

### Pinecone (Índice Vectorial)
- **Índice**: `dashboard-edu-pilot`
- **Dimensión**: 1536
- **Métrica**: Cosine Similarity
- **Metadata por chunk**: subjectId, classIds, materialId, materialType, materialPriority, chunkIndex, sourceFilename, lectureDate, text, slideTitle

## Seguridad

| Capa | Mecanismo |
|---|---|
| Edge | Azure Front Door (header `x-azure-fdid`) |
| Auth | SWA EasyAuth → `x-ms-client-principal` |
| Roles | `parseClientPrincipal` → Director/Docente/Alumno |
| Enrollment | Verificación de inscripción activa |
| Tracing | Correlation ID + W3C traceparent |
| Secrets | Azure Key Vault con referencias |

## Telemetría (Application Insights)

| Evento Personalizado | Propósito |
|---|---|
| `RAGInteraction` | Tokens, latencia, prompt version |
| `IngestionInteraction` | Pipeline de ingesta |
| `UserLogin` | Login de usuario |
| `VectorSearchDependency` | Búsqueda en Pinecone |
| `RAGErrorCategorized` | Errores categorizados |
| `DispatcherRun` | Ejecución de timers |
| `VectorBackupRun` | Backup de vectores |
| `VectorIndexAnomalyAlert` | Alertas de anomalías |

## Funciones Timer-Triggered

| Función | Cron | Propósito |
|---|---|---|
| `daily-reminders` | `0 0 8 * * *` | Recordatorios a docentes |
| `deadline-proximity-dispatcher` | Cada 30 min | Notificaciones de deadlines |
| `post-class-summary-dispatcher` | Cada 15 min | Resúmenes disponibles |
| `vector-backup-scheduler` | `0 0 3 * * *` | Backup diario Pinecone |
| `vector-health-monitor` | Cada 15 min | Monitoreo de salud |
| `vector-health-snapshotter` | Cada 15 min | Snapshots de métricas |
