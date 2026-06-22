# Inventario de Componentes — Frontend

## Descripción General

El frontend es una SPA (Single Page Application) construida con Vanilla JavaScript, Vite 5 como bundler, y Azure Static Web Apps como hosting. Utiliza un patrón de hash-based routing sin framework declarativo (sin React/Vue/Angular).

## Componentes Reutilizables (11)

### Sidebar (`components/Sidebar.js`)
- **Propósito:** Navegación principal responsiva con menú lateral, barra superior de utilidades y panel de perfil
- **Funcionalidad:** Navegación por roles (student/teacher/director), selector de materia, toggle de tema, centro de notificaciones (student), panel de perfil con selector de rol demo

### ChatWidget (`components/ChatWidget.js`)
- **Propósito:** Interfaz completa de chat RAG con streaming, filtros por clase, feedback y citas
- **Funcionalidad:** Renderizado de mensajes con Markdown, streaming SSE, selección de fuentes, feedback positivo/negativo, reporte de issues, guardado/carga de conversaciones

### Header (`components/Header.js`)
- **Propósito:** Barra superior con título de página, métricas KPI y selector de materia
- **Funcionalidad:** Título dinámico, métricas (promedio, en riesgo, asistencia), selector de materia

### BottomNav (`components/BottomNav.js`)
- **Propósito:** Navegación inferior móvil legacy
- **Funcionalidad:** 4 enlaces fijos: Home, Chat RAG, Tasks, Calendar

### FileUpload (`components/FileUpload.js`)
- **Propósito:** Componente drag-and-drop para subida de archivos con gestión de tipos
- **Funcionalidad:** Drag & drop, selector de archivos, validación por tipo (transcript/presentation/notes/bibliography), barra de progreso animada, badges de estado

### Toast (`components/Toast.js`)
- **Propósito:** Sistema global de notificaciones toast
- **Funcionalidad:** 4 tipos (success/error/info/warning), auto-dismiss, detalles expandibles

### Dialog (`components/Dialog.js`)
- **Propósito:** Modales de confirmación y prompt
- **Funcionalidad:** `showConfirmDialog()` y `showPromptDialog()` con API basada en Promesas

### PrivacyModal (`components/PrivacyModal.js`)
- **Propósito:** Modal de consentimiento IA
- **Funcionalidad:** Carga términos desde API, renderiza Markdown, checkbox de aceptación

### OnboardingOverlay (`components/OnboardingOverlay.js`)
- **Propósito:** Tour guiado con tooltips y backdrop
- **Funcionalidad:** Pasos con posicionamiento dinámico, versión móvil full-screen, soporte teclado

### SavedConversationsModal (`components/SavedConversationsModal.js`)
- **Propósito:** Lista y gestiona conversaciones guardadas
- **Funcionalidad:** Lista con carga/eliminación, estados vacío/error/carga

### SummaryReviewModal (`components/SummaryReviewModal.js`)
- **Propósito:** Revisión y aprobación de resúmenes IA y mapas conceptuales
- **Funcionalidad:** Editor de summary + Mermaid map, guardar borrador, aprobar y publicar

## Páginas por Rol

### Estudiante (6 páginas)
| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/student/dashboard` | `pages/student/Dashboard.js` | Dashboard principal del alumno |
| `/student/class` | `pages/student/ClassDetail.js` | Detalle de clase con materiales |
| `/student/notifications` | `pages/student/Notifications.js` | Centro de notificaciones |
| `/student/tasks` | `pages/student/Tasks.js` | Tareas priorizadas |
| `/student/calendar` | `pages/student/Calendar.js` | Calendario académico |
| `/student/settings` | `pages/student/Settings.js` | Configuración de perfil |

### Docente (9 páginas)
| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/teacher/dashboard` | `pages/teacher/Dashboard.js` | Dashboard del docente |
| `/teacher/classes` | `pages/teacher/ClassManager.js` | Gestión de clases |
| `/teacher/upload` | `pages/teacher/UploadMaterials.js` | Subida de materiales |
| `/teacher/materials` | `pages/teacher/MaterialManager.js` | Gestión de materiales |
| `/teacher/analytics` | `pages/teacher/Analytics.js` | Analytics de consultas |
| `/teacher/corrections` | `pages/teacher/CorrectionInbox.js` | Bandeja de correcciones |
| `/teacher/correction` | `pages/teacher/CorrectionDetail.js` | Detalle de corrección |
| `/teacher/glossary` | `pages/teacher/GlossaryManager.js` | Gestión de glosario |
| `/teacher/transcription-corrections` | `pages/teacher/TranscriptionCorrections.js` | Correcciones de transcripción |

### Director (7 páginas)
| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/director/dashboard` | `pages/director/Dashboard.js` | Dashboard del director |
| `/director/sat-analytics` | `pages/director/SatAnalytics.js` | SAT Analytics |
| `/director/classes` | `pages/director/ClassManagement.js` | Gestión de clases |
| `/director/subjects` | `pages/director/SubjectManagement.js` | Gestión de materias |
| `/director/interventions` | `pages/director/Interventions.js` | Intervenciones de alumnos |
| `/director/compliance` | `pages/director/Compliance.js` | Cumplimiento normativo |
| `/director/archive-usage` | `pages/director/ArchiveUsage.js` | Uso de archive |

### Admin (1 página)
| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/admin/users` | `pages/admin/UserManagement.js` | Gestión de usuarios |

## Sistema de Estilos

| Archivo | Líneas | Propósito |
|---------|--------|-----------|
| `globals.css` | ~399 | Design tokens, reset, layout shell, animaciones, themes |
| `components.css` | ~1019 | Botones, cards, badges, formularios, tabs, skeletons, dropdowns, onboarding |
| `pages.css` | ~4248 | Estilos de navegación, notificaciones, dashboards, calendario, búsqueda |
| `design-system.css` | ~789 | Utilidades flex/responsive, modales, animaciones, chat |

## Servicios del Frontend

| Archivo | Exporta | Propósito |
|---------|---------|-----------|
| `auth.js` | `auth` | Autenticación SWA + mock, manejo de roles |
| `theme.js` | `themeManager` | Gestor de tema light/dark |
| `core.js` | `apiFetch`, `BASE_URL` | Cliente HTTP con correlación |
| `api.js` | `api` | Hub central de APIs (~60 métodos) |
| `enrollments.js` | `enrollments` | Servicio de inscripciones con caché |
| `onboarding.js` | `OnboardingEngine` | Motor de onboarding guiado |
| `inactivity.js` | `inactivityMonitor` | Monitor de inactividad (60 min) |
| `local-storage.js` | `safeSetItem`, etc. | Wrappers seguros de localStorage |
| `notification-stream.js` | `createNotificationStream` | SSE de notificaciones |
| `processing-notifications.js` | `processingNotifications` | Polling de estado de materiales |

## Patrones de Estado

- **Sin framework de estado** — Estado en closures de componentes
- **sessionStorage** — Auth, enrolamientos, caché
- **localStorage** — Tema, consentimientos, jobs de procesamiento
- **Custom Events** — Comunicación cross-component (`themeChanged`, `auth:roleChanged`, etc.)
- **Re-render completo** — Los componentes reemplazan `.innerHTML` al cambiar estado
