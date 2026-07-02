---
title: 'Bicep Provisioning for New Resources'
type: 'feature'
created: '2026-06-18'
baseline_commit: 'b90208d48107e522679c9e02c60e51a0b0a30c1d'
status: 'done'
context:
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Multiple Azure Storage resources (blob containers, tables, queues) used by Epics 2-7 exist only in code references but are not provisioned via Bicep, and the storage account connection string is not stored in Key Vault.

**Approach:** Add all missing blob containers, table storage tables, and queue to `storage.bicep`; store the storage connection string as a Key Vault secret; wire through `main.bicep` outputs so dependent modules can reference them.

## Boundaries & Constraints

**Always:**
- All new resources follow existing naming conventions (no hardcoded names)
- New tables use the same `Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01` resource type
- New containers use `Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01`
- New queues use `Microsoft.Storage/storageAccounts/queueServices/queues@2023-01-01`
- Storage connection string stored as `AZURE-STORAGE-CONNECTION-STRING` in Key Vault
- All new resources have outputs in storage.bicep for the main orchestrator to consume
- `azd provision` must succeed without errors

**Ask First:**
- Whether to add Functions app settings for the new table names now (they'll be consumed by future stories) or defer until each Function that uses them is implemented

**Never:**
- Do not modify existing container, table, or queue configurations (names, lifecycle policies, access)
- Do not add Managed Identity RBAC assignments (not possible per AGENTS.md constraints)
- Do not change the Function App's existing app settings or host.json

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `azd provision` runs | All 4 containers, 10 tables, 2 queues created; connection string in KV | N/A |
| PARTIAL_EXIST | Some resources already exist | Bicep is idempotent — existing resources are not recreated | No-op on existing |
| MISSING_KV | Key Vault not yet deployed | Bicep dependency chain ensures KV deploys before secret | Module dependency in main.bicep |

</frozen-after-approval>

## Code Map

- `infra/modules/storage.bicep` — add missing containers, tables, queue, and their outputs
- `infra/main.bicep` — add storage connection string secret to Key Vault, wire new outputs
- `infra/modules/functions.bicep` — add app settings for new table names (if user approves Ask First)

## Tasks & Acceptance

**Execution:**
- [x] `infra/modules/storage.bicep` — add `glossary-files` and `summaries` blob containers
- [x] `infra/modules/storage.bicep` — add `Corrections`, `CorrectionsPending`, `Conversations`, `ConversationRatings`, `NotificationPreferences`, `UserEvents` tables
- [x] `infra/modules/storage.bicep` — add `notification-queue` queue
- [x] `infra/modules/storage.bicep` — add outputs for all new resources (container names, table names, queue names)
- [x] `infra/main.bicep` — add `Microsoft.KeyVault/vaults/secrets` resource for storage connection string using `listKeys()`
- [x] `infra/modules/functions.bicep` — add app settings for new table names

**Acceptance Criteria:**
- Given the infra directory, when running `azd provision`, then all 4 blob containers, 10 tables, and 2 queues exist in the storage account
- Given the infra directory, when running `azd provision`, then Key Vault contains `AZURE-STORAGE-CONNECTION-STRING` secret

## Spec Change Log

## Design Notes

The storage connection string secret must be created in `main.bicep` (not in `keyvault.bicep`) because `main.bicep` has access to both the storage account ID (via `storage.outputs.accountId`) and the Key Vault (via `keyVault.outputs.keyVaultName`). The secret uses the `listKeys()` function to resolve the access key at deployment time:

```bicep
resource storageConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AZURE-STORAGE-CONNECTION-STRING'
  properties: {
    value: 'DefaultEndpointsProtocol=https;AccountName=${storage.outputs.accountName};AccountKey=${listKeys(storage.outputs.accountId, '2023-01-01').keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
  }
}
```

## Verification

**Commands:**
- `azd provision` — expected: all resources created, exits 0
- Storage account should have containers: class-materials, processed, glossary-files, summaries
- Storage account should have tables: Enrollments, UserConsent, Corrections, CorrectionsPending, Conversations, ConversationRatings, NotificationPreferences, UserEvents, materials, classes, UserProfiles, SessionMetrics
- Storage account should have queues: ingestion-tasks, notification-queue
- Key Vault should contain secret `AZURE-STORAGE-CONNECTION-STRING`

**Manual checks (if no CLI):**
- After `azd provision`, verify storage account in Azure Portal or via `az storage account show`

## Suggested Review Order

**Storage resource additions**

- New blob containers for glossaries and summaries follow existing patterns
  [`storage.bicep:64`](../../infra/modules/storage.bicep#L64)

- New tables for Epics 3-7 (Corrections, Conversations, Ratings, Preferences, Events)
  [`storage.bicep:228`](../../infra/modules/storage.bicep#L228)

- New notification queue for async dispatch
  [`storage.bicep:205`](../../infra/modules/storage.bicep#L205)

- All new resources exposed as typed outputs
  [`storage.bicep:277`](../../infra/modules/storage.bicep#L277)

**Key Vault integration**

- Storage connection string stored as KV secret via `listKeys()` at deploy time
  [`main.bicep:157`](../../infra/main.bicep#L157)

- New table/container/queue names wired from storage outputs to Functions module
  [`main.bicep:187`](../../infra/main.bicep#L187)

**Functions app settings**

- New params for all table, container, and queue names
  [`functions.bicep:78`](../../infra/modules/functions.bicep#L78)

- App settings registered for runtime environment variable consumption
  [`functions.bicep:255`](../../infra/modules/functions.bicep#L255)
