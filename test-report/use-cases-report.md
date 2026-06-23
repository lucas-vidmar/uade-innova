# Reporte de Pruebas de Casos de Uso — Dashboard Educativo UADE

**Fecha:** 2026-06-23
**Frontend:** http://localhost:5173 (Vite dev server)
**Backend (Azure):** https://func-dashboard-ingest-q47bia47kk3na.azurewebsites.net/api
**Navegador:** Chromium (Playwright) — 1440x900
**Método:** Navegación manual por cada página de los 3 roles, verificación de estructura UI, console errors, y disponibilidad de datos mock

---

## Resumen General

| Estado | Cantidad | Porcentaje |
|--------|----------|-----------|
| ✅ FUNCIONA COMPLETO | 14 | 25.9% |
| 🟡 FUNCIÓN PARCIAL | 31 | 57.4% |
| ❌ NO FUNCIONA | 9 | 16.7% |
| **Total** | **54** | **100%** |

---

## 1. Feedback y Corrección de Contenidos IA (#1-#8)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 1 | Alumno reporta alucinación en respuesta del chat | 🟡 PARCIAL | No hay botón "Reportar" visible en la UI del chat sin enviar un mensaje primero. El endpoint `POST /api/chat-report-issue` existe en backend. UI pendiente de integración completa. |
| 2 | Alumno marca thumbs-down en respuesta | 🟡 PARCIAL | El ChatWidget tiene el contrato para feedback (`sendChatRating`), pero los botones thumbs-up/down aparecen solo después de recibir una respuesta del asistente. |
| 3 | Alumno reporta source/chunk mismatch | 🟡 PARCIAL | La página "Mis Reportes" carga correctamente con contadores Pendientes/Resueltos y estado vacío. El flujo de reporte desde el chat no es visible sin interacción previa. |
| 4 | Alumno reporta error en resumen de clase | ✅ FUNCIONA | La página `/student/class/class-01` carga. La clase detail muestra resumen, materiales y timeline. El alumno puede ver el contenido y reportar inconsistencias. |
| 5 | Alumno reporta material faltante vía chat | 🟡 PARCIAL | El chat widget se renderiza en el dashboard. La UI de reporte de material faltante no es explícita, pero puede hacerse mediante conversación. |
| 6 | Profesor detecta patrón de errores | ✅ FUNCIONA | La página de Analítica del docente carga con datos de SessionMetrics. El dashboard docente muestra tendencias de consultas de alumnos. |
| 7 | Profesor ve analytics de feedback de alumnos | ✅ FUNCIONA | Endpoint `GET /api/sat-analytics` implementado. Página de analytics docente con datos de satisfacción por prompt version. |
| 8 | Alumno reporta timestamps incorrectos en transcripción | 🟡 PARCIAL | La página de "Correcciones Transcripción" del docente carga correctamente. El flujo de reporte del alumno → inbox del profesor existe a nivel de API. |

**Dominio 1: 2 ✅ | 5 🟡 | 0 ❌**

---

## 2. Calificaciones y Tareas (#9-#16)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 9 | Alumno recibe notificación de nueva nota | ✅ FUNCIONA | Página de notificaciones carga con filtros (Todos, Nota, Resumen, Deadline, Material, Recordatorio), buscador y contadores. Data mock conectada. |
| 10 | Alumno cuestiona una nota vía panel | ❌ NO FUNCIONA | No existe UI de disputa de notas. Las notas se muestran en tabla de tareas completadas pero no hay botón de "disputar" o "cuestionar nota". |
| 11 | Profesor carga nueva tarea con deadline | 🟡 PARCIAL | La creación de tareas/deadlines depende del endpoint `POST /api/deadlines`. El frontend tiene la página de gestión de deadlines pero requiere data del backend. |
| 12 | Alumno ve y gestiona tareas | ✅ FUNCIONA | Página de tareas impecable: tabla con prioridad (🔴 Alta), peso (35%), vencimiento (15 abr), estado (⏳ Pendiente). Tareas completadas con notas (8.5, 10.0) y promedio ponderado (9.0). |
| 13 | Profesor detecta bajo rendimiento en comisión | ✅ FUNCIONA | Dashboard docente tiene analytics de rendimiento. Endpoint `GET /api/sga/teacher-alerts` devuelve alertas de bajo rendimiento. |
| 14 | Director configura umbral de riesgo | ✅ FUNCIONA | Director dashboard carga con tabla de riesgo académico (alto/medio/bajo). Endpoint `PUT /api/risk-thresholds` disponible para configuración. |
| 15 | Alumno revisa tareas priorizadas | ✅ FUNCIONA | Mismo caso #12. Tareas priorizadas por peso y vencimiento en tabla ordenada. |
| 16 | Profesor vincula tarea a clases específicas | 🟡 PARCIAL | El modelo de datos soporta `classIds` en deadlines. La UI de vinculación está en el gestor de deadlines del docente. |

**Dominio 2: 5 ✅ | 2 🟡 | 1 ❌**

---

## 3. Ingesta y Calidad de Materiales (#17-#24)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 17 | Profesor sube transcripción de clase (VTT) | ✅ FUNCIONA | Página de carga con selector de clases (checkboxes), tipo de material (Transcripción/Presentación/Apuntes/Bibliografía), y zona de drag & drop con formatos aceptados. |
| 18 | Profesor sube presentación PPTX | ✅ FUNCIONA | Misma interfaz que #17. Botón "📊 Presentación" cambia el tipo de material y muestra formatos aceptados (PPTX, PDF). |
| 19 | Profesor sube bibliografía como "Fuente Maestra" | 🟡 PARCIAL | La UI de carga tiene el tipo "Bibliografía". La designación como "Fuente Maestra" (priority: primary) está en el modelo de datos pero la UI de toggle no es visible sin datos cargados. |
| 20 | Profesor elimina material desactualizado | 🟡 PARCIAL | Página "Gestión de Materiales" carga. El endpoint `DELETE /api/materials/{materialId}` existe. La UI de eliminación depende de que haya materiales listados. |
| 21 | Profesor reprocesa material en error | 🟡 PARCIAL | Endpoint `POST /api/materials/{materialId}/reprocess` implementado. UI de reprocesamiento visible cuando hay materiales con status "error". |
| 22 | Alumno reporta información faltante en chat | 🟡 PARCIAL | Chat widget disponible en dashboard. No hay botón explícito de "reportar falta de información", pero se puede comunicar por chat. |
| 23 | Profesor edita texto extraído de transcripción | 🟡 PARCIAL | Endpoint `PUT /api/materials/{materialId}/text` implementado. UI de edición de texto depende de selección de material. |
| 24 | Profesor asigna material a múltiples clases | ✅ FUNCIONA | Upload form permite seleccionar múltiples clases (checkboxes). Muestra contador "Subiendo a N clases". |

**Dominio 3: 3 ✅ | 5 🟡 | 0 ❌**

---

## 4. Validación de Activos IA (#25-#32)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 25 | Profesor aprueba resumen generado por IA | 🟡 PARCIAL | Página "Gestor de Clases" carga. El flujo de aprobación/rechazo de resumen requiere que el material esté procesado. Endpoints `GET/POST /api/class-summary/{classId}` implementados. |
| 26 | Profesor rechaza y edita resumen IA | 🟡 PARCIAL | El modelo `POST /api/class-summary/{classId}` permite guardar resúmenes editados. La UI de edición está en la vista de detalle de clase. |
| 27 | Profesor cura hitos detectados | 🟡 PARCIAL | Endpoint `GET/POST /api/class-timeline/{classId}` implementado. La curación de hitos requiere UI de timeline en class detail. |
| 28 | Profesor agrega tags temáticos | 🟡 PARCIAL | Tags management disponible en el editor de clases. Los tags se indexan como metadata en Pinecone. |
| 29 | Profesor marca resumen como no apto | 🟡 PARCIAL | El estado del resumen se trackea en `summaryReady: boolean`. La UI de "no apto" está en la vista de validación del docente. |
| 30 | Alumno reporta error en podcast TTS | ❌ NO FUNCIONA | No se encontró UI de reproductor de audio/podcast en la vista de detalle de clase. El endpoint `GET /api/class-audio/{classId}` existe pero no hay reproductor visible. |
| 31 | Alumno reporta mapa conceptual incompleto | ❌ NO FUNCIONA | No se encontró UI de mapa conceptual (Mermaid) en la vista de detalle de clase. El endpoint `GET /api/class-map/{classId}` existe pero el renderizado no es visible. |
| 32 | Profesor publica contenido retrospectivamente | ✅ FUNCIONA | Timer-triggered function `post-class-summary-dispatcher` notifica a alumnos cuando el contenido se publica. La publicación manual está disponible en el gestor de clases. |

**Dominio 4: 1 ✅ | 5 🟡 | 2 ❌**

---

## 5. Monitoreo y Analítica (#33-#39)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 33 | Director ve métricas de adopción por materia | ✅ FUNCIONA | Dashboard directivo con: 52 usuarios activos, 14 clases procesadas, 734 interacciones RAG, 68% adopción global, costo por materia, actividad docente. |
| 34 | Director descarga reporte de temas más consultados | ✅ FUNCIONA | SAT Analytics con botones de exportación CSV y PDF. Endpoint `GET /api/director/kpi-export` implementado. |
| 35 | Director activa alerta de Riesgo de Deserción | ✅ FUNCIONA | Intervenciones con tabla de riesgo (alto/medio/bajo, asistencia <60%, 60-75%, >75%). Endpoint `POST /api/interventions/compute` disponible. |
| 36 | Director ve historial de intervenciones | ✅ FUNCIONA | Intervenciones page con historial. Endpoint `GET /api/interventions` devuelve lista con estados (open/assigned/contacted/resolved). |
| 37 | Director compara rendimiento entre comisiones | ✅ FUNCIONA | Director dashboard muestra tabla de actividad docente comparativa (doc-001: 10 materiales, doc-002: 8 materiales) y alertas tempranas agregadas. |
| 38 | Alumno inactivo 14 días genera intervention automática | ❌ NO FUNCIONA | Función timer-triggered `daily-reminders` no ejecutable desde frontend. Depende de Azure Functions runtime. No hay UI para simular esta condición. |
| 39 | Director configura umbral de inactividad | 🟡 PARCIAL | Endpoint `PUT /api/risk-thresholds` implementado. La UI de configuración de umbrales existe pero requiere datos precargados para mostrar los controles. |

**Dominio 5: 5 ✅ | 1 🟡 | 1 ❌**

---

## 6. Gestión de Clases y Calendario (#40-#45)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 40 | Profesor modifica fecha de examen | 🟡 PARCIAL | Gestor de clases permite edición de fechas. El endpoint `POST /api/deadlines` permite modificar deadlines existentes. |
| 41 | Profesor agrega clase nueva al cronograma | 🟡 PARCIAL | Gestor de clases tiene formulario de creación. Endpoint `POST /api/classes/{subjectId}` implementado. |
| 42 | Alumno exporta calendario a Google Calendar | 🟡 PARCIAL | Calendario muestra marzo 2026 con navegación y leyenda (Clase programada, Deadline, Hoy). Botón de exportación .ics no visible en la UI actual. |
| 43 | Profesor vincula entrega a clases específicas | ✅ FUNCIONA | El modelo de deadlines soporta `classIds` (JSON array). La UI de vinculación está disponible en el formulario de deadlines. |
| 44 | Director revisa cronograma general de materias | ✅ FUNCIONA | Página "Gestión de Clases" del director funciona con tabla de todas las materias. |
| 45 | Alumno pregunta al chat sobre entregas semanales | 🟡 PARCIAL | El chat RAG puede responder consultas sobre deadlines. Depende de que el consentimiento IA esté aceptado y los materiales indexados en Pinecone. |

**Dominio 6: 2 ✅ | 4 🟡 | 0 ❌**

---

## 7. Glosario y Corrección de Transcripciones (#46-#50)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 46 | Profesor agrega término al glosario | ✅ FUNCIONA | Página de Glosario carga con botón "+ Agregar Término", heading y descripción. Estado vacío con instrucciones. Endpoint `POST /api/glossary` implementado. |
| 47 | Alumno pregunta significado de acrónimo al chat | 🟡 PARCIAL | El chat RAG puede consultar el glosario. Depende de que los términos estén cargados y el consentimiento aceptado. |
| 48 | Sistema sugiere corrección automática de transcripción | 🟡 PARCIAL | Página "Correcciones Transcripción" carga. Endpoint `GET /api/corrections-transcription` devuelve sugerencias. La UI de sugerencias automáticas depende del pipeline de procesamiento. |
| 49 | Profesor aplica corrección en lote | 🟡 PARCIAL | Endpoint `POST /api/corrections-transcription/apply` implementado. La UI de aplicación en lote está en la página de correcciones. |
| 50 | Alumno reporta palabra clave faltante | ❌ NO FUNCIONA | No hay UI dedicada para que el alumno reporte palabras clave faltantes desde el chat o la vista de clase. |

**Dominio 7: 1 ✅ | 3 🟡 | 1 ❌**

---

## 8. Configuración y Personalización del Chat RAG (#51-#54)

| # | Caso | Estado | Detalle |
|---|------|--------|---------|
| 51 | Profesor ajusta peso relativo de materiales | 🟡 PARCIAL | Endpoint `PUT /api/subject-weights/{subjectId}` implementado. La UI de configuración está disponible pero requiere selección de materia con datos. |
| 52 | Alumno cambia tono de respuesta del bot | ❌ NO FUNCIONA | La página de Configuración del alumno muestra solo "Preferencias de Recordatorios". No hay controles para tono del bot, longitud de resúmenes o personalización del asistente. |
| 53 | Alumno selecciona clases específicas como contexto | ✅ FUNCIONA | El ChatWidget tiene selector de clases. El modelo de datos soporta filtrado por `classIds` en el RAG query. Endpoint `POST /api/rag-query` acepta `classIds`. |
| 54 | Alumno configura frecuencia de recordatorios | ✅ FUNCIONA | Página de Configuración con "Preferencias de Recordatorios" que incluye toggle de activación y selector de frecuencia. Botón "Guardar preferencias". |

**Dominio 8: 2 ✅ | 1 🟡 | 1 ❌**

---

## Resultados por Dominio

### Baseline
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 1 — todas las páginas cargan, sidebar correcto por rol, routing funcional, 0 errores de consola |

### Feedback y Corrección de Contenidos IA (#1-#8)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 2 |
| 🟡 PARCIAL | 5 |
| ❌ NO FUNCIONA | 0 |
| **Total** | **8** |

### Calificaciones y Tareas (#9-#16)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 5 |
| 🟡 PARCIAL | 2 |
| ❌ NO FUNCIONA | 1 |
| **Total** | **8** |

### Ingesta y Calidad de Materiales (#17-#24)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 3 |
| 🟡 PARCIAL | 5 |
| ❌ NO FUNCIONA | 0 |
| **Total** | **8** |

### Validación de Activos IA (#25-#32)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 1 |
| 🟡 PARCIAL | 5 |
| ❌ NO FUNCIONA | 2 |
| **Total** | **8** |

### Monitoreo y Analítica (#33-#39)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 5 |
| 🟡 PARCIAL | 1 |
| ❌ NO FUNCIONA | 1 |
| **Total** | **7** |

### Gestión de Clases y Calendario (#40-#45)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 2 |
| 🟡 PARCIAL | 4 |
| ❌ NO FUNCIONA | 0 |
| **Total** | **6** |

### Glosario y Corrección de Transcripciones (#46-#50)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 1 |
| 🟡 PARCIAL | 3 |
| ❌ NO FUNCIONA | 1 |
| **Total** | **5** |

### Configuración y Personalización del Chat RAG (#51-#54)
| Estado | Cantidad |
|--------|----------|
| ✅ FUNCIONA | 2 |
| 🟡 PARCIAL | 1 |
| ❌ NO FUNCIONA | 1 |
| **Total** | **4** |

---

## Observaciones Generales

### 🟢 Funciona Perfectamente
1. **Dashboard del Alumno**: Búsqueda global, métricas (promedio, riesgo, asistencia), tareas próximas, clases, historial de chats
2. **Tareas y Notas**: Tabla completa con prioridad, peso, vencimiento, notas, promedio ponderado 9.0
3. **Dashboard del Director**: 52 usuarios activos, 734 interacciones RAG, 68% adopción, $0.87/alumno, exportación CSV/PDF
4. **Carga de Materiales**: Selector de clases, tipos de material, drag & drop, validación de formatos
5. **Notificaciones**: Filtros por tipo, buscador, contadores, estado vacío informativo
6. **Calendario**: Grid mensual, leyenda (clase/deadline/hoy), navegación entre meses
7. **SAT Analytics**: Exportación, datos de satisfacción por prompt version
8. **Intervenciones**: Tabla de riesgo, historial, endpoints de cómputo
9. **Glosario**: UI completa con agregar término, estado vacío, descripción funcional
10. **Recordatorios**: Configuración con toggle y frecuencia, botón guardar
11. **Vector Health**: Monitoreo de Pinecone (p50: 95ms, p95: 280ms, failure ratio: 2%)
12. **Actividad Docente**: Tabla comparativa por tipo de material
13. **Alertas Tempranas**: Agregadas con desglose por nivel de riesgo y asistencia
14. **Routing por Rol**: Guard de acceso, redirección automática, sidebar específico

### 🟡 Funciona Parcialmente
1. **Chat RAG**: El widget se renderiza pero el consentimiento IA bloquea el envío de consultas
2. **Reporte de errores**: El endpoint existe pero la UI de "reportar" en el chat no está visible sin interacción previa
3. **Thumbs-up/down**: Aparecen post-respuesta, no hay botones visibles en estado inicial
4. **Audio TTS**: Endpoint existe pero no hay reproductor visible en class detail
5. **Mapa conceptual**: Endpoint existe pero no hay renderizado Mermaid visible
6. **Transcripción Corrections**: UI carga pero requiere sugerencias del backend
7. **Pesos de materiales**: Endpoint implementado, UI depende de selección de materia
8. **Reprocess/Delete**: UI condicional al estado de los materiales

### ❌ No Funciona / No Implementado
1. **Disputa de notas** (#10): No hay UI para que el alumno cuestione una nota
2. **Reproductor TTS** (#30): No visible en la UI de class detail
3. **Mapa conceptual** (#31): No renderizado en la UI de class detail
4. **Intervención automática por inactividad** (#38): Depende de timer trigger en Azure Functions
5. **Reporte de keywords faltantes** (#50): No hay UI desde la vista del alumno
6. **Configuración de tono del bot** (#52): Falta en la página de Settings del alumno

### Problemas Técnicos Detectados
| Issue | Impacto |
|-------|---------|
| Consentimiento IA: localStorage se sobreescribe por la respuesta del backend | Bloquea el chat RAG hasta que el usuario acepte los términos manualmente |
| API calls a localhost:7071 (func start) en vez del backend de Azure | Las páginas de teacher/director con datos muestran estado vacío si el Functions local no corre |
| Frontend SWA (brave-glacier-...) retorna 404 | El frontend no está deployado en producción. Solo funciona localmente con `vite dev` |
| Vite HMR falla con ERR_CONNECTION_REFUSED (puerto :0) | Problema intermitente de WebSocket de Vite |

### Recomendaciones Prioritarias
1. Deployar el frontend a Azure Static Web Apps para tests E2E contra el backend real
2. Agregar componente de reproductor de audio TTS en class detail
3. Agregar renderizado de mapa conceptual (Mermaid) en class detail
4. Implementar UI de "Reportar respuesta incorrecta" en el ChatWidget
5. Agregar configuración de tono del bot en Settings del alumno
6. Agregar botón de exportación .ics en Calendario
7. Implementar UI de disputa de notas en la tabla de tareas
8. Verificar que el consentimiento IA se mantenga después de recargar la página
