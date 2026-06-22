# Arquitectura — Frontend (SPA)

## Resumen Ejecutivo

SPA construida con Vanilla JavaScript, Vite 5 y Azure Static Web Apps. Utiliza hash-based routing, componentes funcionales con closures, y comunicación cross-component mediante Custom Events. Sin framework declarativo.

## Stack Tecnológico

| Categoría | Tecnología |
|---|---|
| Lenguaje | JavaScript (ES Modules) |
| Build | Vite 5 |
| Hosting | Azure Static Web Apps (Free Tier) |
| Testing | Playwright (E2E) |
| CSS | Vanilla CSS con variables CSS |
| Fuentes | Google Fonts (Montserrat) |
| Diagramas | Mermaid.js (CDN) |

## Patrón Arquitectónico

**SPA con Hash Router + Componentes Funcionales**

```
index.html
  └─ main.js (bootstrap)
       ├─ auth.initAuth() → SWA /.auth/me
       ├─ themeManager.init()
       ├─ processingNotifications.init()
       └─ inactivityMonitor.init()
            └─ hashchange listener
                 └─ ROUTES registry (dynamic import)
                      └─ renderFn(pageContent)
                           └─ Componentes (Sidebar, ChatWidget, etc.)
```

## Comunicación Cross-Component

```javascript
// Custom Events
window.dispatchEvent(new CustomEvent('auth:roleChanged'))
window.dispatchEvent(new CustomEvent('themeChanged'))
window.dispatchEvent(new CustomEvent('student:trigger-notification'))
```

## Routing

- Hash-based (`window.location.hash`)
- 24 rutas registradas en `ROUTES`
- Guard de acceso por rol
- Lazy loading con `import()` dinámico
- Fallback a dashboard del rol en rutas inválidas

## Estados de UI

- **Loading**: Skeleton/spinner mientras se importa página
- **Error**: Card de error con botón de reintento
- **Empty**: Estados vacíos con icono y mensaje
- **Success**: Renderizado completo

## Consideraciones de Seguridad

- Autenticación delegada a Azure Static Web Apps (EasyAuth)
- Role-based access control en router frontal
- Consentimiento IA requerido para estudiantes
- Headers de correlación en todas las requests
