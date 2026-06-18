---
title: '9.3 — Timer and Queue Trigger Configuration'
type: 'feature'
created: '2026-06-18'
status: 'done'
baseline_commit: 'fb6ca3aaacaa9799cae960edb602c8f33305f07a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Function App already uses Timer triggers (post-class-summary, deadline-proximity) but has no provisioned Storage Queue for Queue-triggered async processing. The extension bundle and runtime are configured, but the queue infrastructure is missing from IaC.

**Approach:** Add a Storage Queue resource to the Bicep storage module, wire it through to the functions module as an app setting, and verify the existing extension bundle covers all required trigger types.

## Boundaries & Constraints

**Always:**
- All resources defined in Bicep only (no manual Azure Portal changes)
- Queue name follows kebab-case convention, max 63 chars
- Queue uses the existing storage account (no new storage account)
- Extension bundle in host.json must remain `[4.*, 5.0.0)` to support HTTP + Timer + Queue + Blob triggers
- `FUNCTIONS_WORKER_RUNTIME` stays `node`

**Ask First:**
- Queue name (default proposal: `ingestion-tasks`)
- Whether additional queues are needed beyond the default

**Never:**
- No new storage account or separate queue-specific infrastructure
- No changes to the timer trigger schedules or logic
- No changes to existing timer function code

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Queue provisioned | `azd provision` | Queue `ingestion-tasks` exists in storage account | Queue name collision → Bicep error (unique within storage account) |
| Queue name output | `azd deploy` | `AZURE_STORAGE_QUEUE_INGESTION` env var set in Function App with correct queue name | If missing → function can't resolve queue at runtime |
| host.json check | `azd provision` | Extension bundle v4.x active (covers HTTP, Timer, Queue, Blob) | Bundle version mismatch → Functions runtime logs warning |

</frozen-after-approval>

## Code Map

- `infra/modules/storage.bicep` — Add `ingestion-tasks` queue resource + output its name
- `infra/modules/functions.bicep` — Add `AZURE_STORAGE_QUEUE_INGESTION` app setting
- `infra/main.bicep` — Wire queue name output from storage to functions module
- `backend/host.json` — Verify extension bundle is correct (already is)

## Tasks & Acceptance

**Execution:**
- [x] `infra/modules/storage.bicep` — Add `Microsoft.Storage/storageAccounts/queueServices/queues` resource named `ingestion-tasks`, plus output `ingestionQueueName`
- [x] `infra/modules/functions.bicep` — Add input param `ingestionQueueName` and app setting `AZURE_STORAGE_QUEUE_INGESTION` referencing it
- [x] `infra/main.bicep` — Pass `storage.outputs.ingestionQueueName` to `functions` module
- [x] `backend/host.json` — Verify extension bundle already includes Queue triggers (v4.x covers all)

**Acceptance Criteria:**
- Given `azd provision` is run, when infrastructure is deployed, then a queue named `ingestion-tasks` exists in the storage account
- Given the Function App starts, when it reads `AZURE_STORAGE_QUEUE_INGESTION`, then the value equals `ingestion-tasks`
- Given a new Queue-triggered function is written, when it uses `app.storageQueue()`, then it can receive messages from `ingestion-tasks` without additional configuration

## Suggested Review Order

**Queue resource provisioning**

- New `ingestion-tasks` queue in storage account for async ingestion pipeline
  [`../infra/modules/storage.bicep#L170`](../infra/modules/storage.bicep#L170)

- Queue service resource required as parent
  [`../infra/modules/storage.bicep#L164`](../infra/modules/storage.bicep#L164)

- Output queue name for cross-module consumption
  [`../infra/modules/storage.bicep#L218`](../infra/modules/storage.bicep#L218)

**Function App wiring**

- App setting exposing queue name to function runtime
  [`../infra/modules/functions.bicep#L221`](../infra/modules/functions.bicep#L221)

- Parameterized queue name with `ingestion-tasks` default
  [`../infra/modules/functions.bicep#L61`](../infra/modules/functions.bicep#L61)

**Orchestrator connection**

- Wire queue output from storage to functions module
  [`../infra/main.bicep#L181`](../infra/main.bicep#L181)

**Local dev parity**

- Queue env var in local.settings.json for local function execution
  [`../backend/local.settings.json#L12`](../backend/local.settings.json#L12)

## Deferred Findings

- **No consumer code yet** — Queue-triggered functions will be built in future stories
- **Poison/dead-letter queue** — Should be addressed when queue consumer is implemented
- **Managed Identity RBAC for queue** — Pre-existing limitation (see AGENTS.md §15)

## Verification

**Commands:**
- `azd provision` — expected: success, queue created
- `az functionapp config appsettings list --name <func-name> --resource-group RG_UADE_INNOVA_DEV --query "[?name=='AZURE_STORAGE_QUEUE_INGESTION']"` — expected: value is `ingestion-tasks`
- `az storage queue list --account-name <storage-name> --query "[?name=='ingestion-tasks']"` — expected: queue exists
