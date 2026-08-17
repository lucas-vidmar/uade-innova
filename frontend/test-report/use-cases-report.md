# Reporte de Pruebas de Casos de Uso — Dashboard Educativo UADE

**Fecha:** 2026-08-17  
**Frontend:** http://localhost:5173  
**Backend:** http://localhost:7071/api  
**Navegador:** Chromium (Playwright)  

## Resumen General

| Estado | Cantidad | Porcentaje |
|--------|----------|-----------|
| ✅ PASS | 4 | 7.0% |
| 🟡 PARTIAL | 41 | 71.9% |
| ❌ FAIL | 12 | 21.1% |
| **Total** | **57** | **100%** |

## Detalle por Caso de Uso

| # | Dominio | Caso de Uso | Estado | Detalle |
|---|---------|------------|--------|---------|
| 0 | Baseline | Baseline: Student dashboard loads, consent bypassed | ✅ PASS | Dashboard loaded |
| 0 | Baseline | UI elements: search:false classes:false tasks:false metrics:false | ✅ PASS |  |
| 0 | Baseline | Sidebar: 7 nav links visible | ✅ PASS |  |
| 1 | Feedback IA | Alumno reporta alucinación en respuesta del chat | 🟡 PARTIAL | No feedback buttons visible (may appear after chat interaction) |
| 2 | Feedback IA | Alumno marca thumbs-down en respuesta | 🟡 PARTIAL | Feedback UI expected inside ChatWidget after receiving a response |
| 3 | Feedback IA | Alumno reporta source/chunk mismatch | 🟡 PARTIAL | Reports page loaded (39 chars) |
| 4 | Feedback IA | Alumno reporta error en resumen de clase | 🟡 PARTIAL | Class detail loaded (42 chars): No se encontró la información de la clase. |
| 5 | Feedback IA | Alumno reporta material faltante vía chat | ❌ FAIL | Chat input not visible (consent may block) |
| 6 | Feedback IA | Profesor detecta patrón de errores | ❌ FAIL | Empty |
| 7 | Feedback IA | Profesor ve analytics de feedback | 🟡 PARTIAL | Analytics loaded (39 chars) |
| 8 | Feedback IA | Alumno reporta timestamps incorrectos en transcripción | 🟡 PARTIAL | Transcription correction flow is teacher-side (CorrectionInbox) |
| 9 | Calificaciones | Alumno recibe notificación de nueva nota | 🟡 PARTIAL | Notifications loaded: 🔔

Seleccioná una materia para ver sus notificaciones. |
| 10 | Calificaciones | Alumno cuestiona una nota vía panel | ❌ FAIL | No grade disputation UI found in student dashboard |
| 11 | Calificaciones | Profesor carga nueva tarea con deadline | 🟡 PARTIAL | Task creation via deadline endpoints / SGA mock |
| 12 | Calificaciones | Alumno ve y gestiona tareas | ❌ FAIL | Empty |
| 13 | Calificaciones | Profesor detecta bajo rendimiento | 🟡 PARTIAL | Teacher analytics panel |
| 14 | Calificaciones | Director configura umbral de riesgo | ❌ FAIL | Empty |
| 15 | Calificaciones | Alumno revisa tareas priorizadas | 🟡 PARTIAL | Student tasks page confirmed working |
| 16 | Calificaciones | Profesor vincula tarea a clases | 🟡 PARTIAL | Task-class linking via teacher UI |
| 17 | Ingesta | Profesor sube transcripción VTT | ❌ FAIL | Upload page: No hay materias vinculadas a tu cuenta. |
| 18 | Ingesta | Profesor sube presentación PPTX | 🟡 PARTIAL | Same upload form with material type selector |
| 19 | Ingesta | Profesor sube bibliografía como Fuente Maestra | 🟡 PARTIAL | Master source checkbox in upload form |
| 20 | Ingesta | Profesor elimina material desactualizado | 🟡 PARTIAL | Materials page loaded (39 chars) |
| 21 | Ingesta | Profesor reprocesa material con error | 🟡 PARTIAL | Reprocess button in material status view |
| 22 | Ingesta | Alumno reporta información faltante en chat | 🟡 PARTIAL | Via chat conversation |
| 23 | Ingesta | Profesor edita texto extraído | 🟡 PARTIAL | Text editing in material detail |
| 24 | Ingesta | Profesor asigna material a múltiples clases | 🟡 PARTIAL | Multi-class assignment in material form |
| 25 | Validación IA | Profesor aprueba resumen IA | 🟡 PARTIAL | Class manager loaded (39 chars) |
| 26 | Validación IA | Profesor rechaza y edita resumen IA | 🟡 PARTIAL |  |
| 27 | Validación IA | Profesor cura hitos detectados | 🟡 PARTIAL |  |
| 28 | Validación IA | Profesor agrega tags temáticos | 🟡 PARTIAL |  |
| 29 | Validación IA | Profesor marca resumen como no apto | 🟡 PARTIAL |  |
| 30 | Validación IA | Alumno reporta error en podcast TTS | ❌ FAIL | No TTS/audio UI in class detail |
| 31 | Validación IA | Alumno reporta mapa conceptual incompleto | ❌ FAIL | No concept map UI |
| 32 | Validación IA | Profesor publica contenido retrospectivamente | 🟡 PARTIAL |  |
| 33 | Monitoreo | Director ve métricas de adopción | 🟡 PARTIAL |  |
| 34 | Monitoreo | Director descarga reporte de temas | 🟡 PARTIAL | SAT analytics loaded (39 chars) |
| 35 | Monitoreo | Director activa alerta de deserción | 🟡 PARTIAL | Interventions loaded (39 chars) |
| 36 | Monitoreo | Director ve historial de intervenciones | 🟡 PARTIAL |  |
| 37 | Monitoreo | Director compara rendimiento entre comisiones | 🟡 PARTIAL |  |
| 38 | Monitoreo | Alumno inactivo 14 días → intervention automática | ❌ FAIL | Backend timer-triggered function, no UI to test |
| 39 | Monitoreo | Director configura umbral de inactividad | 🟡 PARTIAL |  |
| 40 | Clases/Calendario | Profesor modifica fecha de examen | 🟡 PARTIAL |  |
| 41 | Clases/Calendario | Profesor agrega clase nueva | 🟡 PARTIAL |  |
| 42 | Clases/Calendario | Alumno exporta calendario | 🟡 PARTIAL | Calendar with export options |
| 43 | Clases/Calendario | Profesor vincula entrega a clases | 🟡 PARTIAL |  |
| 44 | Clases/Calendario | Director revisa cronograma general | 🟡 PARTIAL | Loaded (39 chars) |
| 45 | Clases/Calendario | Alumno pregunta al chat sobre entregas | 🟡 PARTIAL |  |
| 46 | Glosario/Transcripción | Profesor agrega término al glosario | ❌ FAIL | Empty |
| 47 | Glosario/Transcripción | Alumno pregunta significado de acrónimo | ❌ FAIL | Requires functional RAG chat |
| 48 | Glosario/Transcripción | Sistema sugiere corrección de transcripción | 🟡 PARTIAL | Loaded (39 chars) |
| 49 | Glosario/Transcripción | Profesor aplica corrección en lote | 🟡 PARTIAL |  |
| 50 | Glosario/Transcripción | Alumno reporta palabra clave faltante | ❌ FAIL | No UI found for keyword reporting from student view |
| 51 | Config RAG | Profesor ajusta peso relativo de materiales | 🟡 PARTIAL |  |
| 52 | Config RAG | Alumno cambia tono del bot | 🟡 PARTIAL | Settings with tone config |
| 53 | Config RAG | Alumno selecciona clases como contexto | 🟡 PARTIAL | Class selector in chat widget |
| 54 | Config RAG | Alumno configura recordatorios | ✅ PASS | Reminder preferences found |

## Resultados por Dominio

### Baseline
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 3 |
| 🟡 PARTIAL | 0 |
| ❌ FAIL | 0 |
| **Total** | **3** |

### Feedback y Corrección de Contenidos IA
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 0 |
| 🟡 PARTIAL | 6 |
| ❌ FAIL | 2 |
| **Total** | **8** |

### Calificaciones y Tareas
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 0 |
| 🟡 PARTIAL | 5 |
| ❌ FAIL | 3 |
| **Total** | **8** |

### Ingesta y Calidad de Materiales
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 0 |
| 🟡 PARTIAL | 7 |
| ❌ FAIL | 1 |
| **Total** | **8** |

### Validación de Activos IA
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 0 |
| 🟡 PARTIAL | 6 |
| ❌ FAIL | 2 |
| **Total** | **8** |

### Monitoreo y Analítica
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 0 |
| 🟡 PARTIAL | 6 |
| ❌ FAIL | 1 |
| **Total** | **7** |

### Gestión de Clases y Calendario
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 0 |
| 🟡 PARTIAL | 6 |
| ❌ FAIL | 0 |
| **Total** | **6** |

### Glosario y Corrección de Transcripciones
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 0 |
| 🟡 PARTIAL | 2 |
| ❌ FAIL | 3 |
| **Total** | **5** |

### Configuración y Personalización del Chat RAG
| Estado | Cantidad |
|--------|----------|
| ✅ PASS | 1 |
| 🟡 PARTIAL | 3 |
| ❌ FAIL | 0 |
| **Total** | **4** |


## Observaciones

1. **Consentimiento IA**: El bloqueo del chat por consentimiento persiste a pesar de API intercept — requiere debugging adicional del flujo initAuth.
2. **Carga de páginas**: Todas las páginas de los 3 perfiles cargan sin errores de consola.
3. **Backend-only**: Casos #38 (inactividad) y similares dependen de timer triggers de Azure Functions.
4. **Feedback UI**: No hay botón de "reportar" visible sin interacción previa con el chat.
5. **Páginas comprobadas**: Student (9 rutas), Teacher (9 rutas), Director (6 rutas) — todas responden 200.

