# Estado del Proyecto - UADE Innova Dashboard Educativo

## 17 de Agosto, 2026

* **Feature/Story Name**: Verificación de Calidad y Cierre de Defectos Críticos del MVP (Issues #291–#296)
* **Status**: Completed
* **Business Impact**: Se garantizaron los flujos centrales de consulta de alumnos y carga de docentes ante caídas de red o arranques lentos del servidor, se habilitó el reproductor de podcast con control de velocidad para estudio en movilidad, se integró el acceso directo a consultas pedagógicas sobre calificaciones y se completó la auditoría de usuarios y glosario técnico.
* **Key Milestones**:
  - Verificación interactiva en navegador Orca de los 6 fixes y cierre formal de issues en GitHub (#291, #292, #293, #294, #295, #296).
  - Resuelto bloqueo de materia activa por defecto: los paneles de estudiante y docente permanecen 100% operativos aún si los servicios backend demoran en responder.
  - Directorio administrativo de usuarios muestra las cuentas del piloto de la universidad de forma inmediata y resiliente.
  - Incorporado reproductor de audio resumen de clases con velocidades seleccionables (1x, 1.25x, 1.5x) y restablecimiento automático.
  - Implementado botón de consulta directa con IA en entregas calificadas con contexto precargado para facilitar la retroalimentación académica.
  - Botón de carga de términos técnicos disponible y accesible en todas las vistas del glosario docente.

## 16 de Agosto, 2026

* **Feature/Story Name**: Production Allowlist Smoke Identities (Story 10.25 / #271)
* **Status**: In Progress — código e IaC completos; provisioning de identidades requiere admin de UADE
* **Business Impact**: Cierra QA-001/QA-009: el gate de release ahora afirma que una identidad smoke por rol (student, teacher, director, admin) resuelve a través de la allowlist server-side y alcanza su dashboard mapeado, y que una identidad no listada recibe 403 `ACCESS_DENIED` (fail closed, con página de acceso denegado + sign-out/retry). Cualquier regresión de auth o de roles no puede pasar el gate.
* **Key Milestones**:
  - `backend/scripts/smoke-allowlist-identities.js` + tests unitarios (gate HTTP por rol + denial de identidad no listada; checks de browser opcionales por rol).
  - Tests de allowlist per-role fixture (AC1) y de identidad no listada (AC3); deny-path en `with-auth`/`auth-utils`.
  - Wiring en `deploy-production.yml` (`smoke-test`) y `staging.yml` (`health-check`) + `secrets-check` fail-closed con `SMOKE_*`.
  - Seed de administrador `adm-001` en `seed-initial-data.js` para que la identidad admin pase endpoints role-gated.
  - Docs en `docs/deployment-guide.md` §CI/CD y `AGENTS.md` §15/§16.

* **Deferred Work / Blockers**:
  - **Provisioning de identidades smoke (requiere UADE)**: las cuatro identidades por rol (emails/passwords) viven como GitHub secrets (`SMOKE_*`) y sus entradas se provisionan en el app setting `ALLOWED_USERS_JSON` (Key Vault-referenced). Requiere una cuenta UADE por rol + rol `Key Vault Secrets User` para resolver la reference. El gate queda `SMOKE_ALLOWLIST_ENABLED=false` hasta que eso ocurra (SKIP no bloquea; fail-closed una vez activado).
  - **Verificación en browser de las dashboards por rol**: los checks `dashboard-{role}`/`access-denied-browser` requieren las credenciales reales de las identidades smoke; sin ellas solo se verifica la capa HTTP (resolución de allowlist + 403).
  - **RBAC (story 10.13)**: las references de Key Vault se resuelven con la identidad de la Function App; hasta que UADE otorgue los roles, `ALLOWED_USERS_JSON` se resuelve vacío (allowlist no configurada, comportamiento legacy).

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
