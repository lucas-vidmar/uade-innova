# Estado del Proyecto - UADE Innova Dashboard Educativo

## 01 de Julio, 2026

* **Feature/Story Name**: Verificación y Aseguramiento de Calidad (QA) de los 25 Flujos de Usuario del MVP
* **Status**: Completed
* **Business Impact**: Se consolidó el informe de control de calidad para las 4 capas de la arquitectura evaluando la viabilidad del MVP. Esto brinda visibilidad sobre la estabilidad de los flujos de negocio principales e identifica las brechas y recomendaciones de seguridad y funcionalidad que se abordarán post-MVP.
* **Key Milestones**:
  - Creación del informe de verificación final en `docs/QA_Tests_Report.md`.
  - Reporte consolidado de 25 flujos de usuario verificados con Playwright (subsets 1-4).
  - Obtención de una tasa de aceptación del 92.0% (19 flujos PASS, 4 PARTIAL, 2 FAIL).
  - Documentación de brechas críticas (sandbox del docente, control de abuso y seguridad API).

## 29 de Junio, 2026


* **Feature/Story Name**: Revisión y mejora de métricas del Dashboard Directivo
* **Status**: Completed
* **Business Impact**: El dashboard del director ahora muestra métricas reales en lugar de datos hardcodeados. Las alertas tempranas consultan la tabla de intervenciones, la exportación de KPIs usa valores reales, y los costos muestran su fuente de datos con claridad.
* **Key Milestones**:
  - Alertas tempranas integradas con interventions-api.js (ya no devuelven ceros hardcodeados)
  - Exportación de KPIs con valores reales (eliminados hardcodeos de classesProcessed=14 y adoptionRate=68)
  - Renombrado "Clases procesadas" → "Total clases" para reflejar la métrica real
  - EnrolledCount configurable desde Gestión de Materias (adoption rate ahora usa el número real de alumnos)
  - SessionMetrics optimizado con filtro server-side por fecha
  - Pricing extraído a variables de entorno
  - Notas aclaratorias sobre fuente de datos en costos y Vector Health

* **Deferred Work / Blockers**:
  - **Azure Cost Management API**: No se pudo crear el Service Principal ni asignar el rol "Cost Management Reader" por falta de permisos RBAC en la suscripción. El código (`backend/src/services/azure-cost.js`) está listo y hace fallback automático al cálculo token-based. Para activar costos reales, alguien con permisos de Owner debe ejecutar:
    ```bash
    az ad sp create-for-rbac --name sp-cost-mgmt-dashboard --role "Cost Management Reader" --scope /subscriptions/e581a4ea-1c70-477b-9258-98a51fac57cf
    az functionapp config appsettings set --name func-dashboard-ingest-q47bia47kk3na --resource-group RG_UADE_INNOVA_DEV --settings AZURE_CLIENT_ID="<id>" AZURE_CLIENT_SECRET="<secret>" AZURE_TENANT_ID="<tenant>"
    ```
    Documentación completa en `AGENTS.md` sección 18.

## 03 de Mayo, 2026

* **Feature/Story Name**: Arreglo de visibilidad de materiales y pipeline de RAG
* **Status**: Completed
* **Business Impact**: Los materiales subidos por los docentes ahora se visualizan correctamente en el frontend y son procesados de forma fiable por la IA, permitiendo respuestas precisas del bot conversacional basadas en la bibliografía de cada clase.
* **Key Milestones**: 
  - Corrección de la estructura de datos corrupta (doble stringify) en los identificadores de clase.
  - Saneamiento retroactivo de la base de datos (Azure Table Storage).
* **Feature/Story Name**: Mejora de Interfaz de Usuario (Dashboard del Alumno)
* **Status**: Completed
* **Business Impact**: El alumno experimenta un diseño más limpio y moderno, con estados vacíos claros y métricas presentadas con mayor legibilidad, mejorando la usabilidad general del dashboard.
* **Key Milestones**:
  - Alineación de la barra de búsqueda y los módulos de métricas con las columnas principales de contenido.
  - Se eliminaron los fondos de los módulos de métricas para un diseño minimalista.
  - Se añadieron iconos translúcidos y bordes a los estados vacíos de tareas, clases e historial.

## 10 de Mayo, 2026

* **Feature/Story Name**: Validación de Matriculación (Enrollment Validation)
* **Status**: Completed
* **Business Impact**: Garantiza que los alumnos solo puedan acceder y consultar materiales de las materias en las que están efectivamente inscriptos, protegiendo la privacidad de los contenidos académicos y asegurando el cumplimiento de las reglas de negocio de la universidad.
* **Key Milestones**:
  - Implementación de middleware de validación en el motor RAG (Azure Functions).
  - Integración del sistema de matriculación en el frontend con caché persistente.
  - Migración y ejecución del script de seeding de matriculaciones de prueba (65 alumnos).
  - Verificación exitosa del filtrado de materias en el dashboard de producción.

## 11 de Mayo, 2026

* **Feature/Story Name**: Hardening de Seguridad y Control de Acceso por Matriculación
* **Status**: Completed
* **Business Impact**: Se ha extendido el control de acceso a todos los endpoints críticos del backend (ingesta, analíticas, estados de procesamiento), asegurando que tanto docentes como alumnos solo interactúen con datos de las materias que tienen asignadas, eliminando vulnerabilidades de acceso no autorizado.
* **Key Milestones**:
  - Implementación de validación de matriculación en los endpoints de Ingesta, Analíticas y Gestión de Clases.
  - Protección del endpoint de estado de materiales (#106).
  - Verificación de roles (Docente/Director) para operaciones administrativas sensibles.
