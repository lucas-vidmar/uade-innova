# **Documento de Alcance Funcional \- Dashboard Educativo Inteligente (Hito 1\)**

**Proyecto:** Dashboard educativo inteligente con IA para gestión y análisis de materiales de clase

**Responsable:** Lucas Vidmar

**Fecha:** 8 de febrero de 2026

**Estado:** Versión Completa \- Flujos por Rol e Integraciones Detalladas

## **1\. Funcionalidades Principales**

El sistema centraliza la experiencia académica mediante el procesamiento de inteligencia artificial sobre datos institucionales.

* **Autenticación Institucional:** Login único mediante Microsoft Entra ID (SSO UADE).  
* **Motor RAG Dinámico:** Chat inteligente que permite al usuario seleccionar qué clases específicas actúan como fuente de verdad, sumado a la bibliografía obligatoria.  
* **Analítica Multimodal de Clases:** Generación automática de resúmenes, mapas conceptuales, audios (TTS) y líneas de tiempo con hitos de clase.  
* **Centro de Gestión del Alumno:** Dashboard de tareas priorizadas por peso académico y cronograma web interactivo.  
* **Panel de Control Docente y Directivo:** Carga y gestión de materiales de clase (transcripciones, presentaciones, apuntes y bibliografía), más visualización de métricas de comprensión y alertas tempranas de rendimiento.  
* **Infraestructura 100% Serverless:** Frontend en Azure Static Web Apps (CDN global, sin VM) y backend en Azure Functions Consumption Plan (pago por ejecución, escala a 0). Sin reserva de cómputo fija.

## **2\. Usuarios y Roles**

| **Rol** | **Descripción y Responsabilidades** |
|---|---|
| **Alumno** | Usuario principal. Consume contenidos, gestiona sus tareas y utiliza la IA para estudio personalizado. |
| **Docente** | Responsable de la materia. Sube los materiales de clase, valida los contenidos generados por la IA y monitorea el progreso del curso. |
| **Director** | Visión macro. Monitorea métricas de múltiples materias para asegurar la calidad académica y adopción tecnológica. |
| **Administrador** | Perfil técnico. Gestiona la infraestructura Azure, permisos de Entra ID y monitorea costos (FinOps). |

## **3\. Flujos y Casos de Uso por Rol**

### **3.1. Flujos del Alumno**

#### **A. Acceso y Navegación Inicial**

1. **Ingreso:** El alumno se loguea con sus credenciales @uade.edu.ar.  
2. **Dashboard Principal:** Accede a cuatro módulos centrales: **Mis Cursos**, **Notas y Tareas**, **Calendario** y **Configuración**.

#### **B. Flujo en "Mis Cursos" (Estudio con IA)**

1. **Selección de Contexto:** El alumno elige las clases específicas (una o varias) de la materia mediante un multiselector.  
2. **Consulta RAG:** El bot responde basándose exclusivamente en el contexto seleccionado y la bibliografía.  
3. **Exploración de Clase:** Accede a resúmenes detallados, hitos relevantes (timestamps) y activos multimedia (podcasts/mapas).

#### **C. Flujo en "Notas y Tareas" (Seguimiento)**

1. **Vista Centralizada:** Visualiza asistencia, notas y entregas en un solo panel.  
2. **Priorización:** Listado inteligente de tareas organizado por peso en la nota final y proximidad del vencimiento.  
3. **Detalle de Tarea:** Incluye alcance, descripción, links a clases donde se explicó el tema y estado de entrega.

#### **D. Flujo en "Calendario" y "Configuración"**

1. **Cronograma Web:** Desglose de unidades, tópicos y objetivos de aprendizaje al seleccionar una fecha de clase.  
2. **Ajustes:** Personalización del perfil y ajuste de parámetros del bot (tono de respuesta, longitud de resúmenes).

### **3.2. Flujos del Docente**

#### **A. Acceso y Panel de Control de Cátedra**

1. **Ingreso:** El docente se loguea mediante SSO.  
2. **Vista de Comisiones:** Visualiza sus materias activas y el estado de los materiales cargados por clase (completos, pendientes o procesando).

#### **B. Flujo de Carga de Materiales de Clase**

1. **Selección de Clase:** El docente selecciona una clase del cronograma de la materia en su panel.  
2. **Carga de Materiales:** Sube uno o más archivos según el tipo de contenido disponible:  
   * **Transcripción:** Archivo de texto (TXT, DOCX, VTT) con el texto transcripto de la clase.  
   * **Presentación:** Archivo de diapositivas (PPTX, PDF) utilizado durante la clase.  
   * **Apuntes:** Documento complementario con notas o resúmenes elaborados por el docente.  
   * **Bibliografía:** Artículos, capítulos o lecturas obligatorias/opcionales vinculadas a la clase.  
3. **Procesamiento y Notificación:** Tras la carga, el sistema inicia el pipeline de IA de forma asíncrona. El docente recibe una notificación cuando el contenido está procesado y disponible para los alumnos.

#### **C. Flujo de Validación y Curaduría de IA**

1. **Revisión de Activos Generados:** Una vez procesados los materiales, el docente accede a la clase para:  
   * **Validar el Resumen:** Aprobar o corregir el resumen de texto generado por la IA.  
   * **Curar Hitos:** Confirmar si los hitos (preguntas relevantes, definiciones clave, asignaciones de tareas) fueron detectados correctamente en la línea de tiempo.  
   * **Refinar Tags:** Agregar o eliminar etiquetas temáticas para mejorar la búsqueda del bot.
2. **Publicación:** El docente aprueba el contenido y lo hace visible en el panel del alumno.

#### **D. Administración de Fuentes de Conocimiento**

1. **Gestión de Bibliografía Maestra:** Administra el repositorio de bibliografía de la materia, pudiendo designar materiales como "Fuentes Maestras" que el bot RAG prioriza en sus respuestas.  
2. **Ajuste de Prioridad:** Configura el peso relativo de los distintos tipos de material (transcripciones vs. bibliografía) en las respuestas del asistente.

#### **D. Diagnóstico Pedagógico y Analítica**

1. **Monitoreo de Consultas:** Accede a un panel de "Temas de Interés" que muestra qué están preguntando los alumnos al bot RAG.  
2. **Identificación de Fricciones:** Visualiza qué tópicos del calendario generaron más dudas o consultas fallidas para reforzar esos temas en el siguiente encuentro presencial.

#### **E. Gestión Académica**

1. **Detalle de Entregas:** Carga o valida los detalles de las tareas (vencimientos, peso relativo) que los alumnos verán en su dashboard.  
2. **Seguimiento de Asistencia y Notas:** Visualiza el dashboard consolidado de la comisión para detectar alumnos en riesgo.

### **3.3. Flujos del Director**

#### **A. Monitoreo de Adopción y Uso**

1. **Dashboard de Adopción:** El director accede a una vista global que muestra métricas de uso activo (Daily Active Users) segmentadas por carrera, sede y materia.  
2. **Análisis Comparativo:** Evalúa qué cátedras están aprovechando mejor las herramientas de IA para identificar casos de éxito o materias que requieren soporte adicional.  
3. **Métricas de Contenido:** Visualiza la cantidad de clases procesadas y el volumen de interacciones con el bot RAG a nivel institucional.

#### **B. Gestión de Alertas Académicas Tempranas**

1. **Configuración de Umbrales:** El director puede definir parámetros críticos (ej. materias con asistencia promedio inferior al 70% o comisiones con alta tasa de desaprobados en el primer parcial).  
2. **Identificación de Riesgo:** El sistema genera reportes automáticos de alumnos con "Riesgo de Deserción o Fallo" basado en la falta de interacción con el dashboard y sus notas actuales.  
3. **Intervención Estratégica:** Exporta listados detallados para coordinar acciones con los directores de carrera o tutores académicos.

#### **C. Evaluación de Calidad Educativa**

1. **Auditoría de Temas:** Observa las nubes de conceptos más consultados por los alumnos para entender las necesidades de refuerzo en el plan de estudios.  
2. **Correlación de Desempeño:** Analiza informes que vinculan el uso de resúmenes y chat RAG con la mejora en las calificaciones finales de los cursos piloto.

### **3.4. Flujos del Administrador**

1. **Suscripción de Datos:** Gestión técnica de Webhooks en Graph API.  
2. **FinOps:** Control de costos de tokens de OpenAI y optimización de recursos en Azure.

## **4\. Límites del Sistema (Fuera de Alcance)**

* No se realiza ingesta automática de transcripts desde plataformas de videoconferencia (Microsoft Stream, Teams, Zoom, etc.). El sistema depende exclusivamente de los materiales cargados manualmente por el docente.  
* No se admite la reproducción ni el almacenamiento de archivos de video.  
* Integración de notas y asistencia mediante mocks si no hay API de gestión disponible para el piloto.  
* No se contempla Fine-tuning de modelos (se utiliza RAG puro).

## **5\. Integraciones con Sistemas Existentes**

| **Sistema Existente** | **Propósito de la Conexión** | **Tipo de Integración** | **Información Intercambiada** |
|---|---|---|---|
| **Microsoft Entra ID (Azure AD)** | Autenticación y Autorización (SSO). | Automática | Identidad, correo, grupos/materias. |
| **Portal / Panel del Docente (Plataforma Propia)** | Carga manual de materiales de clase. | Manual (Upload) | Transcripciones, presentaciones (PPTX/PDF), apuntes y bibliografía. |
| **Azure Blob Storage** | Almacenamiento de archivos cargados por docentes. | Automática (Interna) | Archivos binarios y de texto de cada clase. |
| **Microsoft Graph (Calendar)** | Alimentación del cronograma. | Automática | Horarios, tópicos programados y fechas de clase. |
| **Sistema de Gestión Académica (SGA / Mock)** | Rendimiento escolar. | Pasiva (API / CSV) | Notas, asistencia y fechas de entregas. |

## **6\. Datos y Contenidos**

### **A. Materiales de Clase (Contenido Principal)**

Los docentes cargan directamente los materiales desde el panel de la plataforma. Se soportan los siguientes tipos:

| **Tipo de Material** | **Formatos Aceptados** | **Procesamiento** | **Output** |
|---|---|---|---|
| **Transcripción** | TXT, DOCX, VTT | Limpieza de texto, extracción de hitos (preguntas, definiciones, tareas) vía GPT-4o mini. | Resúmenes estructurados, línea de tiempo y contexto para el chat RAG. |
| **Presentación** | PPTX, PDF | Extracción de texto por diapositiva, análisis de estructura temática. | Índice de temas, contexto para el chat RAG. |
| **Apuntes del Docente** | DOCX, PDF, TXT | Chunking y generación de embeddings. | Vectores indexados por clase en Pinecone. |
| **Bibliografía** | PDF, DOCX, TXT | Chunking, generación de embeddings, marcado como "Fuente Maestra". | Vectores indexados por materia en Pinecone. |

### **B. Información Académica (Seguimiento)**

* **Input:** Notas, asistencia y entregas (API SGA).  
* **Procesamiento:** Algoritmo de priorización por peso académico.  
* **Output:** Dashboard de gestión de tareas.

### **C. Metadatos e Identidad (Seguridad)**

* **Input:** Claims de Microsoft Entra ID.  
* **Procesamiento:** Validación RBAC y recuperación de preferencias.  
* **Output:** Perfil autenticado y filtrado de contenidos.

### **D. Activos Multimedia Generados**

* **Input:** Resúmenes estructurados generados por IA.  
* **Procesamiento:** TTS (Azure Speech) y grafos (SVG).  
* **Output:** Podcasts y mapas conceptuales.

### **F. Telemetría y Costos (FinOps)**

* **Input:** Logs de OpenAI y Azure Functions.  
* **Procesamiento:** Agregación de costos por usuario.  
* **Output:** Tableros de control en App Insights.

## **7\. Servicios y Accesos Requeridos en Azure (Entorno de Desarrollo)**

Para garantizar la correcta ejecución del proyecto en la infraestructura provista por UADE, se requiere la provisión de los siguientes servicios y roles de acceso. Es crítico asegurar estos permisos al inicio, ya que el sistema opera bajo una arquitectura Serverless basada en eventos que requiere permisos cruzados entre servicios.

### **7.1. Servicios de Azure (Nivel Recurso/Suscripción)**

Se solicita la creación de un **Resource Group (RG)** dedicado para el entorno de desarrollo, otorgando al desarrollador el rol de **Contributor** sobre dicho grupo. Dentro de este RG, se deben habilitar (o permitir crear) los siguientes recursos:

| **Servicio** | **Propósito y Justificación Crítica** | **Rol Requerido (RBAC)** |
|---|---|---|
| **Azure OpenAI Service** | **Motor Core de IA:** Modelos `gpt-4o-mini` (Generación) y `text-embedding-3-small` (Vectorización). UADE ya provisionó el recurso `RS-OPENAI-LLM` en el RG. | Cognitive Services OpenAI Contributor |
| **Azure Static Web Apps** (Free tier) | **Hosting Frontend:** Alojamiento serverless del dashboard React/Vite. CDN global, SSL automático, 100 GB bandwidth/mes. **No requiere VM quota.** | Website Contributor |
| **Azure Functions** (Consumption Plan Y1) | **Procesamiento Serverless:** Pipeline de ingesta de materiales (chunking, embeddings, hitos) y RAG. Pago por ejecución, escala a 0. **No requiere VM quota.** | Website Contributor |
| **Azure Storage Account** | **Persistencia:** Archivos de clase subidos por docentes y runtime de Functions. | Storage Account Contributor + Storage Blob Data Contributor |
| **Azure Application Insights** | **Observabilidad y FinOps:** Monitoreo de trazas, latencia y costos de tokens. | Monitoring Contributor |
| **Managed Identities** | **Seguridad Zero-Trust:** Functions se autentica contra OpenAI y Storage sin credenciales hardcodeadas. *(Pendiente: requiere permiso `roleAssignments/write` que UADE debe otorgar.)* | User Access Administrator (pendiente UADE) |

### **7.2. Servicios de Identidad y Microsoft 365 (Microsoft Entra ID)**

El sistema requiere una integración profunda con el inquilino (tenant) de UADE para el SSO y la lectura de datos académicos.

| **Recurso** | **Permiso / Acción Requerida** | **Justificación** |
|---|---|---|
| **App Registration** | Permiso para crear y editar App Registrations. | Necesario para configurar el SSO (OIDC) y obtener el Client ID y Tenant ID. |
| **Microsoft Graph API Scopes** | Admin Consent para los siguientes scopes: `User.Read` (perfil básico), `Calendars.Read` (cronograma de clases), `GroupMember.Read.All` (pertenencia a materias/comisiones). | Graph API se usa únicamente para SSO, lectura de calendario y resolución de roles. La ingesta de contenidos se realiza por carga directa desde el panel docente, sin acceso a Stream ni SharePoint. |

### **7.3. Dependencias Externas (Conectividad)**

Dado que la arquitectura utiliza una base de datos vectorial gestionada externa (Pinecone), se requiere:

* **Salida a Internet:** Permiso de salida (Outbound) desde la VNET/Subnet de Azure Functions y App Service hacia la API de **Pinecone** (puerto 443).