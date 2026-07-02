# Epic 9: Infrastructure Foundation — Implementation Context

**Prerequisite for:** Epics 2, 4, 5, 7
**Status:** Precondition — must complete before material ingestion, corrections, notifications, or observability features.
**Issues:** #96, #107, #196, #197, #198 (Story 9.3 already done)

---

## Existing Infrastructure (Already Deployed)

| Resource | Bicep module | Notes |
|---|---|---|
| Storage Account | `infra/modules/storage.bicep` | Existing containers: `class-materials`, `processed`. Existing tables: `UserProfiles`, `SessionMetrics`, `materials`, `classes`, `Enrollments`, `UserConsent`. Existing queue: `ingestion-tasks`. |
| Key Vault | `infra/modules/keyvault.bicep` | RBAC-based. Existing secret: `SWA-ROLES-SECRET`. Pinecone key referenced from Functions. |
| Functions App | `infra/modules/functions.bicep` | Consumption Y1, Node 20. Has `FUNCTIONS_WORKER_RUNTIME=node`, `EnableWorkerIndexing`. Extension bundle `[4.*, 5.0.0)` in `host.json` already covers HTTP + Timer + Queue triggers. |
| Azure OpenAI | `infra/modules/openai.bicep` | Deployments: GPT-4.1 mini + text-embedding-3-small. |
| Static Web App | `infra/modules/staticwebapp.bicep` | Free tier, CORS from Functions already configured. |

---

## Story 9.1 — Bicep: Add New Resources to `storage.bicep`

### New Blob Containers Needed
```bicep
// Glossary term files per subject
name: 'glossary-files' // metadata: { purpose: 'Glossary JSON files per subject' }
// AI-generated class summaries (teacher-validated)  
name: 'summaries'      // metadata: { purpose: 'Teacher-validated AI class summaries' }
```

### New Tables Needed
| Table Name | PartitionKey | RowKey | Purpose |
|---|---|---|---|
| `Corrections` | `subjectId` | `correctionId` (UUID) | Student-reported incorrect answers, teacher corrections |
| `CorrectionsPending` | `"pending"` | `correctionId` (UUID) | Denormalized index for teacher inbox query |
| `Conversations` | `userId` | `timestampInverted` + `conversationId` | Saved RAG chat threads with full message history |
| `ConversationRatings` | `conversationId` | `messageIndex` | Thumbs up/down per chat response |
| `NotificationPreferences` | `userId` | `"preferences"` | Per-user notification toggle settings |
| `UserEvents` | `userId` | `timestampInverted` + `eventId` | Analytics events for director dashboard |

### New Queue Needed
```bicep
name: 'notification-queue'
// metadata: { purpose: 'Async notification dispatch for Graph API Teams messages' }
```

### Reference: Naming Convention
All table/container/queue resources follow the pattern in `infra/modules/storage.bicep` — no separate file, just append to the existing module's resource declarations.

---

## Story 9.2 — Key Vault Secrets for Graph API

Add these **3 secrets** to `infra/modules/keyvault.bicep`:

```bicep
resource graphClientId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GRAPH-API-CLIENT-ID'
  properties: { value: graphApiClientId }
}
resource graphClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GRAPH-API-CLIENT-SECRET'
  properties: { value: graphApiClientSecret }
}
resource graphTenantId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GRAPH-API-TENANT-ID'
  properties: { value: graphApiTenantId }
}
```

Add corresponding `@secure()` params at the top of `keyvault.bicep`:
- `graphApiClientId` (string)
- `graphApiClientSecret` (string)
- `graphApiTenantId` (string = subscription().tenantId)

In `functions.bicep`, add Key Vault references:
```json
{ "name": "GRAPH_API_CLIENT_ID", "value": "@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-CLIENT-ID/)" },
{ "name": "GRAPH_API_CLIENT_SECRET", "value": "@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-CLIENT-SECRET/)" },
{ "name": "GRAPH_API_TENANT_ID", "value": "@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-TENANT-ID/)" }
```

Values come from Entra ID app registration with `TeamsActivity.Send` and `User.Read` delegated permissions. Regenerate client secret before setting.

---

## Story 9.3 — Triggers (Already Done)

| Requirement | Status | File |
|---|---|---|
| Extension bundle includes HTTP, Timer, Queue | ✅ `[4.*, 5.0.0)` in `host.json` | `backend/host.json:12-13` |
| `FUNCTIONS_WORKER_RUNTIME=node` | ✅ Already set | `infra/modules/functions.bicep:128-130` |
| `EnableWorkerIndexing` | ✅ Already set | `infra/modules/functions.bicep:137` |

No changes needed. Queue-triggered Functions (`send-notification`) and Timer-triggered Functions (`daily-reminders`, `aggregate-metrics`) can be added as new Function folders within `backend/src/functions/` following the existing Patterns.

---

## Key Patterns to Follow

- **API response format:** `{ success, data|error, meta: { timestamp, requestId } }`
- **Error logging:** Always include `context.invocationId`, `materialId`, `userId`
- **Naming:** kebab-case files, camelCase JSON/PK/RK, PascalCase tables, UPPER_SNAKE_CASE constants
- **Tests:** Co-located `index.test.js` in same folder as each Function
- **No hardcoded secrets:** All from Key Vault refs in App Settings or `process.env`
