---
trigger: always_on
---

# Estándares de Despliegue y Verificación
**Descripción**: Asegura que todas las implementaciones estén en vivo y verificadas en Azure antes de finalizar una tarea.

## Requisitos
1. **Despliegue Obligatorio en Azure**: Después de implementar cualquier cambio de código o funcionalidad, DEBES desplegar las actualizaciones a Azure utilizando `azd deploy`. Esto garantiza que el entorno esté sincronizado con el repositorio.
2. **Verificación en Navegador Chrome**: Una vez desplegado, DEBES utilizar las herramientas de navegador (Chrome) para navegar a la URL de la Static Web App desplegada.
3. **Validación Funcional**: DEBES probar manualmente (a través del subagente de navegador) la funcionalidad específica que acabas de implementar para asegurar que funcione correctamente en el entorno de la nube, no solo localmente.
4. **Criterios de Finalización**: Una tarea de implementación NO se considera terminada hasta que:
   - El código esté commiteado.
   - El proyecto haya sido desplegado a Azure (`azd deploy`).
   - La funcionalidad haya sido verificada con Chrome en la URL en vivo.
5. **Reporte de Verificación**: En tu respuesta final o walkthrough, confirma que el despliegue fue exitoso y que la funcionalidad fue verificada en el navegador.
