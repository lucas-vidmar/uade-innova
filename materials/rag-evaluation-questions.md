# RAG Evaluation Question Set (20 Complex Questions)

Este dataset contiene **20 preguntas complejas de evaluación RAG** diseñadas para verificar la precisión de recuperación y síntesis contextual del sistema educativo.

> **Criterio de Evaluación:** Las preguntas están formuladas de modo que un LLM sin acceso al contexto del repositorio (`materials/`) no puede responderlas con precisión (al exigir métricas, fechas de cronograma, diálogos verbatim de clase, diapositivas específicas o reglamentos de TP).

---

## 1. Course Administration, Chronogram & Syllabus

### Q1. Inverted Classroom & Bibliographic Mapping
* **Pregunta:** En el cronograma oficial de la materia DASI (comisión de los lunes), ¿qué clase y fecha específica fue designada bajo la modalidad de *"Clase Invertida"*, qué unidad temática abarca y qué capítulos exactos del libro de Laudon & Laudon se asignaron para dicha sesión?
* **Fuente esperada:** `materials/class-notes/DASI Cronograma dia Jueves_1C2023_ejemplo.docx`
* **Respuesta de referencia:** Clase 5 (fecha 10/4), correspondiente a la Unidad III (Infraestructura de Tecnología de la Información) y Unidad IV (Aplicaciones empresariales), con lectura obligatoria de los Capítulos 5, 6 y 7 de Laudon & Laudon (14.ª Edición).
* **Keywords:** `Clase 5`, `10/4`, `Unidad III`, `Capítulo 5, 6 y 7`, `Laudon`

### Q2. Administrative Metadata & Classroom Logistics
* **Pregunta:** ¿Cuáles son los datos administrativos de la cátedra de DASI: código de asignatura, número de clase/comisión, departamento académico, facultad y aula física asignada para el cursado y exámenes?
* **Fuente esperada:** `materials/class-notes/DASI Cronograma dia Jueves_1C2023_ejemplo.docx`
* **Respuesta de referencia:** Código: 428520, N.° de Clase: 2257, Facultad: FACE, Departamento: DEARH, Aula: Aula 564.
* **Keywords:** `428520`, `2257`, `FACE`, `DEARH`, `564`

### Q3. Complementary Bibliography: Pungitore Integration
* **Pregunta:** Además del libro principal de Laudon & Laudon, ¿qué autor y texto de bibliografía complementaria se exige específicamente para las Clases 2, 3 y 4 (Unidad II sobre Procesos de Negocio)?
* **Fuente esperada:** `materials/class-notes/DASI Cronograma dia Jueves_1C2023_ejemplo.docx`
* **Respuesta de referencia:** José Luis Pungitore, *"Sistemas administrativos y control interno: descripción de operaciones básicas en la empresa bajo condiciones de control"* (3.ª Edición).
* **Keywords:** `Pungitore`, `Sistemas administrativos y control interno`, `3a Ed`

### Q20. Exam & Defense Key Milestones
* **Pregunta:** Consultando el cronograma oficial de DASI, ¿cuáles son las fechas exactas programadas para: 1) El Examen Parcial, 2) La Exposición y Evaluación del Trabajo Práctico Final, y 3) El Examen Final del cuatrimestre?
* **Fuente esperada:** `materials/class-notes/DASI Cronograma dia Jueves_1C2023_ejemplo.docx`
* **Respuesta de referencia:** 1) Examen Parcial: Clase 6 (17/4), 2) Exposición del TP Final: Clase 14 (26/6), 3) Examen Final: Clase 16 (17/7).
* **Keywords:** `17/4`, `26/6`, `17/7`, `Clase 6`, `Clase 14`, `Clase 16`

---

## 2. Final Term Project (Trabajo Práctico Final - DASI 2023)

### Q4. Formatting Constraints & Presentation Penalties
* **Pregunta:** Según las pautas formales del Trabajo Práctico Final, ¿cuál es el límite máximo de integrantes por grupo, la extensión mínima y formato del informe escrito en Word, y qué conducta específica durante la exposición oral es causal de desaprobación directa del trabajo?
* **Fuente esperada:** `materials/class-notes/TRABAJO PRÁCTICO FINAL DASI2023.docx`
* **Respuesta de referencia:** Máximo de 8 integrantes por equipo. Informe escrito no inferior a 20 páginas (Times New Roman 12 pt, interlineado 1.5 pt). Leer directamente el texto de las transparencias o documentos durante la presentación es causal de desaprobación.
* **Keywords:** `8 integrantes`, `20`, `Times New Roman`, `1.5`, `Leer directamente`

### Q5. Chatbot Virtualization Workflows (Tidio® Requirement)
* **Pregunta:** En la consigna del TP Final, los equipos deben virtualizar una actividad de la compañía mediante un chatbot en Tidio®. ¿Cuáles son los dos casos de negocio punta a punta específicos entre los cuales los grupos deben desarrollar su asistente conversacional?
* **Fuente esperada:** `materials/class-notes/TRABAJO PRÁCTICO FINAL DASI2023.docx`
* **Respuesta de referencia:** 1) *"De la solicitud al pago: Asistencia al proveedor para el procesamiento de su factura"* y 2) *"De la necesidad a la cobranza: Asistencia a los clientes para cotizar un producto y/o servicio"*.
* **Keywords:** `solicitud al pago`, `procesamiento de su factura`, `necesidad a la cobranza`, `cotizar`

### Q6. Software Evaluation Method in TP Final
* **Pregunta:** ¿Qué técnica formal de evaluación multicriterio exige el TP Final para justificar la elección del software empresarial y cuál es la cantidad mínima de alternativas que deben contrastarse?
* **Fuente esperada:** `materials/class-notes/TRABAJO PRÁCTICO FINAL DASI2023.docx`
* **Respuesta de referencia:** Deben comparar un mínimo de 3 softwares empresariales justificando la elección mediante la Técnica de Ponderación (probando versiones demo/trial).
* **Keywords:** `mínimo 3`, `Técnica de Ponderación`, `versiones de prueba`

### Q7. Institutional Plagiarism Sanction Framework
* **Pregunta:** ¿Cuáles son las consecuencias institucionales y disciplinarias reglamentarias que establece el documento de cátedra ante la detección de plagio o deshonestidad intelectual en el Trabajo Práctico Final?
* **Fuente esperada:** `materials/class-notes/TRABAJO PRÁCTICO FINAL DASI2023.docx`
* **Respuesta de referencia:** Calificación de 0 (cero), recursar directamente la materia, elevación de expediente de Sanción del Decanato y sanciones disciplinarias bajo el Código de Ética de UADE.
* **Keywords:** `0 (cero)`, `recurse`, `Sanción del Decanato`, `Código de Ética`

---

## 3. Guest Lecture & Cybersecurity (Luis Lubeck Presentation)

### Q8. Cybercrime Market Projections
* **Pregunta:** En la presentación invitada de Luis Lubeck sobre ciberseguridad, ¿cuál es el costo estimado del cibercrimen global para el año 2015 y a cuánto se proyectaba su crecimiento para el año 2021 según las cifras presentadas?
* **Fuente esperada:** `materials/presentations/La_informacion_vale_Ciberseguridad_Presentacion_Luis_Lubeck.pdf`
* **Respuesta de referencia:** En 2015: $400B ($400 billones), proyectado para 2021 a $6T ($6 trillones).
* **Keywords:** `2015`, `400B`, `2021`, `6T`

### Q9. Daily Vulnerabilities and CVE Statistics
* **Pregunta:** Según los datos de CVE Details y los laboratorios de ESET expuestos por Luis Lubeck, ¿cuántas vulnerabilidades se reportaron en total durante 2018 (promedio diario de CVEs) y cuántas muestras únicas de nuevo malware se detectaban por día y por año?
* **Fuente esperada:** `materials/presentations/La_informacion_vale_Ciberseguridad_Presentacion_Luis_Lubeck.pdf`
* **Respuesta de referencia:** Durante 2018: 16.555 vulnerabilidades totales (45 CVEs por día). Muestras de malware en ESET: 300.000 por día (109.500.000 por año).
* **Keywords:** `16.555`, `45`, `300.000`, `109.500.000`

### Q10. Formal Definition of Vulnerability (Lubeck)
* **Pregunta:** ¿Cuál es la definición textual y conceptual de *"Vulnerabilidad"* brindada en la diapositiva 5 de la disertación de Luis Lubeck?
* **Fuente esperada:** `materials/presentations/La_informacion_vale_Ciberseguridad_Presentacion_Luis_Lubeck.pdf`
* **Respuesta de referencia:** *"Falla en el desarrollo de una aplicación, sistema o dispositivo que permite la realización de alguna acción indeseada o incorrecta."*
* **Keywords:** `Falla en el desarrollo`, `aplicación, sistema o dispositivo`, `acción indeseada o incorrecta`

---

## 4. Classroom Transcripts & Dialogue Details

### Q11. Class 01: Data vs. Information Analogy
* **Pregunta:** En la transcripción de la Clase 01, ¿qué ejemplo concreto del mundo real utiliza el profesor Martín Ferreiro al responder la pregunta del alumno Lucas para ilustrar la diferencia entre "dato en bruto" e "información estructurada"?
* **Fuente esperada:** `materials/transcripts/Clase 01 - Transcripcion - Introduccion a los Sistemas de Informacion.vtt`
* **Respuesta de referencia:** Utiliza una lista de tickets de supermercado con números en bruto como datos, en contraste con el total de ventas agrupadas y procesadas con significado gerencial como información.
* **Keywords:** `tickets de supermercado`, `datos en bruto`, `información`, `Lucas`

### Q12. Class 04: Server Utilization & Virtualization Metrics
* **Pregunta:** Durante la Clase 04 sobre Infraestructura de Hardware y Cloud, ¿qué porcentajes cuantitativos exactos de tasa de utilización de servidores compara el profesor para justificar la adopción masiva de la virtualización frente al hardware físico tradicional?
* **Fuente esperada:** `materials/transcripts/Clase 04 - Transcripcion - Infraestructura de TI Hardware.vtt`
* **Respuesta de referencia:** Un servidor físico tradicional opera con una utilización de apenas ~15%, mientras que la virtualización eleva la tasa de utilización a más del 80%.
* **Keywords:** `15%`, `80%`, `virtualización`

### Q13. Class 08: SDLC System Conversion Strategies
* **Pregunta:** En la Clase 08 sobre Adquisición y Desarrollo de SI (Unidad V), ¿cuáles son las 4 estrategias de conversión o puesta en marcha de un nuevo sistema mencionadas en la clase y cuál es señalada como la más segura pero de mayor costo?
* **Fuente esperada:** `materials/transcripts/Clase 08 - Transcripcion - Adquisicion y Desarrollo de Sistemas de Informacion.vtt`
* **Respuesta de referencia:** 1) Estrategia Paralela (señalada como la más segura pero de mayor costo), 2) Corte Directo, 3) Estudio Piloto, y 4) Enfoque Gradual/por Fases.
* **Keywords:** `Paralela`, `Corte Directo`, `Estudio Piloto`, `Gradual`, `más segura`

### Q14. Class 11: RPA Justification for Legacy Systems
* **Pregunta:** En la clase sobre Business Intelligence y Automatización (Clase 11), ¿cuál es la justificación técnica que da el docente ante la consulta del alumno Carlos sobre por qué implementar Robotic Process Automation (RPA) en lugar de una integración tradicional de backend?
* **Fuente esperada:** `materials/transcripts/Clase 11 - Transcripcion - Business Intelligence Automatizacion y Chatbots.vtt`
* **Respuesta de referencia:** Porque RPA emula las acciones de un operador sobre la interfaz gráfica (GUI), permitiendo automatizar flujos con sistemas legados que carecen de APIs modernas sin reescribir el backend.
* **Keywords:** `RPA`, `GUI`, `sistemas legados`, `APIs`, `backend`

### Q15. Class 13: General vs. Application Controls
* **Pregunta:** En la clase de Seguridad y Auditoría de SI (Clase 13), ¿cómo diferencia formalmente el profesor los 'Controles Generales' de los 'Controles de Aplicación' ante la consulta de la alumna Sofía?
* **Fuente esperada:** `materials/transcripts/Clase 13 - Transcripcion - Seguridad en los SI y Ciberseguridad.vtt`
* **Respuesta de referencia:** Los Controles Generales gobiernan el diseño, seguridad y uso global de toda la infraestructura (software, hardware, seguridad física, administración). Los Controles de Aplicación son específicos de cada programa individual (controles de entrada, procesamiento y salida).
* **Keywords:** `Controles Generales`, `Controles de Aplicación`, `infraestructura`, `entrada, procesamiento y salida`

### Q16. Class 14: Universal Ethical Principles in SI
* **Pregunta:** Durante la Clase 14 sobre Ética y Responsabilidad Social, ¿qué 5 principios éticos universales enumera el profesor para analizar dilemas morales derivados de las tecnologías de información?
* **Fuente esperada:** `materials/transcripts/Clase 14 - Transcripcion - Etica Privacidad y Responsabilidad Social en los SI.vtt`
* **Respuesta de referencia:** 1) La Regla de Oro, 2) El Imperativo Categórico de Kant, 3) La Regla del Cambio de Descartes, 4) El Principio Utilitarista, y 5) El Principio de Aversión al Riesgo.
* **Keywords:** `Regla de Oro`, `Imperativo Categórico`, `Descartes`, `Utilitarista`, `Aversión al Riesgo`

---

## 5. Theoretical & Architecture Synthesis

### Q17. Class 09: Bullwhip Effect Mitigation in SCM
* **Pregunta:** Basándose en la presentación de Aplicaciones Empresariales (ERP-SCM), ¿cómo se define el 'Efecto Látigo' (Bullwhip Effect) en la cadena de abastecimiento y mediante qué mecanismo de información compartido entre actores se mitiga?
* **Fuente esperada:** `materials/presentations/Clase 09 - U4a - Aplicaciones empresariales de los SI (ERP-SCM)FINAL.pptx`
* **Respuesta de referencia:** Es la distorsión y amplificación de la demanda a medida que se retrocede hacia mayoristas y fabricantes. Se mitiga mediante visibilidad compartida en tiempo real de la demanda e inventarios a lo largo del sistema SCM.
* **Keywords:** `Efecto Látigo`, `distorsión`, `demanda`, `tiempo real`, `SCM`

### Q18. Class 12: Competitive Strategies & Switching Costs
* **Pregunta:** En la Clase 12 sobre Estrategia de Sistemas (Modelo de Porter), ¿qué caso empresarial paradigmático se cita para la estrategia de 'Enfoque en nichos de mercado' y cómo los sistemas integrados elevan los 'Costos de Cambio' (Switching Costs)?
* **Fuente esperada:** `materials/presentations/Clase 12 - U7 - Estrategia de Sistemas de Información2020.pptx`
* **Respuesta de referencia:** Se cita el sistema OnQ de hoteles Hilton. Los sistemas integrados elevan los costos de cambio porque mudar a otro proveedor implicaría altos costos de re-entrenamiento y pérdida de datos históricos.
* **Keywords:** `Hilton`, `OnQ`, `Costos de Cambio`, `Switching Costs`

### Q19. Class 06: Data Warehouse vs. Operational RDBMS
* **Pregunta:** En la clase de Bases de Datos y Telecomunicaciones (Clase 06), ¿cuál es la razón técnica y de rendimiento fundamental por la cual las consultas analíticas gerenciales no deben ejecutarse directamente sobre el motor de base de datos transaccional (OLTP)?
* **Fuente esperada:** `materials/transcripts/Clase 06 - Transcripcion - Bases de Datos Redes y Telecomunicaciones.vtt`
* **Respuesta de referencia:** Porque las consultas analíticas pesadas saturan recursos y degradan la velocidad de respuesta del sistema transaccional en producción. Por ello se desacoplan hacia un Data Warehouse mediante procesos ETL.
* **Keywords:** `transaccional`, `saturar`, `ETL`, `Data Warehouse`, `analíticas`
