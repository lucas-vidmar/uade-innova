# Estado del Proyecto - UADE Innova Dashboard Educativo

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
