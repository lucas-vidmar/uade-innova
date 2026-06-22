# Inventario de Componentes — Backend (Azure Functions)

## Descripción General

El backend se compone de ~62 archivos de funciones distribuidas en 3 tipos de triggers, 16 servicios compartidos, y 1 middleware. Organizado en una arquitectura de microservicios serverless.

---

## Funciones HTTP (~55 endpoints)

### Gestión de Materias y Clases (`classes-api.js`)
| Función | Ruta | Propósito |
|---|---|---|
| `get-subjects` | `GET /api/subjects` | Lista materias |
| `save-subject` | `POST/PUT /api/subjects` | Crear/actualizar materia |
| `delete-subject` | `DELETE /api/subjects/{id}` | Eliminar materia |
| `get-classes` | `GET /api/classes/{subjectId}` | Lista clases |
| `save-classes` | `POST/PUT /api/classes` | Guardar clases |
| `get-class-summary` | `GET /api/class-summary/{id}` | Obtener resumen IA |
| `save-class-summary` | `POST /api/class-summary/{id}` | Guardar resumen |
| `get-class-map` | `GET /api/class-map/{id}` | Obtener mapa conceptual |
| `save-class-map` | `POST /api/class-map/{id}` | Guardar mapa |
| `get-class-audio` | `GET /api/class-audio/{id}` | Obtener URL audio TTS |
| `get-class-timeline` | `GET /api/class-timeline/{id}` | Timeline de clase |
| `save-class-timeline` | `POST /api/class-timeline/{id}` | Guardar timeline |

### Pipeline de Materiales (`ingest-material.js`, `material-download.js`, etc.)
| Función | Ruta | Propósito |
|---|---|---|
| `ingest-material` | `POST /api/ingest-material` | Subir archivo |
| `get-material-status` | `GET /api/material-status/{id}` | Estado individual |
| `get-material-status-batch` | `GET /api/material-status/batch` | Estado batch |
| `post-material-status-batch` | `POST /api/material-status/batch` | Estado batch (POST) |
| `delete-material` | `DELETE /api/materials/{id}` | Eliminar material |
| `reprocess-material` | `POST /api/materials/{id}/reprocess` | Reprocesar |
| `update-material` | `PATCH /api/materials/{id}` | Actualizar metadatos |
| `get-material-text` | `GET /api/materials/{id}/text` | Texto procesado |
| `update-material-text` | `PUT /api/materials/{id}/text` | Re-chunk + re-embed |
| `material-download` | `GET /api/material-download` | URL SAS descarga |

### RAG y Chat (`rag-query.js`, `chat-api.js`, `conversations-api.js`)
| Función | Ruta | Propósito |
|---|---|---|
| `rag-query` | `POST /api/rag-query` | Chat RAG (streaming) |
| `global-search` | `POST /api/global-search` | Búsqueda global |
| `get-chat-history` | `GET /api/chat-history` | Historial |
| `delete-chat-history` | `DELETE /api/chat-history` | Limpiar historial |
| `chat-feedback` | `POST /api/chat-feedback` | Feedback (+/-) |
| `chat-rate` | `POST /api/chat-rate` | Rating detallado |
| `chat-report-issue` | `POST /api/chat-report-issue` | Reportar problema |
| `save-conversation` | `PUT /api/conversations/{id}` | Guardar conversación |
| `list-conversations` | `GET /api/conversations` | Listar conversaciones |
| `get-conversation` | `GET /api/conversations/{id}` | Obtener conversación |
| `delete-conversation` | `DELETE /api/conversations/{id}` | Eliminar conversación |
| `get-sat-analytics` | `GET /api/sat-analytics` | SAT analytics |
| `teacher-ai-feedback-alerts` | `GET /api/teacher/ai-feedback-alerts` | Alertas feedback |

### Notificaciones (`notifications.js`)
| Función | Ruta | Propósito |
|---|---|---|
| `get-notifications` | `GET /api/notifications` | Listar notificaciones |
| `mark-notification-read` | `PATCH /api/notifications/{id}/read` | Marcar leída |
| `mark-notifications-read` | `POST /api/notifications/read` | Marcar leídas batch |
| `stream-notifications` | `GET /api/notifications/stream` | SSE stream |

### Deadlines (`deadlines.js`)
| Función | Ruta | Propósito |
|---|---|---|
| `get-deadlines` | `GET /api/deadlines` | Listar deadlines |
| `save-deadline` | `POST/PUT /api/deadlines` | Guardar deadline |
| `get-deadline-reminders` | `GET /api/deadline-reminders` | Recordatorios |

### Perfil y Preferencias
| Función | Ruta | Archivo |
|---|---|---|
| `get-profile` | `GET /api/get-profile` | `get-profile.js` |
| `save-profile` | `POST /api/save-profile` | `save-profile.js` |
| `get-terms` | `GET /api/terms` | `consent-api.js` |
| `get-consent` | `GET /api/consent` | `consent-api.js` |
| `save-consent` | `POST /api/consent` | `consent-api.js` |
| `get-reminder-preferences` | `GET /api/reminder-preferences` | `reminder-preferences.js` |
| `save-reminder-preferences` | `POST /api/reminder-preferences` | `reminder-preferences.js` |

### SGA y Alumnos (Mock)
| Función | Ruta | Archivo |
|---|---|---|
| `sga-get-tasks` | `GET /api/sga/tasks` | `sga-api.js` |
| `sga-get-attendance` | `GET /api/sga/attendance` | `sga-api.js` |
| `sga-get-teacher-alerts` | `GET /api/sga/teacher-alerts` | `sga-api.js` |
| `sga-get-early-alerts` | `GET /api/sga/early-alerts` | `sga-api.js` |
| `get-tasks` | `GET /api/tasks` | `get-tasks.js` |

### Director y Admin
| Función | Ruta | Archivo |
|---|---|---|
| `get-director-stats` | `GET /api/director/stats` | `classes-api.js` |
| `get-director-powerbi-metrics` | `GET /api/director/powerbi-metrics` | `classes-api.js` |
| `get-director-session-metrics` | `GET /api/director/session-metrics-history` | `classes-api.js` |
| `manage-get-users` | `GET /api/manage/users` | `admin-api.js` |
| `get-vector-health` | `GET /api/vector-health` | `vector-health.js` |
| `get-vector-health-snapshots` | `GET /api/vector-health-snapshots` | `vector-health-snapshots-api.js` |
| `get-archive-usage` | `GET /api/archive-usage` | `archive-usage.js` |
| `get-compliance-policy` | `GET /api/compliance/retention-policy` | `compliance-api.js` |
| `get-compliance-export` | `GET /api/compliance/retention-export` | `compliance-api.js` |
| `get-director-kpi-export` | `GET /api/director/kpi-export` | `director-kpi-export.js` |
| `get-subject-weights` | `GET /api/subject-weights/{id}` | `subject-weights-api.js` |
| `save-subject-weights` | `PUT /api/subject-weights/{id}` | `subject-weights-api.js` |

### Intervenciones
| Función | Ruta | Archivo |
|---|---|---|
| `get-interventions` | `GET /api/interventions` | `interventions-api.js` |
| `update-intervention` | `PUT /api/interventions` | `interventions-api.js` |
| `compute-interventions` | `POST /api/interventions/compute` | `interventions-api.js` |
| `get-risk-thresholds` | `GET /api/risk-thresholds` | `interventions-api.js` |
| `update-risk-thresholds` | `PUT /api/risk-thresholds` | `interventions-api.js` |

### Correcciones y Transcripciones
| Función | Ruta | Archivo |
|---|---|---|
| `get-pending-reports` | `GET /api/corrections-pending` | `corrections/index.js` |
| `verify-answer` | `POST /api/corrections-verify` | `corrections/verify.js` |
| `update-correction-status` | `PATCH /api/corrections-status` | `corrections/status.js` |
| `get-transcription-suggestions` | `GET /api/corrections-transcription` | `corrections-transcription/index.js` |
| `apply-transcription-correction` | `POST /api/corrections-transcription/apply` | `corrections-transcription/apply.js` |
| `reject-transcription-suggestion` | `POST /api/corrections-transcription/reject` | `corrections-transcription/reject.js` |
| `get-glossary` | `GET /api/glossary` | `glossary/index.js` |
| `update-glossary` | `POST /api/glossary` | `glossary/update.js` |

### Utilidades
| Función | Ruta | Archivo |
|---|---|---|
| `hello` | `GET /api/hello` | `hello.js` |
| `get-vector-backup` | `GET /api/vector-backup` | `vector-backup.js` |
| `trigger-vector-backup` | `POST /api/vector-backup` | `vector-backup.js` |
| `get-backup-approval` | `GET /api/backup-approval` | `backup-approval-api.js` |
| `create-backup-approval` | `POST /api/backup-approval` | `backup-approval-api.js` |
| `revoke-backup-approval` | `DELETE /api/backup-approval` | `backup-approval-api.js` |
| `get-class-audio` | `GET /api/class-audio/{id}` | `audio-api.js` |
| `ingest-polling-telemetry` | `POST /api/telemetry/polling` | `classes-api.js` |

## Funciones Timer-Triggered (6)

| Función | Archivo | Cron | Propósito |
|---|---|---|---|
| `daily-reminders` | `daily-reminders.js` | `0 0 8 * * *` | Recordatorios docentes |
| `deadline-proximity-dispatcher` | `deadline-proximity-dispatcher.js` | Cada 30 min | Notif. deadlines próximos |
| `post-class-summary-dispatcher` | `post-class-summary-dispatcher.js` | Cada 15 min | Resúmenes listos |
| `vector-backup-scheduler` | `vector-backup-scheduler.js` | `0 0 3 * * *` | Backup Pinecone diario |
| `vector-health-monitor` | `vector-health-monitor.js` | Cada 15 min | Salud del índice |
| `vector-health-snapshotter` | `vector-health-snapshotter.js` | Cada 15 min | Snapshots métricas |

## Función Blob-Triggered (1)

| Función | Archivo | Trigger | Propósito |
|---|---|---|---|
| `process-material` | `process-material.js` | Blob creado en `class-materials/` | Pipeline de ingesta |

## Servicios Compartidos (16)

| Servicio | Archivo | Responsabilidad |
|---|---|---|
| **AI Service** | `services/ai.js` | Clientes OpenAI (embeddings, chat, TTS) + DeepSeek |
| **Vector Store** | `services/vector-store.js` | Pinecone adapter (upsert, query, delete, stats) |
| **Storage** | `services/storage.js` | Blob + Table Storage clients |
| **State Store** | `services/state-store.js` | CRUD operacional (materiales, clases, enrollments, etc.) |
| **Pipeline** | `services/pipeline.js` | Orquestador de ingesta (parse → chunk → embed → index) |
| **Parser** | `services/parser.js` | Parsing de archivos (TXT, VTT, DOCX, PDF, PPTX) |
| **RAG Ranking** | `services/rag-ranking.js` | Ranking ponderado + diversidad de fuentes |
| **Prompts** | `services/prompts.js` | Carga de templates + A/B shadow testing |
| **Telemetry** | `services/telemetry.js` | Custom events de Application Insights |
| **Correlation** | `services/correlation.js` | Correlation ID + W3C traceparent |
| **Auth Utils** | `services/auth-utils.js` | SWA auth parsing + Front Door validation |
| **Error Categories** | `services/error-categories.js` | Taxonomía de errores categorizados |
| **Structured Logger** | `services/structured-logger.js` | Logging JSON estructurado |
| **Material Classification** | `services/material-classification.js` | Clasificación primary/secondary |
| **Subject Weights** | `services/subject-weights.js` | Pesos de materiales por materia |
| **Notification Store** | `services/notification-store.js` | Persistencia de notificaciones |

## Middleware (1)

| Middleware | Archivo | Propósito |
|---|---|---|
| `withCorrelation` | `middleware/with-correlation.js` | Correlation ID + trace context en functions HTTP |
| `withCorrelationTimer` | `middleware/with-correlation.js` | Correlation ID para timer-triggered |

## Dependencias Externas

| Librería | Propósito |
|---|---|
| `@azure/functions` | Azure Functions runtime |
| `openai` | OpenAI + Azure OpenAI SDK |
| `@azure/storage-blob` | Blob Storage client |
| `@azure/data-tables` | Table Storage client |
| `@azure/identity` | Managed Identity auth |
| `@azure/keyvault-secrets` | Key Vault client |
| `applicationinsights` | App Insights SDK |
| `mammoth` | DOCX parsing |
| `pdf-parse` | PDF text extraction |
| `adm-zip` | PPTX (ZIP) parsing |
| `js-tiktoken` | Token counting (cl100k_base) |
| `busboy` | Multipart form parsing |
| `uuid` | UUID generation |
