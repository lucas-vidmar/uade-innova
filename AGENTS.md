# Contexto del Agente: Dashboard Educativo Inteligente (UADE Innova)

Sistema RAG educativo serverless sobre Azure Cloud & AI.

---

## 1. Reglas y Políticas Inviolables (Non-Negotiables)

* **Tracking de Historias y Épicas (GitHub Issues):** La ÚNICA fuente de verdad es GitHub Issues en `lucas-vidmar/uade-innova` (`gh issue list`, `gh issue view`). **PROHIBIDO** crear o mantener réplicas locales de épicas, stories o walkthroughs en archivos `.md`.
* **Despliegue y Verificación Mandatoria:** Tras cualquier cambio de código o funcionalidad:
  1. Desplegar a Azure con `azd deploy`.
  2. Verificar manualmente en vivo en la Azure Static Web App utilizando **exclusivamente el navegador embebido de Orca** (`orca goto --url <SWA_URL> --json`, `orca snapshot --json`, `orca click --element <ref> --json`). **PROHIBIDO** usar Playwright (MCP, CLI o scripts `*.spec.js`/`*.mjs`) o Chrome MCP, **salvo que el usuario indique expresamente lo contrario**.
* **Seguridad de Secretos y Configuración:**
  * En **producción**, los secretos residen en Azure Key Vault y se inyectan en Functions mediante referencias `@Microsoft.KeyVault(SecretUri=...)`.
  * En **local**, usar `backend/local.settings.json` / `.env.local` (gitignored). **NUNCA** commitear credenciales, API keys ni emails reales al repositorio.
* **Infraestructura como Código (IaC):** Todos los recursos de Azure se gestionan exclusivamente en `infra/*.bicep`. Nunca crear recursos manualmente en el Azure Portal.
* **Sin mocks en producción:** Los mocks de SGA (notas/asistencia) son solo para prototipo de frontend. El backend debe implementar endpoints listos para integraciones reales.

---

## 2. Peculiaridades Técnicas y Quirks del Entorno (Gotchas)

* **DeepSeek V4 Flash en Azure AI Services:** El recurso `aiservices-dashboard` es de tipo **AIServices** (no OpenAI-kind). **Rechaza tokens Bearer (Managed Identity)**. Debe instanciarse con el SDK base de `OpenAI` y un `fetch` custom que elimine `Authorization: Bearer` y envíe el header `api-key`.
* **Estado de RBAC y Fallback de Key Vault:** Hasta que UADE asigne el rol `Key Vault Secrets User` en `RG_UADE_INNOVA_DEV`, las referencias `@Microsoft.KeyVault(...)` en Azure Functions se resuelven vacías; el código debe mantener el fallback a variables de entorno locales/configuradas.
* **CI/CD Workarounds:** Mientras el Service Principal no tenga permisos de Owner para RBAC, el despliegue en GitHub Actions utiliza `AZURE_STATIC_WEB_APPS_API_TOKEN` (SWA) y `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` (Functions).

---

## 3. Comandos de Referencia Rápida

```bash
# Desarrollo Local
cd backend && npm install && npm start          # Azure Functions local (puerto 7071)
cd frontend && npm install && npm run dev       # Frontend Vite (puerto 5173)

# Infraestructura y Despliegue
azd provision                                   # Provisionar recursos Bicep en RG_UADE_INNOVA_DEV
azd deploy                                      # Build + Deploy de Frontend (SWA) y Backend (Functions)

# Tests y Verificación
cd backend && npm test                          # Tests unitarios backend
cd frontend && npm run test:e2e                 # Tests E2E frontend
node backend/scripts/smoke-prod-application-state.js # Smoke test de estado de aplicación
node backend/scripts/canary-rag-source-isolation.js  # Canary de aislamiento RAG

# GitHub Issues
gh issue list --repo lucas-vidmar/uade-innova --limit 100 --state all
gh issue view <issue-number> --repo lucas-vidmar/uade-innova
```

---

## 4. Trampas Conocidas (Known Pitfalls)

* **Pitfall 1 — Testing de Navegador:** El **único** mecanismo de testing de navegador es el CLI de Orca (`orca goto`, `orca snapshot`, `orca click`). **No usar Playwright bajo ninguna circunstancia** a menos que el usuario lo autorice explícitamente para un caso puntual.
* **Pitfall 2 — Modelos y Rutas:** No asumir la estructura de archivos ni interfaces desde memoria: leer directamente el código en `backend/src/` y `frontend/src/`.
* **Pitfall 3 — Secretos en Commits:** Revisar siempre `git status` antes de commitear para evitar subir archivos de entorno locales o keys.

---

## 5. Diagramación con Draw.io (Reglas de Arquitectura)

Cuando se soliciten diagramas de arquitectura, usar la herramienta `drawio-mcp` con la biblioteca `Azure2`:
* Labels únicos por arista (ej: `POST /api/rag-query`).
* Fan-out de aristas con `exitX` >= 0.15 y waypoints claros.
* Telemetría/Seguridad (Monitor, Sentinel, Log Analytics) **fuera** de la VNet (a la derecha).
* Iconos de zona anclados en top-right.

---

## 6. Índice de Punteros a Documentación (`docs/`)

Para profundizar en áreas específicas del proyecto, consultar bajo demanda:

* **Arquitectura & Decisiones de Diseño:** [`docs/architecture-review.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/architecture-review.md) y [`docs/integration-architecture.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/integration-architecture.md).
* **Guía de Despliegue, CI/CD y Smoke/Canary Probes:** [`docs/deployment-guide.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/deployment-guide.md).
* **Inventario de Secretos y Estado RBAC:** [`docs/secrets-inventory.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/secrets-inventory.md).
* **Configuración de Azure Cost Management API:** [`docs/azure-cost-setup.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/azure-cost-setup.md).
* **Trazabilidad Distribuida y KQL:** [`docs/correlation-middleware.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/correlation-middleware.md) y [`docs/kql-correlation-queries.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/kql-correlation-queries.md).
* **Alcance Funcional:** [`docs/Documento de Alcance Funcional.md`](file:///Users/lucasvidmar/Documents/azure-educational-dashboard/docs/Documento%20de%20Alcance%20Funcional.md).
