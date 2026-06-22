# Modelos de Datos — Backend

## Descripción General

El backend utiliza Azure Table Storage como base de datos operacional (NoSQL) y Azure Blob Storage para almacenamiento de documentos JSON y archivos binarios. Pinecone se usa como base de datos vectorial.

---

## Azure Table Storage

### MaterialState (Tabla: `materials`)

Estado de cada material subido por el docente.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `materialId` (UUID) |
| `subjectId` | string | ID de la materia |
| `classIds` | string (JSON array) | IDs de las clases asociadas |
| `type` | string | `transcript` \| `presentation` \| `notes` \| `bibliography` |
| `filename` | string | Nombre original del archivo |
| `mimeType` | string | Tipo MIME detectado |
| `status` | string | `pending` \| `processing` \| `ready` \| `error` |
| `blobUrl` | string | URL del archivo en Blob Storage |
| `uploadedAt` | string (ISO 8601) | Fecha de subida |
| `processedAt` | string (ISO 8601) | Fecha de procesamiento |
| `errorMessage` | string | Mensaje de error (si status=error) |
| `reviewed` | boolean | Revisado por docente |
| `priority` | string | `primary` \| `secondary` |
| `materialVersion` | int | Versión del material |

### Classes (Tabla: `classes`)

Configuración de clases por materia.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `classId` |
| `title` | string | Título de la clase |
| `date` | string (ISO 8601) | Fecha de la clase |
| `topics` | string (JSON array) | Temas planificados |
| `summaryReady` | boolean | Resumen IA validado |
| `materials` | string (JSON array) | IDs de materiales asociados |

### Enrollments (Tabla: `Enrollments`)

Inscripciones de usuarios a materias.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `userId` |
| `role` | string | `student` \| `teacher` |
| `status` | string | `active` \| `inactive` |
| `enrolledAt` | string (ISO 8601) | Fecha de inscripción |

### UserProfiles (Tabla: `UserProfiles`)

Perfiles de usuario.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `Profiles` |
| `RowKey` | string | `userId` |
| `theme` | string | `light` \| `dark` |
| `language` | string | `es` \| `en` |
| `consentAccepted` | boolean | Consentimiento IA aceptado |
| `lastActive` | string (ISO 8601) | Última actividad |
| `email` | string | Email del usuario |
| `name` | string | Nombre del usuario |

### UserConsent (Tabla: `UserConsent`)

Consentimientos de usuario.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `Consent` |
| `RowKey` | string | `userId` |
| `accepted` | boolean | Aceptado |
| `acceptedAt` | string (ISO 8601) | Fecha de aceptación |
| `version` | string | Versión de términos |

### Corrections (Tabla: `Corrections`)

Correcciones de respuestas.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `correctionId` (UUID) |
| `question` | string | Pregunta original |
| `studentAnswer` | string | Respuesta del alumno |
| `correctedAnswer` | string | Respuesta corregida |
| `status` | string | `pending` \| `reviewed` \| `resolved` \| `verified` |
| `createdAt` | string (ISO 8601) | Fecha de creación |
| `reviewedAt` | string (ISO 8601) | Fecha de revisión |
| `reviewedBy` | string | ID del docente revisor |
| `feedback` | string | Feedback adicional |

### CorrectionsPending (Tabla: `CorrectionsPending`)

Cola de correcciones pendientes.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `correctionId` |
| `status` | string | `pending` |
| `createdAt` | string (ISO 8601) | Fecha de creación |

### Conversations (Tabla: `Conversations`)

Conversaciones guardadas del chat RAG.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `userId` |
| `RowKey` | string | `invertedTimestamp` (MAX_TS - timestamp) |
| `conversationId` | string | UUID de la conversación |
| `subjectId` | string | Materia asociada |
| `messages` | string (JSON array) | Mensajes de la conversación |
| `firstQuestion` | string | Primera pregunta |
| `messageCount` | int | Total de mensajes |
| `lastMessageAt` | string (ISO 8601) | Último mensaje |
| `createdAt` | string (ISO 8601) | Fecha de creación |

### ConversationRatings (Tabla: `ConversationRatings`)

Ratings de respuestas del chat.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `messageId` |
| `sessionId` | string | Sesión de chat |
| `classId` | string | Clase asociada |
| `rating` | string | `positive` \| `negative` |
| `comment` | string | Comentario opcional |
| `promptVersion` | string | Versión del prompt usado |
| `createdAt` | string (ISO 8601) | Fecha de creación |

### Interventions (Tabla: `Interventions`)

Intervenciones de alumnos en riesgo.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `studentId` |
| `risk` | string | `low` \| `medium` \| `high` |
| `score` | number | Puntaje de riesgo (0-100) |
| `reason` | string | Razón del riesgo |
| `state` | string | `open` \| `assigned` \| `contacted` \| `resolved` |
| `notes` | string (JSON array) | Historial de notas |
| `createdAt` | string (ISO 8601) | Creación |
| `updatedAt` | string (ISO 8601) | Última actualización |

### RiskThresholds (Tabla: `RiskThresholds`)

Umbrales de riesgo configurables.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `thresholds` |
| `thresholds` | string (JSON) | Configuración de umbrales |
| `updatedBy` | string | Usuario que actualizó |
| `updatedAt` | string (ISO 8601) | Fecha de actualización |

### SessionMetrics (Tabla: `SessionMetrics`)

Métricas de sesión para telemetría.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `timestamp` |
| `userId` | string | Usuario |
| `eventType` | string | Tipo de evento |
| `durationMs` | number | Duración |
| `tokens` | number | Tokens consumidos |
| `success` | boolean | Éxito/fallo |

### SubjectWeights (Tabla: `SubjectWeights`)

Pesos de materiales por materia.

| Campo | Tipo | Descripción |
|---|---|---|
| `PartitionKey` | string | `subjectId` |
| `RowKey` | string | `weights` |
| `weights` | string (JSON) | `{ notes: 1.35, bibliography: 1.1, transcript: 1.0, presentation: 0.95 }` |
| `updatedBy` | string | Usuario |
| `updatedAt` | string (ISO 8601) | Última actualización |

### Other Tables

| Tabla | Propósito | PartitionKey | RowKey |
|---|---|---|---|
| `NotificationPreferences` | Preferencias de notificaciones | `userId` | `preferences` |
| `UserEvents` | Eventos de usuario para intervenciones | `userId` | `timestamp` |

---

## Azure Blob Storage

### Contenedor: `class-materials`

```
class-materials/{subjectId}/{materialId}/{filename}
```
Archivos subidos por docentes. Metadata: `subjectId`, `classIds`, `materialType`, `materialId`.

### Contenedor: `processed`

```
processed/{materialId}.json
```
Resultado del pipeline de procesamiento:
```json
{
  "materialId": "uuid",
  "text": "texto extraído y chunked",
  "chunks": ["chunk1", "chunk2", ...],
  "chunkCount": 10,
  "filename": "original.pdf",
  "materialType": "transcript",
  "tokenCount": 5120,
  "processedAt": "ISO 8601"
}
```

### Contenedor: `chat-logs`

```
chat-logs/{userId}/{subjectId}/{timestamp}-{interactionId}.json
```
Logs de interacciones RAG:
```json
{
  "question": "string",
  "answer": "string",
  "sources": [{ "materialType": "transcript", "classId": "...", "chunkIndex": 0 }],
  "promptVersion": "v1",
  "tokens": { "prompt": 100, "completion": 50, "total": 150 },
  "timestamps": { "started": "ISO", "firstToken": "ISO", "completed": "ISO" },
  "feedback": "positive|negative|null"
}
```

### Contenedor: `notifications`

```
notifications/{subjectId}.json
```
Notificaciones por materia (JSON array).

### Contenedor: `deadlines`

```
deadlines/{subjectId}.json
```
Deadlines por materia (JSON array).

### Other Containers

| Contenedor | Patrón | Propósito |
|---|---|---|
| `class-summaries` | `{classId}.json` | Resúmenes IA |
| `class-maps` | `{classId}.json` | Mapas conceptuales Mermaid |
| `teacher-alerts` | `{subjectId}/{alertId}.json` | Alertas de feedback |
| `compliance` | `retention-policy.json` | Política de retención |
| `vector-snapshots` | `{timestamp}.json` | Snapshots de Pinecone |
| `glossary-files` | `{subjectId}.json` | Glosario de términos |
| `summaries` | `{classId}.json` | Resúmenes (alternativo) |
| `monitor-state` | `vector-health.json` | Estado del monitor |

---

## Pinecone Vector Database

### Índice: `dashboard-edu-pilot`

**Dimensión:** 1536
**Métrica:** Cosine Similarity
**Namespace:** Opcional (no usado actualmente)

### Metadata por Vector

| Campo | Tipo | Descripción |
|---|---|---|
| `subjectId` | string | Filtro RAG |
| `classIds` | string[] | Clases asociadas |
| `materialId` | string | Material origen |
| `materialType` | string | Tipo de material |
| `materialPriority` | string | `primary` \| `secondary` |
| `chunkIndex` | number | Índice del chunk |
| `sourceFilename` | string | Archivo origen |
| `lectureDate` | string (ISO) | Fecha de clase |
| `text` | string | Contenido del chunk |
| `slideTitle` | string | Título de diapositiva (PPTX) |

---

## Relaciones entre Entidades

```
Subject
  ├── Classes (1:N)         → Table: classes (partitionKey: subjectId)
  ├── Materials (1:N)       → Table: materials (partitionKey: subjectId)
  │     ├── Chunks (1:N)    → Pinecone vectors (metadata.materialId)
  │     └── ProcessedFile   → Blob: processed/{materialId}.json
  ├── Enrollments (1:N)     → Table: Enrollments (partitionKey: subjectId)
  ├── Interventions (1:N)   → Table: Interventions (partitionKey: subjectId)
  ├── Corrections (1:N)     → Table: Corrections (partitionKey: subjectId)
  └── SubjectWeights (1:1)  → Table: SubjectWeights (partitionKey: subjectId)

User
  ├── Profile (1:1)         → Table: UserProfiles (rowKey: userId)
  ├── Consent (1:1)         → Table: UserConsent (rowKey: userId)
  ├── Enrollments (1:N)     → Table: Enrollments (rowKey: userId)
  ├── Conversations (1:N)   → Table: Conversations (partitionKey: userId)
  └── ChatLogs (1:N)        → Blob: chat-logs/{userId}/
```
