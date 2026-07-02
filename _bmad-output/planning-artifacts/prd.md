---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
releaseMode: phased
status: complete
completedAt: '2026-05-09'
inputDocuments:
  - /Users/lucasvidmar/Documents/azure-educational-dashboard/_bmad-output/project-context.md
workflowType: prd
briefCount: 0
researchCount: 0
brainstormingCount: 0
projectDocsCount: 3
classification:
  projectType: web_app
  domain: edtech
  complexity: high
  projectContext: brownfield
---

# Product Requirements Document - UADE Innova

**Author:** Lucas
**Date:** 2026-05-09

## Executive Summary

UADE Innova es una plataforma educativa inteligente que transforma la experiencia académica mediante IA generativa (RAG) aplicada sobre materiales de clase cargados por los docentes. El sistema permite a alumnos y docentes interactuar conversacionalmente con transcripciones, presentaciones, apuntes y bibliografía de cada materia, generando respuestas contextualizadas, resúmenes automáticos, mapas conceptuales, audios sintetizados (TTS) y líneas de tiempo académicas. El piloto inicial abarca 65 alumnos y docentes de una materia, con una meta de adopción del 60% de uso activo durante el cuatrimestre.

### What Makes This Special

La plataforma se diferencia por tres pilares: (1) un motor RAG con filtrado por metadatos (`subjectId`, `classId`, `materialType`) que evita filtraciones de contexto entre materias y garantiza que cada respuesta se base únicamente en fuentes relevantes; (2) un pipeline de ingesta multimodal que procesa automáticamente archivos TXT, DOCX, PDF, PPTX y VTT, genera embeddings con `text-embedding-3-small` y persiste chunks vectorizados en Pinecone; y (3) una arquitectura 100% serverless (Azure Static Web Apps + Azure Functions Consumption Plan Y1 + Pinecone Serverless) que mantiene el costo por alumno por debajo de $1.50 USD/mes, escalando a cero cuando no hay uso.

### Core Insight

Los docentes ya producen una cantidad masiva de materiales de clase (transcripciones de Microsoft Stream, presentaciones PowerPoint, apuntes en Word, bibliografía en PDF), pero los alumnos no pueden consultarlos de forma sintetizada ni conversacional. En lugar de crear nuevo contenido, UADE Innova extrae valor de los activos institucionales existentes, convirtiendo materiales estáticos en un tutor inteligente 24/7 con trazabilidad de fuentes.

## Project Classification

- **Project Type:** Web Application (Dashboard SPA + Azure Functions backend)
- **Domain:** EdTech (Higher Education)
- **Complexity:** High (RAG pipeline, multimodal parsing, multi-role access, Entra ID SSO, FinOps constraints, vector database operations)
- **Project Context:** Brownfield (código existente con 35+ Azure Functions, 9+ componentes frontend, 75+ documentos de implementación, infraestructura Bicep desplegada)

## Success Criteria

### User Success

- **Adopción activa:** El 60% de los 65 usuarios del piloto (alumnos y docentes) utiliza la plataforma al menos una vez por semana durante el cuatrimestre.
- **Satisfacción con respuestas RAG:** Los alumnos califican la utilidad de las respuestas del chat con una puntuación promedio ≥ 4.0/5.0 en encuestas quincenales.
- **Eficiencia docente:** Los docentes completan la carga de materiales de una clase en menos de 5 minutos y validan los resúmenes generados por IA en menos de 2 minutos.
- **Precisión de fuentes:** ≥ 90% de las respuestas del chat RAG incluyen referencias a material fuente correcto (verificable por el usuario).
- **Tiempo de respuesta:** El chat RAG responde en < 3 segundos (P95) desde que el usuario envía la pregunta hasta que recibe la respuesta con fuentes.

### Business Success

- **Meta de adopción:** 60% de uso activo entre los 65 usuarios del piloto durante el cuatrimestre académico.
- **Costo por alumno:** Mantener el costo total de infraestructura Azure + Pinecone + OpenAI por debajo de $1.50 USD/mes por alumno durante el piloto.
- **Retención docente:** 100% de los docentes participantes continúan cargando materiales semanalmente después de la semana 4 del piloto.
- **Escalabilidad validada:** El pipeline de ingesta procesa correctamente 100% de los archivos subidos (TXT, DOCX, PDF, PPTX, VTT) sin intervención manual.

### Technical Success

- **Disponibilidad:** 99.5% uptime medido por Azure Application Insights durante el cuatrimestre.
- **Latencia Functions:** Azure Functions responden en < 500ms (P95) para endpoints de lectura y < 5s para endpoints de ingesta/procesamiento.
- **Calidad vectorial:** El índice de Pinecone mantiene un recall@10 ≥ 85% para consultas de evaluación estándar.
- **Cobertura de tests:** ≥ 70% de cobertura de tests unitarios en el backend (medido con `node --test`).
- **FinOps:** Sin alertas de presupuesto Azure durante el piloto; consumo mensual predecible dentro del límite de $97.50 USD/mes (65 alumnos × $1.50).

### Measurable Outcomes

| Métrica | Objetivo | Frecuencia de medición |
|---|---|---|
| Usuarios activos semanales (WAU) | ≥ 39/65 (60%) | Semanal |
| Satisfacción respuestas RAG | ≥ 4.0/5.0 | Quincenal |
| Tiempo respuesta chat RAG (P95) | < 3 segundos | Continuo (App Insights) |
| Archivos procesados exitosamente | 100% | Por evento de ingesta |
| Costo mensual total | < $97.50 USD | Mensual |
| Uptime plataforma | ≥ 99.5% | Continuo |
| Recall@10 Pinecone | ≥ 85% | Mensual (evaluación) |

## Product Scope

### MVP - Minimum Viable Product

El MVP ya está parcialmente implementado. Los siguientes elementos son esenciales para que el piloto sea válido:

1. **Autenticación institucional:** Login SSO mediante Microsoft Entra ID (OIDC) para alumnos y docentes.
2. **Panel docente:** Carga de materiales por clase (transcripciones, presentaciones, apuntes, bibliografía) con selección de tipo de archivo y validación de formato.
3. **Pipeline de ingesta:** Procesamiento automático de archivos subidos, extracción de texto, chunking (512 tokens / 50 overlap), generación de embeddings y persistencia en Pinecone con metadatos correctos.
4. **Chat RAG básico:** Interfaz de consulta para alumnos con filtrado por `subjectId` y `classId`, respuestas generadas por DeepSeek V4 Flash con citas de fuente.
5. **Dashboard alumno:** Visualización de clases, materiales cargados, tareas priorizadas y acceso al chat.
6. **Línea de tiempo de clases:** Vista cronológica de clases con materiales asociados y estado de procesamiento.
7. **Infraestructura serverless:** Azure Static Web Apps (frontend) + Azure Functions Consumption Y1 (backend) + Pinecone Serverless + Azure OpenAI, desplegados vía Bicep/azd.

### Growth Features (Post-MVP)

Funcionalidades que aumentan la competitividad pero no bloquean el piloto:

1. **Generación de resúmenes automáticos:** Post-clase, el sistema genera un resumen estructurado que el docente valida antes de publicar.
2. **Mapas conceptuales:** Visualización interactiva de relaciones entre conceptos extraídos de los materiales.
3. **Text-to-Speech (TTS):** Generación de audios sintetizados a partir de resúmenes o respuestas del chat para accesibilidad.
4. **Analítica docente:** Métricas de comprensión (preguntas frecuentes, temas confusos) para que el docente ajuste su enseñanza.
5. **Gestión de deadlines:** Calendario académico con alertas de proximidad para tareas y exámenes.
6. **Búsqueda global:** Búsqueda semántica across todas las materias del alumno (no solo la materia activa).

### Vision (Future)

La visión a largo plazo de UADE Innova:

1. **Multi-materia y multi-carrera:** Escalar a todas las materias de todas las carreras de UADE (miles de alumnos).
2. **Integración SGA nativa:** Conexión en tiempo real con el Sistema de Gestión Académica (SGA) para notas, asistencia, calendario institucional y datos del alumno.
3. **Predicción de rendimiento:** Modelos de ML que identifican alumnos en riesgo académico basándose en patrones de uso del chat, tiempos de respuesta y frecuencia de consulta.
4. **Agentes especializados:** Múltiples agentes de IA (tutor, orientador vocacional, validador de fuentes bibliográficas) con personalización por perfil de alumno.
5. **Marketplace de materiales:** Repositorio institucional donde docentes comparten materiales validados entre materias y cuatrimestres.
6. **White-label:** Exportar la plataforma a otras universidades con personalización de marca y SSO propio.

## User Journeys

### Journey 1: Martina — Alumna preparando el parcial (Primary User - Success Path)

**Persona:** Martina, 21 años, estudiante de tercer año de Ingeniería en Sistemas. Tiene el parcial de Arquitecturas de Software en 3 días y siente que no entiende del todo el patrón "hexagonal" mencionado en la clase 5.

**Opening Scene:** Martina abre el Dashboard Educativo desde su celular mientras toma mate en la biblioteca. Ve la línea de tiempo de la materia y nota que el docente cargó la transcripción de la clase 5 y un PDF de apuntes complementarios. El estado de los materiales marca "Listo".

**Rising Action:** Martina toca el ícono del chat RAG y escribe: "¿Qué es la arquitectura hexagonal y cómo se diferencia del modelo en capas?". El sistema genera un embedding de su pregunta, busca en Pinecone filtrando por `subjectId: arq-soft-2026` y `classId: clase-05`, recupera los chunks relevantes de la transcripción y los apuntes, y construye un prompt aumentado para DeepSeek.

**Climax:** En menos de 3 segundos, Martina recibe una respuesta clara que explica el patrón hexagonal usando ejemplos del material de clase, con una tabla comparativa contra el modelo en capas y citas exactas a la transcripción (`clase5_transcript.txt`, chunk 12) y el PDF (`apuntes_hexagonal.pdf`, chunk 3). Martina siente alivio: no tiene que leer 40 páginas de apuntes, la respuesta es precisa y verificable.

**Resolution:** Martina marca la respuesta como útil, guarda el hilo de conversación para repasarlo antes del parcial y explora el mapa conceptual de la clase 5 generado automáticamente. Su confianza aumenta. Decide usar el chat para repasar los otros temas del parcial.

**Emotional Arc:** Ansiedad → Curiosidad → Alivio → Confianza.

---

### Journey 2: Profesor García — Cargando materiales post-clase (Secondary User - Core Workflow)

**Persona:** Profesor García, docente de Arquitecturas de Software. Acaba de dar la clase 7 sobre microservicios y grabó la sesión en Microsoft Stream. Tiene 15 minutos antes de la siguiente reunión.

**Opening Scene:** García accede al Panel Docente desde su notebook. Ve la lista de clases de su materia y nota que la clase 7 aún no tiene materiales cargados. El estado muestra "Pendiente".

**Rising Action:** García toca "Cargar materiales", selecciona la clase 7, elige el tipo "Transcripción" y arrastra el archivo `.vtt` exportado de Microsoft Stream. Luego carga la presentación PowerPoint de la clase y un PDF de bibliografía recomendada. El sistema valida los formatos y muestra una barra de progreso. García no necesita hacer nada más: el pipeline serverless se encarga del resto.

**Climax:** 2 minutos después, recibe una notificación (Toast) en el panel: "Materiales de Clase 7 procesados exitosamente". El sistema generó 47 chunks vectorizados en Pinecone con metadatos correctos (`subjectId`, `classId`, `materialType`, `lectureDate`). Los alumnos ya pueden consultar la clase 7 en el chat RAG.

**Resolution:** García revisa rápidamente el resumen automático generado por IA, lo valida con un clic (cambia `summaryReady` a `true`) y cierra la sesión. Los alumnos tendrán acceso inmediato a los materiales. García siente que su tiempo se optimizó: en 5 minutos hizo lo que antes le hubiera tomado horas de organización manual.

**Emotional Arc:** Responsabilidad pendiente → Fluidez → Satisfacción → Liberación.

---

### Journey 3: Martina — Chat RAG sin resultados relevantes (Primary User - Edge Case / Error Recovery)

**Persona:** Martina, misma alumna del Journey 1. Esta vez pregunta: "¿Cómo implemento un API Gateway con Kong?".

**Opening Scene:** Martina escribe la pregunta con confianza. El sistema genera el embedding y busca en Pinecone.

**Rising Action:** La búsqueda en Pinecone retorna chunks con baja relevancia (score < 0.6) porque el material de clase no cubre Kong específicamente, solo API Gateways en general. El sistema detecta que no hay contexto suficiente para una respuesta precisa.

**Climax:** En lugar de alucinar una respuesta, el chat responde: *"No encontré información específica sobre Kong en los materiales de esta materia. Los documentos cubren API Gateways en general (Clase 8, transcripción, chunks 3-5). ¿Querés que te explique el concepto general de API Gateway o que busque en la bibliografía complementaria?"*. Martina entiende que la limitación es del material, no del sistema. Selecciona "Explicar concepto general".

**Resolution:** El sistema responde con la explicación basada en los materiales disponibles, citando fuentes correctas. Martina comprende los límites del tutor IA y decide consultar la bibliografía complementaria o preguntarle al docente en clase. Su confianza en el sistema se mantiene porque la transparencia evita desinformación.

**Emotional Arc:** Confianza → Confusión → Comprensión → Aceptación informada.

---

### Journey 4: Directora Martínez — Monitoreando métricas de adopción (Admin User - Monitoring)

**Persona:** Directora Martínez, responsable de la carrera de Ingeniería en Sistemas. Necesita presentar métricas de uso de la plataforma al decano en una semana.

**Opening Scene:** Directora Martínez accede al Panel Director desde su escritorio. Ve un dashboard con KPIs: usuarios activos semanales, materiales procesados, preguntas frecuentes en el chat, distribución de uso por rol.

**Rising Action:** Martínez filtra por materia (Arquitecturas de Software) y rango de fechas (último mes). Observa que la adopción es del 58% — cerca de la meta del 60%. Nota un pico de consultas sobre "arquitectura hexagonal" y "microservicios". También ve que un 12% de las consultas no obtuvieron respuesta satisfactoria.

**Climax:** Martínez exporta un reporte PDF con las métricas y detecta un patrón: los alumnos consultan mucho sobre temas de las últimas 3 clases, pero casi nadie revisa la bibliografía complementaria. Identifica una oportunidad: sugerir al docente que refuerce la bibliografía o genere audios TTS de los papers recomendados.

**Resolution:** Martínez programa una reunión con el docente para compartir los insights. El decano recibe un informe con datos concretos: la plataforma está siendo adoptada, los alumnos estudian más, y hay oportunidades claras de mejora. Martínez siente que tiene visibilidad real sobre la calidad académica.

**Emotional Arc:** Preocupación por datos → Curiosidad analítica → Insight → Acción estratégica.

---

### Journey 5: Administrador TI — Investigando un error de procesamiento (Support / Troubleshooting)

**Persona:** Juan, administrador de infraestructura Azure en UADE. Recibe una alerta de App Insights: el endpoint `/api/ingest-material` retornó 5 errores 500 en la última hora.

**Opening Scene:** Juan abre Azure Portal y navega a Application Insights. Ve los traces de las 5 ejecuciones fallidas, todas con el mismo `materialId`.

**Rising Action:** Juan filtra por `materialId` en los logs. El error es: "PDF parser timeout — file exceeds 50MB". El archivo es un PDF escaneado de bibliografía con imágenes incrustadas. El parser `pdf-parse` no puede extraer texto de PDFs escaneados sin OCR.

**Climax:** Juan revisa el `materialId` en Azure Table Storage: el estado es `"error"`. El docente que subió el archivo no recibió notificación clara del fallo. Juan implementa una mejora: un mensaje de error más descriptivo en el frontend ("El archivo parece estar escaneado. Usá un PDF con texto seleccionable o convertilo a DOCX") y un fallback en el backend que intenta OCR con Azure Document Intelligence para PDFs escaneados.

**Resolution:** Juan actualiza la Azure Function, hace `azd deploy`, y verifica en el navegador que el mensaje de error es claro. El docente recibe feedback útil. Juan siente que el sistema es observable y recuperable.

**Emotional Arc:** Alerta → Investigación diagnóstica → Causa raíz → Solución estructural.

### Journey Requirements Summary

Los journeys revelan los siguientes capability areas críticas:

| Capability Area | Requerido por | Prioridad |
|---|---|---|
| Chat RAG con filtrado por materia/clase | Journey 1, 3 | MVP |
| Citas de fuente en respuestas | Journey 1, 3 | MVP |
| Panel docente con carga multimodal | Journey 2 | MVP |
| Pipeline de ingesta automática | Journey 2 | MVP |
| Notificaciones de estado (Toast) | Journey 2 | MVP |
| Resúmenes automáticos post-clase | Journey 2 | Growth |
| Panel director con KPIs | Journey 4 | Growth |
| Observabilidad (App Insights + logs) | Journey 5 | MVP |
| Manejo de errores con mensajes claros | Journey 3, 5 | MVP |
| Exportación de reportes | Journey 4 | Growth |
| Fallback para PDFs escaneados | Journey 5 | Vision |

## Domain-Specific Requirements

### Compliance & Regulatory

- **Student privacy:** FERPA (US students) / LGPD (Brazil) / Argentine Data Protection Law 25.326. All student queries, chat history, and material access logs must be stored with `subjectId` and `userId` correlation, with retention policies aligned to institutional requirements.
- **Content moderation:** Azure OpenAI Content Safety filters must be enabled in production to prevent jailbreaking or non-academic use of the LLM.
- **Accessibility:** WCAG 2.1 AA compliance required. TTS feature directly supports this. All UI components must support keyboard navigation and screen readers.

### Technical Constraints

- **Data segregation:** RAG metadata filtering (`subjectId`, `classId`) is not just a feature but a privacy requirement — students must never access materials from subjects they are not enrolled in.
- **Audit logging:** All RAG queries and responses must be logged with `userId`, `timestamp`, `subjectId`, and `sources` for academic integrity review.
- **Consent:** Students must accept terms of use before first chat interaction, with explicit consent for AI-generated content storage.

### Integration Requirements

- **Microsoft Entra ID:** SSO must validate enrollment claims (student is enrolled in the subject they are querying).
- **SGA (Sistema de Gestión Académica):** Future integration for real-time enrollment validation and grade syncing.

### Risk Mitigations

- **Hallucination risk:** Citations in every RAG response + "I don't know" fallback when relevance is low.
- **Prompt injection:** System prompt hardening + Content Safety filters + audit of unanswered queries.
- **Data breach:** API Keys only (no RBAC) + Key Vault for secrets + no PII in Pinecone metadata.

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. RAG sobre Activos Institucionales Existentes**
La innovación principal no es técnica (RAG ya existe), sino de modelo de negocio y aplicación: en lugar de que la universidad cree nuevo contenido educativo o contrate tutores humanos 24/7, UADE Innova extrae valor de materiales que los docentes ya producen (transcripciones de Microsoft Stream, PowerPoints, PDFs de bibliografía, apuntes Word, VTTs). Esto convierte costos operativos existentes en un activo de IA.

**2. Pipeline Multimodal Serverless**
La combinación de parsing automático de 5+ formatos de archivo (TXT, DOCX, PDF, PPTX, VTT) con chunking inteligente (512 tokens, 50 overlap) y embeddings en una arquitectura 100% serverless (Functions Consumption Y1 + Static Web Apps Free tier) es una implementación poco común en EdTech, donde tradicionalmente se usan LMS monolíticos o VMs reservadas.

**3. Filtrado por Metadatos como Barrera de Privacidad**
Usar el metadata filtering de Pinecone (`subjectId`, `classId`, `materialType`) no solo como optimización de relevancia sino como mecanismo de privacidad obligatorio (data segregation) es un enfoque dual que resuelve dos problemas con una sola técnica.

### Market Context & Competitive Landscape

- **LMS tradicionales** (Blackboard, Canvas): Gestión de contenidos pero sin IA conversacional nativa ni RAG sobre materiales propios.
- **Tutores de IA genéricos** (ChatGPT, Claude): No tienen contexto de los materiales específicos de clase ni trazabilidad de fuentes.
- **Herramientas RAG comerciales**: Requieren infraestructura dedicada (VMs, clusters) y no están optimizadas para costos < $1.50/alumno/mes.
- **UADE Innova** ocupa el nicho: IA conversacional contextualizada sobre materiales institucionales, con trazabilidad de fuentes, a costo serverless.

### Validation Approach

- **Piloto cuantitativo:** 65 usuarios, meta 60% WAU, recall@10 ≥ 85%.
- **Validación cualitativa:** Encuestas quincenales de satisfacción con respuestas RAG (≥ 4.0/5.0).
- **FinOps validation:** Tracking mensual de costo por alumno en Azure Cost Management + Application Insights.

### Risk Mitigation

- **Riesgo técnico:** Si el modelo DeepSeek no está disponible o supera presupuesto, fallback a GPT-4o mini (ya provisionado en Azure OpenAI).
- **Riesgo de adopción:** Si docentes no cargan materiales, implementar recordatorios automáticos y simplificar aún más la UI de carga (drag-and-drop único).
- **Riesgo de calidad RAG:** Si respuestas son imprecisas, ajustar chunk size/overlap, implementar re-ranking, o agregar hyde (hypothetical document embedding).

## Web Application Specific Requirements

### Project-Type Overview

UADE Innova es una Single-Page Application (SPA) desplegada en Azure Static Web Apps (Free tier) con un backend serverless en Azure Functions. No requiere SEO (aplicación autenticada, no pública), pero sí accesibilidad WCAG 2.1 AA y rendimiento optimizado para usuarios en Argentina.

### Technical Architecture Considerations

**SPA vs MPA:** SPA con Vite como bundler. No hay enrutamiento del lado del servidor; la navegación es client-side mediante vanilla JS. Azure Static Web Apps sirve el `index.html` para todas las rutas.

**Browser Support:**
- Chrome/Edge (últimas 2 versiones) — 85% de usuarios UADE
- Firefox (última versión)
- Safari (última versión, iOS y macOS)
- No se requiere soporte para IE11 ni Edge Legacy

**Real-time:** No es necesario WebSocket ni SSE. El chat RAG es request/response HTTP. Las notificaciones de estado de materiales se consultan vía polling ligero o se muestran en el momento de la carga.

**Responsive Design:**
- Mobile-first (alumnos acceden desde celulares)
- Breakpoints: 360px (móvil), 768px (tablet), 1024px (desktop), 1440px (wide)
- Touch targets mínimos: 44×44px
- Sidebar colapsable en móvil, bottom navigation

### Browser Matrix

| Navegador | Versiones | Soporte | Notas |
|---|---|---|---|
| Chrome | Últimas 2 | Full | Primary development target |
| Edge | Últimas 2 | Full | Basado en Chromium |
| Firefox | Última | Full | Revisar compatibilidad CSS Grid |
| Safari | Última | Full | iOS y macOS, revisar Web Audio API para TTS |
| IE11 | — | No soportado | — |

### Performance Targets

- **First Contentful Paint (FCP):** < 1.5s en 3G simulado
- **Time to Interactive (TTI):** < 3.5s en 3G simulado
- **Bundle size:** < 200 KB gzipped para el initial JS chunk
- **API response (chat RAG):** < 3s P95 (end-to-end: frontend → Functions → OpenAI → Pinecone → DeepSeek → frontend)
- **App Insights:** Latencia de Functions < 500ms P95 para lectura, < 5s para ingesta

### SEO Strategy

**SEO no aplica:** La aplicación requiere autenticación SSO (Microsoft Entra ID). No hay contenido público indexable. No se implementa SSR ni prerendering. El `robots.txt` debe bloquear todo el crawl.

### Accessibility Level

- **WCAG 2.1 AA** — Requerido por compliance EdTech
- **TTS (Text-to-Speech):** Feature nativo que apoya accesibilidad
- **Keyboard navigation:** Todas las funciones accesibles por teclado (Tab, Enter, Escape)
- **Screen readers:** ARIA labels en componentes críticos (ChatWidget, FileUpload, Toast)
- **Color contrast:** Ratio mínimo 4.5:1 para texto normal, 3:1 para grandes
- **Focus indicators:** Estilo visible para elementos focusables

### Implementation Considerations

- **No framework CSS:** Vanilla CSS con variables CSS (tokens del Design System). No Tailwind, no Bootstrap.
- **ES Modules:** `type: "module"` en package.json. Imports absolutos via Vite aliases.
- **Asset optimization:** Vite maneja code splitting, tree shaking y lazy loading automático.
- **CORS:** Producción restringida al dominio de Static Web App únicamente.
- **Caching:** Service Worker opcional para cache de assets estáticos (no para API data).

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-solving MVP — validar que el pipeline RAG sobre materiales institucionales resuelve el problema real de los alumnos (acceso conversacional a contenidos de clase) y los docentes (carga ágil de materiales).

**Resource Requirements:**
- 1 developer full-stack (JavaScript/Azure) — ya existe (Lucas)
- 1 docente piloto comprometido con carga semanal de materiales
- 1 administrador Azure para monitoreo FinOps
- Acceso a cuota "Dynamic VMs" para despliegue final (pendiente UADE)

### MVP Feature Set (Phase 1) — Ya parcialmente implementado

**Core User Journeys Supported:**
- Alumna consultando chat RAG con filtrado por materia/clase (Journey 1)
- Docente cargando materiales multimodales post-clase (Journey 2)
- Administrador investigando errores de procesamiento (Journey 5)

**Must-Have Capabilities:**
1. Autenticación SSO Microsoft Entra ID
2. Panel docente: carga de archivos (TXT, DOCX, PDF, PPTX, VTT) con selección de tipo
3. Pipeline de ingesta automática: parseo → chunking (512/50) → embeddings → Pinecone
4. Chat RAG básico: filtrado por `subjectId`/`classId`, respuestas con citas de fuente
5. Dashboard alumno: clases, materiales, tareas, acceso al chat
6. Línea de tiempo de clases con estado de procesamiento
7. Infraestructura serverless desplegada vía azd
8. Observabilidad básica (App Insights, logs con `materialId`/`classId`)

### Post-MVP Features

**Phase 2 (Growth):**
1. Resúmenes automáticos post-clase (docente valida antes de publicar)
2. Mapas conceptuales interactivos
3. Text-to-Speech (TTS) para accesibilidad
4. Analítica docente: métricas de comprensión, preguntas frecuentes
5. Gestión de deadlines y alertas de proximidad
6. Búsqueda global across materias

**Phase 3 (Expansion):**
1. Multi-materia y multi-carrera
2. Integración nativa con SGA (notas, asistencia, calendario)
3. Predicción de rendimiento con ML
4. Agentes especializados (tutor, orientador, validador bibliográfico)
5. Marketplace de materiales institucionales
6. White-label para otras universidades

### Risk Mitigation Strategy

**Technical Risks:**
- **DeepSeek no disponible o supera presupuesto:** Fallback a GPT-4o mini (ya provisionado en Azure OpenAI `RS-OPENAI-LLM`).
- **PDFs escaneados sin OCR:** Mensaje de error descriptivo al usuario + fallback futuro con Azure Document Intelligence.
- **Calidad RAG insuficiente:** Ajustar chunk size/overlap, implementar re-ranking, o hyde.

**Market Risks:**
- **Docentes no cargan materiales:** Recordatorios automáticos + simplificación extrema de UI (drag-and-drop único).
- **Adopción alumno < 60%:** Encuestas quincenales para identificar fricciones + iteración rápida.

**Resource Risks:**
- **Sin cuota Dynamic VMs:** Operar en modo local para demo + presión institucional para liberar cuota.
- **Presupuesto excedido:** Alertas Azure Cost Management + rate limiting por usuario.

## Functional Requirements

### 1. Authentication & Authorization

- **FR1:** Alumnos y docentes pueden autenticarse mediante SSO institucional (Microsoft Entra ID / OIDC).
- **FR2:** El sistema valida que el alumno esté matriculado en la materia que consulta antes de permitir acceso al chat RAG.
- **FR3:** El sistema distingue entre roles (alumno, docente, director, administrador) y restringe funciones según el rol.
- **FR4:** Los docentes pueden acceder únicamente a los paneles de las materias que dictan.
- **FR5:** Los alumnos deben aceptar los términos de uso y consentimiento para almacenamiento de contenido generado por IA antes del primer uso.

### 2. Material Management & Ingestion

- **FR6:** Docentes pueden cargar archivos de materiales de clase (TXT, DOCX, PDF, PPTX, VTT) desde el panel docente.
- **FR7:** Docentes pueden seleccionar el tipo de material al cargar: transcripción, presentación, apuntes o bibliografía.
- **FR8:** Docentes pueden asociar materiales a una clase específica dentro de una materia.
- **FR9:** El sistema extrae texto automáticamente del archivo según su formato (VTT/TXT directo, DOCX con mammoth, PDF con pdf-parse, PPTX con pptxgen).
- **FR10:** El sistema divide el texto extraído en chunks de 512 tokens con 50 tokens de solapamiento.
- **FR11:** El sistema genera embeddings para cada chunk utilizando el modelo `text-embedding-3-small`.
- **FR12:** El sistema persiste los chunks vectorizados en Pinecone con metadatos (`subjectId`, `classId`, `materialId`, `materialType`, `chunkIndex`, `sourceFilename`, `lectureDate`).
- **FR13:** El sistema actualiza el estado del material a través del pipeline: pending → processing → ready → error.
- **FR14:** El sistema notifica al docente cuando un material finaliza su procesamiento (éxito o error).
- **FR15:** El sistema almacena el archivo original en Azure Blob Storage (`class-materials/{classId}/{materialId}`).
- **FR16:** El sistema limpia las transcripciones utilizando un glosario de términos técnicos específico de cada materia para corregir errores de reconocimiento automático.
- **FR17:** El sistema identifica automáticamente posibles errores de transcripción (términos técnicos mal reconocidos, nombres propios inconsistentes).
- **FR18:** Docentes pueden acceder a un panel de revisión de transcripciones donde visualizan las sugerencias de corrección de la IA.
- **FR19:** Docentes pueden aceptar sugerencias de corrección de la IA o editar manualmente las transcripciones.
- **FR20:** Las correcciones de transcripciones aprobadas por el docente se re-embedden automáticamente en Pinecone.

### 3. Conversational AI (RAG Chat)

- **FR21:** Alumnos pueden escribir preguntas en lenguaje natural en un chat integrado al dashboard.
- **FR22:** El sistema genera un embedding de la pregunta del alumno.
- **FR23:** El sistema busca en Pinecone los chunks más relevantes filtrando por `subjectId` y opcionalmente por `classId`.
- **FR24:** El sistema construye un prompt aumentado con el contexto recuperado + la pregunta del usuario.
- **FR25:** El sistema genera una respuesta utilizando DeepSeek V4 Flash (o fallback a GPT-4o mini).
- **FR26:** El sistema incluye citas de fuente en cada respuesta (materialType, classId, chunkIndex, sourceFilename).
- **FR27:** El sistema responde "No tengo información suficiente" cuando la relevancia de los chunks recuperados es baja (score < 0.6).
- **FR28:** Alumnos pueden calificar la utilidad de cada respuesta del chat.
- **FR29:** Alumnos pueden reportar respuestas incorrectas o imprecisas del chat.
- **FR30:** Alumnos pueden guardar hilos de conversación para repaso posterior.
- **FR31:** El sistema registra cada consulta y respuesta con `userId`, `timestamp`, `subjectId` y `sources` para auditoría académica.

### 4. Content Correction & Quality Assurance

- **FR32:** Docentes pueden acceder a un panel de reportes de respuestas donde visualizan las respuestas del chat reportadas por los alumnos como incorrectas.
- **FR33:** Docentes pueden corregir la respuesta reportada proporcionando la respuesta correcta o una explicación adicional.
- **FR34:** El sistema notifica al alumno cuando su reporte ha sido corregido por el docente.
- **FR35:** Las correcciones de docentes se almacenan como "respuestas verificadas" y se priorizan en futuras consultas similares.

### 5. Academic Content Discovery

- **FR36:** Alumnos pueden visualizar una línea de tiempo cronológica de clases para una materia.
- **FR37:** Alumnos pueden ver el estado de los materiales cargados para cada clase (pending, processing, ready, error).
- **FR38:** Alumnos pueden acceder a los materiales originales (descarga desde Blob Storage) cuando están en estado "ready".
- **FR39:** Docentes pueden visualizar qué materiales han cargado por clase y su estado de procesamiento.
- **FR40:** El sistema muestra un resumen automático generado por IA para cada clase (cuando el docente lo valida).

### 6. Notifications & Engagement

- **FR41:** El sistema envía notificaciones push/email a alumnos con contenidos recomendados basados en su historial de consultas y clases próximas.
- **FR42:** El sistema envía recordatorios a docentes para cargar materiales de clase antes de la fecha de la clase.
- **FR43:** El sistema notifica a docentes cuando hay reportes de respuestas incorrectas pendientes de revisión.
- **FR44:** El sistema notifica a alumnos cuando se publican nuevos materiales o resúmenes en sus materias matriculadas.
- **FR45:** El sistema envía alertas de proximidad de deadlines académicos (tareas, exámenes) a alumnos.
- **FR46:** Los usuarios pueden configurar sus preferencias de notificaciones (frecuencia, canal, tipos).

### 7. Dashboard & Analytics

- **FR47:** Alumnos pueden visualizar un dashboard con tareas priorizadas por peso académico.
- **FR48:** Alumnos pueden ver métricas de uso personales (consultas realizadas, materiales revisados).
- **FR49:** Directores pueden visualizar KPIs de adopción: usuarios activos semanales, materiales procesados, preguntas frecuentes.
- **FR50:** Directores pueden filtrar métricas por materia y rango de fechas.
- **FR51:** Directores pueden exportar reportes de métricas en formato PDF.
- **FR52:** Administradores pueden visualizar costo por consulta (tokens OpenAI + Pinecone + Functions).
- **FR53:** Administradores pueden visualizar costo por alumno desagregado.
- **FR54:** Administradores pueden visualizar adopción desagregada por materia.
- **FR55:** Administradores pueden visualizar adopción desagregada por docente.
- **FR56:** Administradores pueden visualizar volumen de contenido cargado por materia y por docente.
- **FR57:** Administradores pueden visualizar volumen de reportes de respuestas incorrectas por materia.
- **FR58:** Administradores pueden visualizar tendencias de costos y uso a lo largo del tiempo.

### 8. Monitoring & Observability

- **FR59:** El sistema registra logs estructurados en Application Insights para todas las Azure Functions.
- **FR60:** El sistema incluye `materialId` o `classId` en todos los logs de error para facilitar debugging.
- **FR61:** El sistema expone métricas de latencia P95 por endpoint.
- **FR62:** El sistema genera alertas cuando el costo mensual de Azure se acerca al límite presupuestado.
- **FR63:** El sistema expone un endpoint de health check para el estado del índice vectorial.

### 9. Administrative & Configuration

- **FR64:** Administradores pueden investigar errores de procesamiento filtrando por `materialId` en logs.
- **FR65:** Administradores pueden ver el estado de todos los recursos Azure desde el portal.
- **FR66:** El sistema permite la configuración de variables de entorno para endpoints y credenciales (sin hardcodear).
- **FR67:** El sistema soporta despliegue automatizado mediante `azd deploy` desde la raíz del proyecto.

## Non-Functional Requirements

### Performance

- **NFR1:** El chat RAG debe responder en < 3 segundos (P95) desde que el usuario envía la pregunta hasta que recibe la respuesta con fuentes.
- **NFR2:** Las Azure Functions de lectura deben responder en < 500ms (P95).
- **NFR3:** Las Azure Functions de ingesta/procesamiento deben completarse en < 5 segundos para archivos < 10MB.
- **NFR4:** El First Contentful Paint (FCP) del frontend debe ser < 1.5s en 3G simulado.
- **NFR5:** El Time to Interactive (TTI) del frontend debe ser < 3.5s en 3G simulado.
- **NFR6:** El bundle JavaScript inicial debe ser < 200 KB gzipped.

### Security

- **NFR7:** Toda comunicación entre frontend y backend debe usar HTTPS/TLS 1.2+.
- **NFR8:** Las API Keys y Connection Strings deben almacenarse en Azure Key Vault (producción) o `.env.local` (local), nunca hardcodeadas.
- **NFR9:** Los logs de auditoría deben incluir `userId`, `timestamp`, `subjectId`, `action`, `sources` para todas las consultas RAG.
- **NFR10:** El metadata filtering de Pinecone (`subjectId`, `classId`) debe ejecutarse en cada consulta para prevenir acceso cruzado de materiales entre materias.
- **NFR11:** Los archivos subidos por docentes deben escanearse para detectar contenido malicioso antes del procesamiento.
- **NFR12:** El sistema debe implementar rate limiting por usuario para prevenir abuso del chat RAG y controlar costos.

### Scalability

- **NFR13:** La arquitectura debe soportar 65 usuarios concurrentes en el piloto sin degradación perceptible.
- **NFR14:** La arquitectura debe poder escalar a 1,000+ usuarios sin cambios de arquitectura (solo aumento de quotas Azure).
- **NFR15:** El pipeline de ingesta debe procesar al menos 10 archivos simultáneos sin colisión.
- **NFR16:** El índice de Pinecone debe soportar 100,000+ chunks vectorizados sin degradación de búsqueda.

### Accessibility

- **NFR17:** La aplicación debe cumplir WCAG 2.1 AA.
- **NFR18:** Todos los componentes interactivos deben ser navegables por teclado (Tab, Enter, Escape).
- **NFR19:** El contraste de color debe ser mínimo 4.5:1 para texto normal y 3:1 para texto grande.
- **NFR20:** Los componentes críticos (ChatWidget, FileUpload, Toast) deben incluir ARIA labels para screen readers.
- **NFR21:** El feature de TTS debe estar disponible como alternativa de acceso al contenido textual.

### Integration

- **NFR22:** La integración con Microsoft Entra ID debe soportar OIDC y validar claims de matriculación.
- **NFR23:** El sistema debe exponer un endpoint de health check que verifique la conectividad con Pinecone, Azure OpenAI y Blob Storage.
- **NFR24:** Las integraciones futuras con SGA deben usar APIs REST con autenticación OAuth 2.0 / Bearer tokens.
- **NFR25:** El sistema debe soportar la adición de nuevos parsers de archivo sin modificar la arquitectura core (plugin architecture).

### Reliability

- **NFR26:** El uptime objetivo es 99.5% durante el cuatrimestre académico.
- **NFR27:** Los errores de procesamiento de archivos no deben afectar otros archivos en la cola.
- **NFR28:** El sistema debe implementar retry con backoff exponencial para llamadas a Azure OpenAI y Pinecone.
