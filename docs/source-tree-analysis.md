# Análisis del Árbol de Fuentes — Dashboard Educativo UADE

## Estructura del Proyecto (Multi-Part: 3 partes)

```
azure-educational-dashboard/
├── frontend/                          # Part: Frontend (Web SPA)
│   ├── index.html                     # Entry point HTML
│   ├── vite.config.js                 # Vite build config
│   ├── swa-cli.config.json            # Static Web Apps CLI config
│   ├── package.json                   # Dependencias (Vite, Playwright)
│   ├── public/
│   │   └── staticwebapp.config.json   # SWA runtime config (auth, routes)
│   └── src/
│       ├── main.js                    # App shell + hash router (bootstrap)
│       ├── diagnostic.js              # Diagnóstico de red
│       ├── components/                # Componentes UI reutilizables
│       │   ├── Sidebar.js             # Navegación principal
│       │   ├── ChatWidget.js          # Chat RAG completo
│       │   ├── Header.js              # Barra superior
│       │   ├── BottomNav.js           # Nav móvil legacy
│       │   ├── FileUpload.js          # Drag-drop upload
│       │   ├── Toast.js               # Notificaciones toast
│       │   ├── Dialog.js              # Modales confirm/prompt
│       │   ├── PrivacyModal.js        # Consentimiento IA
│       │   ├── OnboardingOverlay.js   # Tour guiado
│       │   ├── SavedConversationsModal.js
│       │   └── SummaryReviewModal.js  # Revisión resúmenes
│       ├── pages/                     # Páginas por rol
│       │   ├── student/               # 6 páginas (Dashboard, ClassDetail, etc.)
│       │   ├── teacher/               # 9 páginas (Dashboard, ClassManager, etc.)
│       │   ├── director/              # 7 páginas (Dashboard, SatAnalytics, etc.)
│       │   └── admin/                 # 1 página (UserManagement)
│       ├── services/                  # Servicios y APIs
│       │   ├── api.js                 # Hub central de APIs
│       │   ├── core.js                # Cliente HTTP base
│       │   ├── auth.js                # Autenticación SWA
│       │   ├── theme.js               # Tema light/dark
│       │   ├── *.api.js               # Módulos de API por dominio (10 archivos)
│       │   ├── onboarding.js          # Motor de onboarding
│       │   ├── enrollments.js         # Servicio de inscripciones
│       │   └── mocks/                 # Datos mock para prototipado
│       └── styles/                    # Sistema de diseño CSS
│           ├── globals.css            # Design tokens + reset
│           ├── components.css         # Componentes CSS
│           ├── pages.css              # Estilos de páginas
│           └── design-system.css      # Utilidades de layout
│
├── backend/                           # Part: Backend (Azure Functions)
│   ├── host.json                      # Functions runtime config
│   ├── local.settings.json            # Config local (NO commitear)
│   ├── package.json                   # Dependencias Node.js 20
│   └── src/
│       ├── index.js                   # Entry point de Functions
│       ├── middleware/
│       │   └── with-correlation.js    # Correlation ID middleware
│       ├── functions/                 # Azure Functions (~62 archivos)
│       │   ├── hello.js               # Health check
│       │   ├── ingest-material.js     # POST /api/ingest-material
│       │   ├── rag-query.js           # POST /api/rag-query (con streaming)
│       │   ├── process-material.js    # Blob trigger
│       │   ├── classes-api.js         # 18 endpoints (clases, materiales, summary)
│       │   ├── chat-api.js            # Historial, feedback, rating
│       │   ├── conversations-api.js   # CRUD conversaciones
│       │   ├── admin-api.js           # Admin endpoints
│       │   ├── analytics.js           # Analytics docente
│       │   ├── notifications.js       # Notificaciones CRUD + SSE
│       │   ├── deadlines.js           # Deadlines CRUD
│       │   ├── enrollments-api.js     # Inscripciones CRUD
│       │   ├── interventions-api.js   # Intervenciones
│       │   ├── compliance-api.js      # Cumplimiento
│       │   ├── sat-analytics.js       # SAT
│       │   ├── sga-api.js             # SGA mock
│       │   ├── get-tasks.js           # Tareas mock
│       │   ├── get-profile.js         # Perfil
│       │   ├── save-profile.js        # Guardar perfil
│       │   ├── get-roles.js           # Roles mapping
│       │   ├── material-download.js   # Descarga SAS
│       │   ├── subject-weights-api.js # Pesos de materia
│       │   ├── consent-api.js         # Consentimiento
│       │   ├── audio-api.js           # TTS audio
│       │   ├── class-timeline.js      # Timeline de clase
│       │   ├── global-search.js       # Búsqueda global
│       │   ├── daily-reminders.js     # Timer: recordatorios diarios
│       │   ├── deadline-proximity-dispatcher.js  # Timer: deadlines próximos
│       │   ├── post-class-summary-dispatcher.js  # Timer: resúmenes listos
│       │   ├── vector-backup.js       # Backup Pinecone
│       │   ├── vector-backup-scheduler.js  # Timer: backup diario
│       │   ├── vector-health.js       # Salud del índice
│       │   ├── vector-health-monitor.js   # Timer: monitoreo
│       │   ├── vector-health-snapshotter.js  # Timer: snapshots
│       │   ├── vector-health-snapshots-api.js  # Snapshots API
│       │   ├── archive-usage.js       # Archive usage
│       │   ├── storage-lifecycle.js   # Compliance storage
│       │   ├── director-kpi-export.js # Export KPIs
│       │   ├── reminder-preferences.js# Preferencias recordatorios
│       │   ├── backup-approval-api.js # Aprobaciones backup
│       │   ├── corrections/           # Correcciones (3 endpoints)
│       │   ├── corrections-transcription/ # Transcripciones (3 endpoints)
│       │   └── glossary/             # Glosario (2 endpoints)
│       ├── services/                  # Servicios compartidos
│       │   ├── ai.js                  # OpenAI + DeepSeek clients
│       │   ├── vector-store.js        # Pinecone adapter
│       │   ├── storage.js             # Blob + Table Storage
│       │   ├── state-store.js         # State persistence
│       │   ├── pipeline.js            # Ingesta pipeline orchestrator
│       │   ├── parser.js              # File parsing (DOCX, PDF, PPTX, etc.)
│       │   ├── prompts.js             # Prompt templates + A/B testing
│       │   ├── telemetry.js           # App Insights custom events
│       │   ├── correlation.js         # Correlation ID + W3C trace
│       │   ├── auth-utils.js          # SWA auth parsing
│       │   ├── error-categories.js    # Error taxonomy
│       │   ├── rag-ranking.js         # RAG ranking + diversity
│       │   ├── structured-logger.js   # JSON structured logging
│       │   ├── material-classification.js  # Priority classification
│       │   ├── subject-weights.js     # Material weight config
│       │   └── notification-store.js  # Notification persistence
│       └── scripts/                   # Scripts utilitarios
│           ├── restore-archive.js
│           ├── migrate-state-to-tables.js
│           └── seed-enrollments.js
│
├── infra/                             # Part: Infrastructure (Bicep IaC)
│   ├── main.bicep                     # Orquestador Bicep principal
│   ├── main.parameters.json           # Parámetros de entorno
│   ├── main.json                      # ARM compilado
│   ├── abbreviations.json             # Abreviaciones Azure
│   └── modules/                       # Módulos Bicep (16 archivos)
│       ├── appinsights.bicep          # Log Analytics + App Insights
│       ├── openai.bicep               # Azure OpenAI + deployments
│       ├── storage.bicep              # Storage account (7 containers, 11 tables, 2 queues)
│       ├── keyvault.bicep             # Key Vault con 5 secrets
│       ├── functions.bicep            # Functions Consumption Plan
│       ├── staticwebapp.bicep         # Static Web Apps Free
│       ├── workbook.bicep             # Cost-per-Interaction workbook
│       ├── latency-workbook.bicep     # Latency percentiles workbook
│       ├── anomalous-usage-alert.bicep# Token anomaly alerts
│       └── ttft-anomaly-alert.bicep   # TTFT anomaly alerts
│
├── docs/                              # Project Knowledge
│   ├── Documento de Alcance Funcional.md
│   ├── architecture-review.md
│   ├── api-error-contracts.md
│   ├── correlation-middleware.md
│   └── ... (13+ archivos)
│
├── .github/workflows/                 # CI/CD
│   ├── deploy-production.yml          # Deploy a producción (main)
│   ├── staging.yml                    # Deploy a staging + auto PR
│   └── opencode.yml                   # AI code review
│
├── azure.yaml                         # azd project manifest
├── AGENTS.md                          # AI agent context
└── README.md                          # Project README
```

## Puntos de Entrada Críticos

| Punto de Entrada | Archivo | Descripción |
|---|---|---|
| App Frontend | `frontend/index.html` | Shell HTML con `<div id="app">` |
| Router Frontend | `frontend/src/main.js` | Hash router con lazy loading |
| Backend Entry | `backend/src/index.js` | Functions runtime entry |
| Infra Entry | `infra/main.bicep` | Orquestador IaC |

## Directorios Críticos

| Directorio | Propósito |
|---|---|
| `frontend/src/components/` | Componentes UI reutilizables (11) |
| `frontend/src/pages/` | Páginas por rol (23 páginas en 4 roles) |
| `frontend/src/services/` | Clientes HTTP y servicios (18 archivos) |
| `frontend/src/styles/` | Sistema de diseño CSS (4 archivos, ~6445 líneas) |
| `backend/src/functions/` | Azure Functions HTTP, timer y blob (~62 archivos) |
| `backend/src/services/` | Lógica de negocio compartida (16 servicios) |
| `backend/src/middleware/` | Middleware de correlación |
| `infra/modules/` | Módulos Bicep (10 activos, 3 de referencia) |
