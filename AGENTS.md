# Contexto del Agente: Dashboard Educativo Inteligente (UADE Innova)

Sistema RAG educativo serverless sobre Azure Cloud & AI.

---

## 1. Reglas y Políticas Inviolables (Non-Negotiables)

* **Tracking de Historias y Épicas (GitHub Issues):** La ÚNICA fuente de verdad es GitHub Issues en `lucas-vidmar/uade-innova` (`gh issue list`, `gh issue view`). **PROHIBIDO** crear o mantener réplicas locales de épicas, stories o walkthroughs en archivos `.md`.
* **Despliegue y Verificación Mandatoria (aislamiento por worktree):**
  * **Regla por defecto (worktrees `worker`): NO desplegar a Azure compartido.** Verificar en local con `cd backend && npm test` + `npm start` (Azurite, puerto 7071) y `cd frontend && npm run dev` (Vite, puerto 5173). El navegador embebido de Orca contra `http://localhost:5173` es el mecanismo de verificación local. **PROHIBIDO** ejecutar `azd deploy` / `azd provision` contra el entorno compartido `uade-dev` desde un worktree paralelo — colisiona con otros agentes (último deploy gana, ver `azure.yaml:12` / `infra/main.bicep:144`).
  * **Despliegue compartido solo vía `integrator` / rama `main`/`staging` / CI:** `azd deploy` al entorno `uade-dev` (`RG_UADE_INNOVA_DEV`) solo desde el worktree principal o GitHub Actions (`deploy-production.yml` / `staging.yml`). Requiere autorización humana explícita (ver §3.5).
  * **Despliegue efímero opt-in por worktree (cuando se necesita Azure real):** `scripts/new-worktree-env.sh` crea un `azd env` aislado `wt-<slug>` → `azd provision` genera Function App + SWA + Storage propios en el mismo RG (token distinto vía `uniqueString(subscription.id, environmentName, location)`). Verificar contra ese SWA efímero con Orca (`orca goto --url $AZURE_STATIC_WEB_APP_URI`). Limpiar con `scripts/cleanup-worktree-env.sh`.
  * **Verificación remota:** usar el navegador embebido de Orca contra el SWA objetivo (compartido o efímero) (`orca goto --url <SWA_URL> --json`, `orca snapshot --json`, `orca click --element <ref> --json`). **PROHIBIDO** usar Playwright (MCP, CLI o scripts `*.spec.js`/`*.mjs`) o Chrome MCP, **salvo que el usuario indique expresamente lo contrario**.
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

# Verificación local (worktrees worker — sin deploy)
cd backend && npm test && npm start   # Functions + Azurite (7071)
cd frontend && npm run dev            # Vite (5173) → orca goto --url http://localhost:5173

# Deploy efímero por worktree (solo cuando se necesita Azure real)
./scripts/new-worktree-env.sh         # crea azd env wt-<slug> + provision aislado
azd env get-values                    # expone AZURE_STATIC_WEB_APP_URI del env efímero
orca goto --url $AZURE_STATIC_WEB_APP_URI --json
./scripts/cleanup-worktree-env.sh     # borra recursos efímeros del worktree

# Entorno compartido uade-dev (solo integrator / CI)
azd env select uade-dev        # o: azd env refresh  — recrea .azure/uade-dev/.env
azd env get-values             # verifica RG_UADE_INNOVA_DEV y secretos inyectados desde Key Vault
```

---

## 3.5 Orca CLI/MCP: Herramientas Disponibles y Cómo Solicitar Push/Merge

Este proyecto se opera a través de **Orca** (el CLI `orca`). Orca es la fuente de verdad del runtime: worktrees, terminales, navegador embebido, handoffs y orquestación. Usalo para todo lo que toque estado manejado por Orca; usá herramientas de shell solo cuando el estado de Orca no importe.

**La guía NO se hardcodea — se carga en runtime (fuente de verdad versionada).** Los comandos listados abajo son **ejemplos ilustrativos**, no la referencia autoritativa. El CLI de Orca es un *discovery stub*: cada vez que necesites operar Orca, **cargá primero la guía versionada del binario activo y verificá los subcomandos/banderas actuales contra ella antes de ejecutar** (no asumas que los ejemplos de este archivo siguen vigentes tras un update de Orca):
```bash
orca skills get orca-cli        # worktrees, terminales, browser, artifacts, handoffs
orca skills get orchestration   # coordinación multi-agente (task DAG, decision gates)
orca skills get computer-use    # ventanas de escritorio fuera del browser embebido
orca status --json              # confirmar que la app está corriendo (o: orca open --json)
```
Preferí siempre `--json` en llamadas de agente. Si un comando falla con un error de subcomando/bandera desconocido, **volvé a `orca skills get ...`** y usá la sintaxis vigente en vez de insistir con la obsoleta.

### Navegador embebido de Orca (verificación de UI)

El **único** mecanismo de testing de navegador es el browser embebido de Orca. Patrón snapshot → interact → snapshot:
```bash
orca goto --url <SWA_URL> --json
orca snapshot --json              # devuelve refs de elementos (ej. @e3)
orca click --element @e3 --json   # click / fill / type / select / scroll / wait / tab ...
orca snapshot --json              # re-snapshot tras navegar o cambiar la página
```
Otros: `orca screenshot`, `orca full-screenshot`, `orca pdf`, `orca wait --text/--url/--selector`, `orca tab list/create/switch/close`, `orca eval --expression <js>`, `orca console`, `orca network`. Si un ref queda obsoleto (`browser_stale_ref`), re-correr `orca snapshot`. Si no hay tab (`browser_no_tab`), abrir con `orca tab create --url <url>`.

### Worktrees, terminales y handoffs

```bash
orca worktree list --json
orca worktree ps --json
orca worktree create --name <task> --agent codex --prompt "<brief>" --json   # handoff a otro agente
orca terminal list --json
orca terminal read --terminal <handle> --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 300000 --json
orca terminal send --terminal <handle> --text "continue" --enter --json
orca worktree set --worktree active --comment "estado actual" --json
```
Los `worktree.id` tienen formato `<repoId>::<worktreePath>`: copiar el id completo, no solo el repoId.

**Bootstrap automático de worktrees nuevos:** el repo tiene configurado (Orca → Settings del repo → Setup script) `bash scripts/worktree-setup.sh`, que corre en cada `worktree create` (política `run-by-default`) y abre en el browser de Orca la página de credenciales (`https://share.onorca.dev/a/Z7HBFVzhGN7Z`) + deja comment en el worktree. Para que el agente arranque junto al setup, crear con `--agent opencode` (o el agente deseado): `orca worktree create --name <task> --agent opencode --prompt "<brief>" --json`.

### Cómo solicitar PUSH y MERGE (los agentes NO hacen push/merge por sí solos)

* **Los agentes entregan commits locales y NO ejecutan `git push`, `git merge`, `gh pr create` ni `gh pr merge`.** Esas acciones quedan restringidas por permisos (`worker` las tiene `deny`; `integrator` las tiene `ask`) y requieren **autorización humana explícita**.
* **Flujo de trabajo:** el `worker` implementa una historia y entrega un commit local (SHA, archivos, pruebas, riesgos) → el `integrator` verifica el conjunto y ejecuta la suite → para **push/merge/PR** el agente debe **solicitarlo al humano/Orca** describiendo exactamente la acción concreta (branch, commit/SHA, destino) y esperar autorización.
* Los agentes **sí pueden commitear** localmente. No confundir: commit = permitido; push/merge/PR/deploy = requiere autorización humana vía Orca.
* Nunca ejecutar `azd down`.

### Otros recursos de Orca a mano

```bash
orca automations list --json                      # automatizaciones programadas
orca artifacts share <file.html|.md> --json       # publicar artifact (requiere permiso humano en Settings → Artifacts)
orca artifacts list --json
orca orchestration task-create / dispatch / check  # coordinación multi-agente (ver skill orchestration)
```
Los cambios a la configuración (`.opencode/opencode.json`, `AGENTS.md`) se commitear y, para propagarse a worktrees, se pushean vía Orca (push no lo hace el agente).

### Cierre de tarea: dejar el browser de Orca listo para el usuario

**Al terminar cualquier tarea/historia —siempre—** dejá el navegador embebido de Orca abierto en la SWA verificada para que el usuario pueda retestear sin pasos extra:
* Si verificaste **en local** (regla por defecto): `orca goto --url http://localhost:5173 --json` + `orca snapshot --json`
* Si desplegaste **efímero** (`wt-*`): `orca goto --url $AZURE_STATIC_WEB_APP_URI --json` (del `azd env` efímero)
* Solo si sos `integrator` y desplegaste a `uade-dev`: `orca goto --url https://agreeable-beach-002ff0c0f.6.azurestaticapps.net --json` — SWA: `stapp-dashboard-q47bia47kk3na`, `RG_UADE_INNOVA_DEV`

Si `SWA_URL` cambió, resolvela con `azd env get-values` o `infra/` y revalidá con `orca skills get orca-cli` antes de ejecutar. No omitas este paso aunque la tarea no haya tocado código de frontend — el usuario espera el browser listo para verificación inmediata.

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
