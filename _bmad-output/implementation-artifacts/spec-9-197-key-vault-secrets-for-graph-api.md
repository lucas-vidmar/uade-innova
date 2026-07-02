---
title: 'Key Vault Secrets for Graph API'
type: 'feature'
created: '2026-06-18'
baseline_commit: 'c2281118b249ad44afc17ae9cd85ed3b269b0eb6'
status: 'done'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Microsoft Graph API credentials (client ID, client secret, tenant ID) for Teams notifications are not managed in Key Vault, creating a security risk and blocking notification dispatch features.

**Approach:** Add 3 secure parameters and corresponding secret resources to `keyvault.bicep`, wire them from `main.bicep`, and add Key Vault reference app settings in `functions.bicep`.

## Boundaries & Constraints

**Always:**
- All 3 secrets follow the existing Key Vault secret pattern (`Microsoft.KeyVault/vaults/secrets`) used by `SWA-ROLES-SECRET`
- `graphApiTenantId` defaults to `subscription().tenantId` — no mandatory override needed
- `graphApiClientId` and `graphApiClientSecret` are `@secure()` parameters that must be provided at deploy time
- Functions app settings use `@Microsoft.KeyVault(SecretUri=...)` syntax, same as existing `PINECONE_API_KEY` and `SWA_ROLES_SECRET`
- `azd provision` must succeed without errors

**Ask First:**
- Whether to provide actual Graph API client ID and secret values now, or leave them as empty defaults for the Bicep to deploy (requiring manual update in Key Vault portal)

**Never:**
- Do not hardcode secret values in Bicep files
- Do not modify existing Key Vault secrets or Functions app settings
- Do not change the Key Vault RBAC configuration or network ACLs
- Do not create the Entra ID app registration — that is a manual prerequisite

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `azd provision` with all 3 Graph API params | Key Vault contains GRAPH-API-CLIENT-ID, GRAPH-API-CLIENT-SECRET, GRAPH-API-TENANT-ID; Functions app has env vars with KV references | N/A |
| MISSING_CLIENT_SECRET | `graphApiClientSecret` param empty | Bicep deployment fails at validation — `@secure()` enforces non-empty string | Deployment error, user must provide value |
| MISSING_CLIENT_ID | `graphApiClientId` param empty | Bicep deployment fails at validation | Deployment error, user must provide value |
| DEFAULT_TENANT | Only clientId + clientSecret provided | `graphApiTenantId` uses subscription's default tenantId | No error |

</frozen-after-approval>

## Code Map

- `infra/modules/keyvault.bicep` — add `@secure()` params + 3 secret resources for Graph API credentials
- `infra/main.bicep` — wire Graph API params to keyvault module invocation
- `infra/modules/functions.bicep` — add 3 app settings with Key Vault references for Graph API env vars

## Tasks & Acceptance

**Execution:**
- [x] `infra/modules/keyvault.bicep` — add `graphApiClientId`, `graphApiClientSecret`, `graphApiTenantId` params; add 3 secret resources following SWA-ROLES-SECRET pattern
- [x] `infra/main.bicep` — add Graph API param declarations and pass them to keyvault module
- [x] `infra/modules/functions.bicep` — add `GRAPH_API_CLIENT_ID`, `GRAPH_API_CLIENT_SECRET`, `GRAPH_API_TENANT_ID` app settings with Key Vault references

**Acceptance Criteria:**
- Given the infra directory, when running `azd provision`, then Key Vault contains `GRAPH-API-CLIENT-ID`, `GRAPH-API-CLIENT-SECRET`, and `GRAPH-API-TENANT-ID` secrets
- Given the infra directory, when running `azd provision`, then the Functions app has app settings `GRAPH_API_CLIENT_ID`, `GRAPH_API_CLIENT_SECRET`, and `GRAPH_API_TENANT_ID` referencing Key Vault

## Spec Change Log

## Design Notes

The secret values come from a manual Entra ID app registration with `TeamsActivity.Send` and `User.Read` delegated permissions. Since `main.bicep` is the orchestrator, params flow from `main.bicep` → `keyvault.bicep` secure params → secret resources. The `functions.bicep` references them by Key Vault URI, avoiding any secret exposure in app settings.

## Verification

**Commands:**
- `azd provision` — expected: exits 0, no errors
- `az keyvault secret list --vault-name <name> --query "[].name"` — expected: includes `GRAPH-API-CLIENT-ID`, `GRAPH-API-CLIENT-SECRET`, `GRAPH-API-TENANT-ID`
- `az functionapp config appsettings list --name <name> -g <rg> --query "[?starts_with(name, 'GRAPH_API')]"` — expected: 3 settings with `@Microsoft.KeyVault(SecretUri=...)` values

**Manual checks (if no CLI):**
- After `azd provision`, verify Key Vault contains 3 Graph API secrets via Azure Portal
- After `azd provision`, verify Functions App → Configuration → Application settings shows 3 Graph API env vars with Key Vault reference syntax

## Suggested Review Order

**Key Vault secrets (new resource pattern)**

- Add 3 `@secure()` params and 3 secret resources following existing SWA-ROLES-SECRET pattern
  [`keyvault.bicep:22`](../../infra/modules/keyvault.bicep#L22)

**Main orchestrator wiring**

- Wire Graph API params from azd env into keyvault module invocation
  [`main.bicep:78`](../../infra/main.bicep#L78)

- Pass params to module call, enabling `azd provision` to inject them
  [`main.bicep:164`](../../infra/main.bicep#L164)

**Functions app settings**

- 3 Key Vault reference app settings matching existing PINECONE_API_KEY pattern
  [`functions.bicep:250`](../../infra/modules/functions.bicep#L250)
