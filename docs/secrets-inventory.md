# Inventario de Secretos — Migración a Key Vault / Managed Identity

**Story:** 10.13 — Secrets to Key Vault Managed Identity (issue #220, epic-10).

Este documento cataloga cada variable de entorno que transporta un secreto (API key o connection string)
consumida por `backend/src/`, su clasificación de destino y el estado de la migración.

## Contexto

- El proyecto usa **API Keys y Connection Strings** como mecanismo de autenticación (AGENTS.md §4) porque
  los role assignments RBAC requieren permisos de Owner en el RG, otorgados por UADE.
- Esta story mueve todos los secretos a **Azure Key Vault** y, donde el prerequisito RBAC esté satisfecho,
  cambia el acceso a **Managed Identities** (`DefaultAzureCredential`).
- DeepSeek (Azure AI Foundry, AIServices-kind) **no puede usar Managed Identity**: las cuentas AIServices-kind
  rechazan `Authorization: Bearer` y exigen el header `api-key`. Su clave vive en Key Vault (AC #6).

## Inventario

| Env var | Consumidor | Función App setting | Secreto KV existe? | Clasificación de destino |
|---|---|---|---|---|
| `AZURE_OPENAI_API_KEY` | `backend/src/services/ai.js:39,56,98,304` | `infra/modules/functions.bicep` appSettings | ✅ `AZURE-OPENAI-API-KEY` (nuevo) | `keyvault-reference` (AC #3); MI como alternativa cuando RBAC esté activo (AC #5) |
| `PINECONE_API_KEY` | `backend/src/services/vector-store.js:46` | `functions.bicep` appSettings | ✅ `PINECONE-API-KEY` (ya declarado) | `keyvault-reference` (AC #3) — Pinecone no soporta MI |
| `AZURE_STORAGE_ACCESS_KEY` | `backend/src/services/storage.js:24,265`; `backend/src/functions/material-download.js:39`; `backend/src/functions/process-material.js:29` | `functions.bicep` appSettings | ✅ `AZURE-STORAGE-ACCESS-KEY` (nuevo) | `keyvault-reference` (key-based primario, AC #4 replan); MI fallback solo si keys vacías |
| `AZURE_STORAGE_CONNECTION_STRING` | `backend/src/services/storage.js:25,266`; `backend/src/services/storage-lifecycle.js:8`; `backend/src/services/archive-usage.js:9` | `functions.bicep` appSettings | ✅ `AZURE-STORAGE-CONNECTION-STRING` (ya creado en `main.bicep`) | `keyvault-reference` (key-based primario, AC #4 replan); MI fallback solo si keys vacías |
| `AI_FOUNDRY_DEEPSEEK_KEY` | `backend/src/services/ai.js:76,84,167` | NO estaba en appSettings (solo local) | ✅ `AI-FOUNDRY-DEEPSEEK-KEY` (nuevo) | `keyvault-reference` (AC #6) — DeepSeek no soporta MI |
| `AI_FOUNDRY_DEEPSEEK_ENDPOINT` | `backend/src/services/ai.js:75` | NO estaba en appSettings | n/a (no-secreto) | app setting no-secreto (AC #6) |
| `AI_FOUNDRY_DEEPSEEK_MODEL` | `backend/src/config.js:50` | NO estaba en appSettings | n/a (no-secreto) | app setting no-secreto |
| `AzureWebJobsStorage` | runtime de Functions | `functions.bicep:175` (connection string) | ❌ | runtime-managed — lo administra el plan Consumption, se mantiene como connection string calculada en deploy |
| `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING` | runtime de Functions (contenido Linux) | `functions.bicep:199-201` (connection string) | ❌ | runtime-managed — requisito del plan Consumption Linux, se mantiene |

### Consumidores y línea exacta (fuente)

- `backend/src/services/ai.js:39,56,98,304` — `AZURE_OPENAI_API_KEY`
- `backend/src/services/ai.js:75` — `AI_FOUNDRY_DEEPSEEK_ENDPOINT`
- `backend/src/services/ai.js:76,84,167` — `AI_FOUNDRY_DEEPSEEK_KEY`
- `backend/src/config.js:50` — `AI_FOUNDRY_DEEPSEEK_MODEL`
- `backend/src/services/vector-store.js:46` — `PINECONE_API_KEY`
- `backend/src/services/storage.js:18,192` — `AZURE_STORAGE_ACCESS_KEY`
- `backend/src/services/storage.js:193,198` — `AZURE_STORAGE_CONNECTION_STRING`
- `backend/src/functions/material-download.js:39` — `AZURE_STORAGE_ACCESS_KEY` (SAS de descarga)
- `backend/src/functions/process-material.js:29` — `AZURE_STORAGE_ACCESS_KEY` (blob client fallback)
- `backend/src/services/storage-lifecycle.js:8` — `AZURE_STORAGE_CONNECTION_STRING`
- `backend/src/services/archive-usage.js:9` — `AZURE_STORAGE_CONNECTION_STRING`

## Estado de la migración

- [x] AC #1 — este inventario documentado
- [x] AC #2 — `AZURE-OPENAI-API-KEY`, `AI-FOUNDRY-DEEPSEEK-KEY`, `AZURE-STORAGE-ACCESS-KEY` declarados en Key Vault
- [x] AC #3 — Functions consume los 4 secretos vía `@Microsoft.KeyVault(SecretUri=...)`
- [x] AC #4 — `storage.js` prefiere keys (`AZURE_STORAGE_CONNECTION_STRING` → `ACCOUNT_NAME+ACCESS_KEY`) en **todos** los entornos; `DefaultAzureCredential` solo fallback si keys vacías (replan 2026-08-19, sin RBAC requerido). Azurite intacto.
- [x] AC #5 — `ai.js` path de Managed Identity confirmado + logging de error de token
- [x] AC #6 — `AI_FOUNDRY_DEEPSEEK_KEY` resuelto desde Key Vault; fetch override preservado
- [x] AC #7 — local config sin secretos reales + script bootstrap vía `az keyvault secret show`
- [ ] AC #8 — verificación en producción **BLOQUEADA**: requiere `Key Vault Secrets User` RBAC de UADE para resolver `@Microsoft.KeyVault` refs (permiso Owner en RG). Storage ya no bloquea: key-based evita `Storage Blob/Table Data Contributor`.

## Notas

- Los secretos ya existentes en Key Vault (`SWA-ROLES-SECRET`, `GRAPH-API-*`, `ENTRA-*`,
  `ALLOWED-USERS-JSON`, `PINECONE-API-KEY`) no se modifican.
- `FRONT_DOOR_ID` referencia un secreto que está comentado en `main.bicep` (Front Door disabled).
  Se mantiene el app setting `FRONT_DOOR_ID` porque `auth-utils.js:219-226` lo tolera: si el valor
  contiene `@Microsoft.KeyVault` o `PLACEHOLDER`, `validateFrontDoorId` retorna `true` (no bloquea).
  **Cleanup pendiente** cuando se elimine Front Door o se agregue el secreto.