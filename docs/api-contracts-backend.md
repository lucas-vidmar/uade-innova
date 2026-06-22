# API Contracts — Backend (Azure Functions)

## Descripción General

El backend expone ~55 endpoints HTTP, 6 funciones timer-triggered y 1 blob-triggered. Todas las funciones HTTP se despliegan en Azure Functions (Consumption Plan) bajo la ruta base `/api`.

## Autenticación y Seguridad

1. **`validateFrontDoorId(request)`** — Rechaza requests sin header `x-azure-fdid` válido (Azure Front Door).
2. **`parseClientPrincipal(request)`** — Decodifica header `x-ms-client-principal` (base64) de Azure Static Web Apps.
3. **Role check** — `userRoles` incluye `Director`, `Docente`, `Alumno`.
4. **Enrollment check** — Verifica inscripción activa vía `getEnrollment(subjectId, userId)`.
5. **Correlation** — Middleware `withCorrelation` inyecta `correlationId` y `dependencyHeaders`.

## Endpoints HTTP

### Gestión de Materias

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/subjects` | Enrollment | Lista materias visibles según rol |
| POST | `/api/subjects` | Director | Crea nueva materia |
| PUT | `/api/subjects` | Director | Actualiza materia |
| DELETE | `/api/subjects/{subjectId}` | Director | Elimina materia (cascade opcional) |

### Gestión de Clases

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/classes/{subjectId}` | Enrollment | Lista clases con materiales anidados |
| POST/PUT | `/api/classes/{subjectId}` | Teacher/Director | Guarda clases |
| GET | `/api/class-summary/{classId}` | FrontDoor | Obtiene resumen IA de clase |
| POST | `/api/class-summary/{classId}` | Teacher/Director | Guarda/valida resumen |
| GET | `/api/class-map/{classId}` | FrontDoor | Obtiene mapa conceptual |
| POST | `/api/class-map/{classId}` | Teacher/Director | Guarda mapa conceptual |
| GET | `/api/class-timeline/{classId}` | FrontDoor | Obtiene timeline de clase |
| POST | `/api/class-timeline/{classId}` | Teacher/Director | Guarda timeline |
| GET | `/api/class-audio/{classId}` | FrontDoor | Obtiene URL de audio TTS |

### Pipeline de Ingesta de Materiales

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/ingest-material` | Teacher/Director | Sube archivo (multipart, 25MB max) |
| GET | `/api/material-status/{materialId}` | Enrollment | Estado de material individual |
| GET | `/api/material-status/batch` | Enrollment | Estado batch de materiales |
| POST | `/api/material-status/batch` | Enrollment | Estado batch (POST) |
| DELETE | `/api/materials/{materialId}` | Teacher/Director | Elimina material + vectores |
| POST | `/api/materials/{materialId}/reprocess` | Teacher/Director | Reprocesa material en error |
| PATCH | `/api/materials/{materialId}` | Teacher/Director | Actualiza metadatos |
| GET | `/api/materials/{materialId}/text` | Enrollment | Obtiene texto procesado |
| PUT | `/api/materials/{materialId}/text` | Teacher/Director | Actualiza texto + re-embedding |
| GET | `/api/material-download` | FrontDoor | URL de descarga (SAS 1h) |

### RAG Query (Chat IA)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/rag-query` | Enrollment + Consent | Chat RAG (streaming o blocking) |
| POST | `/api/global-search` | Enrollment | Búsqueda global en materiales |
| GET | `/api/chat-history` | Enrollment | Historial de chat |
| DELETE | `/api/chat-history` | Enrollment | Limpia historial |
| POST | `/api/chat-feedback` | Enrollment | Feedback positivo/negativo |
| POST | `/api/chat-rate` | Enrollment | Rating detallado |
| POST | `/api/chat-report-issue` | Enrollment | Reporta problema en respuesta |
| GET | `/api/conversations` | Enrollment | Lista conversaciones guardadas |
| GET | `/api/conversations/{id}` | Enrollment | Obtiene conversación |
| PUT | `/api/conversations/{id}` | Enrollment | Guarda conversación |
| DELETE | `/api/conversations/{id}` | Enrollment | Elimina conversación |
| GET | `/api/sat-analytics` | Teacher/Director | SAT analytics por subject |

### Notificaciones

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/notifications` | Enrollment | Lista notificaciones |
| PATCH | `/api/notifications/{id}/read` | Enrollment | Marca leída |
| POST | `/api/notifications/read` | Enrollment | Marca leídas (batch) |
| GET | `/api/notifications/stream` | Enrollment | SSE stream de notificaciones |

### Deadlines y Recordatorios

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/deadlines` | Enrollment | Lista deadlines |
| POST/PUT | `/api/deadlines` | Teacher/Director | Guarda deadline |
| GET | `/api/deadline-reminders` | Enrollment | Recordatorios activos |

### Perfil de Usuario

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/get-profile` | FrontDoor | Perfil del usuario |
| POST | `/api/save-profile` | FrontDoor | Guarda perfil |
| GET | `/api/terms` | FrontDoor | Términos de uso |
| GET | `/api/consent` | FrontDoor | Estado de consentimiento |
| POST | `/api/consent` | FrontDoor | Acepta consentimiento |
| GET | `/api/reminder-preferences` | FrontDoor | Preferencias de recordatorios |
| POST | `/api/reminder-preferences` | FrontDoor | Guarda preferencias |

### SGA (Sistema de Gestión Académica — Mock)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/sga/tasks` | Enrollment | Tareas del alumno (mock) |
| GET | `/api/sga/early-alerts` | Director | Alertas tempranas (mock) |
| GET | `/api/sga/attendance` | Teacher/Director | Asistencia (mock) |
| GET | `/api/sga/teacher-alerts` | Teacher/Director | Alertas docente (mock) |
| GET | `/api/enrollments` | Self/Director | Inscripciones |
| GET | `/api/enrollments/check` | FrontDoor | Verifica inscripción |
| POST | `/api/enrollments` | Teacher/Director | Crea inscripción |
| DELETE | `/api/enrollments` | Director | Elimina inscripción |
| GET | `/api/analytics` | Teacher/Director | Analytics docente |
| GET | `/api/tasks` | Self/Director | Tareas priorizadas (mock) |

### Intervenciones

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/interventions` | Director | Lista intervenciones |
| PUT | `/api/interventions` | Director | Actualiza intervención |
| POST | `/api/interventions/compute` | Director | Computa intervenciones |
| GET | `/api/risk-thresholds` | Director | Umbrales de riesgo |
| PUT | `/api/risk-thresholds` | Director | Actualiza umbrales |

### Director/Admin

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/director/stats` | Director | KPIs del dashboard |
| GET | `/api/director/kpi-export` | Director | Exportación KPIs |
| GET | `/api/director/powerbi-metrics` | Director | Métricas Power BI |
| GET | `/api/director/session-metrics-history` | Director | Historial de sesiones |
| GET | `/api/manage/users` | Director | Lista usuarios |
| GET | `/api/vector-health` | Director | Salud del índice Pinecone |
| GET | `/api/vector-health-snapshots` | Docente/Director | Snapshots históricos |
| GET | `/api/archive-usage` | Director | Estadísticas de archive |
| GET | `/api/compliance/retention-policy` | Director | Política de retención |
| GET | `/api/compliance/retention-export` | Director | Exportación compliance |
| GET | `/api/subject-weights/{subjectId}` | FrontDoor | Pesos de materia |
| PUT | `/api/subject-weights/{subjectId}` | Teacher/Director | Actualiza pesos |
| GET | `/api/storage-lifecycle/compliance` | Director | Compliance de storage |

### Correcciones y Glosario

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/corrections-pending` | Teacher/Director | Correcciones pendientes |
| POST | `/api/corrections-verify` | Teacher/Director | Verifica respuesta |
| PATCH | `/api/corrections-status` | Teacher/Director | Actualiza estado |
| GET | `/api/teacher/ai-feedback-alerts` | Teacher/Director | Alertas de feedback IA |
| GET | `/api/corrections-transcription` | Teacher/Director | Sugerencias de transcripción |
| POST | `/api/corrections-transcription/apply` | Teacher/Director | Aplica corrección |
| POST | `/api/corrections-transcription/reject` | Teacher/Director | Rechaza sugerencia |
| GET | `/api/glossary` | Teacher/Director | Glosario de términos |
| POST | `/api/glossary` | Teacher/Director | Actualiza glosario |

### Utilidades

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/hello` | None | Health check |
| GET | `/api/vector-backup` | Docente/Director | Lista backups |
| POST | `/api/vector-backup` | Docente/Director | Dispara backup |
| GET | `/api/backup-approval` | Director | Estado aprobaciones |
| POST | `/api/backup-approval` | Director | Crea aprobación |
| DELETE | `/api/backup-approval` | Director | Revoca aprobación |
| POST | `/api/telemetry/polling` | FrontDoor | Telemetría de polling |

## Funciones Timer-Triggered

| Función | Cron | Descripción |
|---------|------|-------------|
| `daily-reminders` | `0 0 8 * * *` | Recordatorios diarios a docentes |
| `deadline-proximity-dispatcher` | Cada 30 min | Notificaciones de deadlines próximos |
| `post-class-summary-dispatcher` | Cada 15 min | Notifica resúmenes disponibles |
| `vector-backup-scheduler` | `0 0 3 * * *` | Backup diario de Pinecone |
| `vector-health-monitor` | Cada 15 min | Monitoreo de salud del índice |
| `vector-health-snapshotter` | Cada 15 min | Captura snapshots de métricas |

## Función Blob-Triggered

| Función | Trigger | Descripción |
|---------|---------|-------------|
| `process-material` | Blob creado en `class-materials/` | Pipeline de procesamiento completo |

## Formatos de Respuesta

### Éxito
```json
{
  "materialId": "uuid",
  "status": "processing"
}
```

### Error Estructurado
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Descripción del error",
    "category": "VALIDATION",
    "details": {}
  }
}
```

## Almacenamiento

- **Azure Table Storage**: `MaterialState`, `UserProfiles`, `Enrollments`, `Interventions`, `Ratings`, `RiskThresholds`, `SessionMetrics`, `Notifications`
- **Azure Blob Storage**: `class-materials/` (archivos crudos), `processed/` (texto procesado), `chat-logs/`, `deadlines/`, `class-summaries/`, `class-maps/`, `teacher-alerts/`, `compliance/`
- **Pinecone**: Vectores de embeddings (índice `dashboard-edu-pilot`)
