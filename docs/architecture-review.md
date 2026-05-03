# Architectural Review: UADE Educational Dashboard

**Date:** March 2026  
**Reviewer:** Architecture Review  
**Status:** Draft for Discussion

---

## Executive Summary

The current architecture is sound for a 65-user pilot with a 100% serverless approach. However, several components introduce unnecessary complexity or leave critical gaps unaddressed. This document outlines findings and recommendations for consideration before the pilot scales.

---

## 1. Remove Azure Front Door

### Current State

The infrastructure deploys **Azure Front Door (AFD)** as a WAF and routing layer in front of both the Static Web App and Azure Functions.

```
User → Front Door → Static Web App
                   → Azure Functions
```

### Finding

**Front Door is redundant for this pilot.**

Azure Static Web Apps already provides:
- Global CDN distribution
- Automatic SSL termination
- DDoS protection (basic tier)
- Custom domain support

Adding Front Door on top introduces:
- Additional cost (~$0.78/M requests + bandwidth)
- Extra latency (one more hop)
- Another resource to monitor and maintain
- Complexity in routing rules and health probes

### Recommendation

**Remove Front Door.** For a 65-user pilot with low traffic, the built-in capabilities of Static Web Apps are sufficient. If WAF protection becomes a requirement later, AFD can be added at that point with minimal refactoring.

### Implementation

Remove the `frontDoor` module from `infra/main.bicep` and update the Static Web App output to be the primary endpoint. No application code changes are required.

---

## 2. Add a State Store for Domain Entities

### Current State

The AGENTS.md specification defines two core domain entities:

- **`Material`**: Tracks uploaded files, processing status, and blob URLs
- **`Class`**: Groups materials by class session with metadata

Currently, there is **no persistence layer** defined for these entities. Azure Functions rely on in-flight state or recreate queries from scratch.

### Finding

**Without a state store, the system cannot:**

1. Track material processing status (pending → processing → ready → error)
2. List classes with their associated materials for the teacher UI
3. Resume failed ingestion jobs
4. Provide consistent data to the frontend without re-querying Pinecone

### Recommendation

**Add Azure Table Storage** (included with the existing Storage Account) as the state store for domain entities.

| Entity | Table | Partition Key | Row Key |
|--------|-------|---------------|---------|
| Material | `materials` | `subjectId` | `materialId` |
| Class | `classes` | `subjectId` | `classId` |

**Why Table Storage (not Cosmos DB)?**
- Zero cost at pilot scale (~$0.01/GB/month)
- Already covered by existing Storage Account (no new resource)
- Sufficient for simple key-value access patterns
- Native integration with Managed Identity

### Schema Draft

```typescript
// Material entity (Table Storage)
interface MaterialEntity {
  PartitionKey: string;       // subjectId
  RowKey: string;            // materialId
  classId: string;
  type: "transcript" | "presentation" | "notes" | "bibliography";
  filename: string;
  status: "pending" | "processing" | "ready" | "error";
  blobUrl: string;
  uploadedAt: string;        // ISO 8601
  processedAt?: string;     // ISO 8601
  errorMessage?: string;
}

// Class entity (Table Storage)
interface ClassEntity {
  PartitionKey: string;      // subjectId
  RowKey: string;            // classId
  title: string;
  date: string;              // ISO 8601
  topics: string;            // JSON-encoded string[]
  summaryReady: boolean;
}
```

### Implementation

1. Add Table Storage output to `infra/modules/storage.bicep`
2. Grant Functions read/write to the tables via Managed Identity
3. Update `ingest-material` function to write status to Table Storage
4. Update `get-classes` function to query Table Storage

---

## 3. Add SSO via Microsoft Entra ID (Easy Auth)

### Current State

AGENTS.md specifies Entra ID integration for "Zero-Trust" authentication. The infrastructure does not currently wire this up.

### Finding

**SSO is essential for an educational platform.** Without it:
- Users must create separate credentials (bad UX, security risk)
- Access control per role (student/teacher/director) is not possible
- No audit trail of who accessed what

### Recommendation

**Enable Easy Auth on Static Web Apps** — the built-in authentication provider that handles Entra ID OIDC without additional infrastructure.

```
Static Web Apps → Authentication (Easy Auth)
                 ├── Provider: Microsoft Entra ID
                 ├── Client ID: from Entra App Registration
                 └── Token validation: automatic
```

### Implementation Steps

1. Register an application in Microsoft Entra ID
2. Add app settings to Static Web App module:
   - `AZURE_STATIC_WEB_APP_CLIENT_ID`
   - `AZURE_STATIC_WEB_APP_TENANT_ID`
3. Configure route guards in the frontend to redirect unauthenticated users
4. Pass the validated user principal to Functions via `x-ms-client-principal` header (injected by Easy Auth)

### Note on Backend Authentication

Functions should use **API Keys and Connection Strings** to call Azure OpenAI and Storage — not the user's token. The user's token is only used for frontend authentication. The backend's call to resources is a service-to-service operation and uses API Keys due to missing RBAC permissions in the resource group.

---

## 4. Migrate to Pinecone as Vector Store

### Current State

The architecture now uses **Pinecone (Serverless)** as the vector database:
- Dimension: 1536 (for `text-embedding-3-small`)
- Metric: Cosine Similarity
- Authentication: API key via Key Vault

### Finding

Pinecone provides serverless vector storage with free tier for low-volume workloads, ideal for the pilot phase with minimal cost.

### Recommendation

**Use Pinecone (Serverless)** as the default vector store for the pilot phase.

| Aspect | Previous (Standard) | Current (Serverless) |
|--------|----------|-----------------|
| Cost | ~$70-200/month | Free tier (first 100GB) |
| Auth | API Key | API Key |
| Setup | External | External |
| Vector dimensions | 1536 | Up to 3072 |
| Hybrid search | N/A | N/A |
| Monitoring | Pinecone dashboard | Pinecone dashboard |

**Implementation decision:**
- Pinecone is the primary backend for vector retrieval
- Azure Cognitive Search has been completely removed from active architecture

---

## 5. Cost Optimization: Model Selection

### Current State

- Embedding generation (text-embedding-3-small)
- Chat/RAG responses (DeepSeek V4 Flash / gpt-4o-mini fallback)

### Finding

For a cost-sensitive pilot with a **$1.50/aluno/mês** target:
- `DeepSeek V4 Flash` is the most cost-effective option for reasoning and generation.
- `gpt-4o-mini` remains as a robust fallback in Azure OpenAI.

### Recommendation

**No change needed at pilot scale.** The current model selection is appropriate.

Re-evaluate if:
- User count grows beyond 500
- Token usage per user exceeds ~50K/month
- Latency becomes a UX complaint

At that point, consider:
- Caching frequent queries (e.g., "what was last class about?")
- Batching embedding jobs to reduce API calls
- Switching simple Q&A to a smaller, faster model (if available)

---

## Summary of Recommendations

| # | Recommendation | Priority | Effort | Impact |
|---|----------------|----------|--------|--------|
| 1 | Remove Front Door | High | Low | Cost savings, reduced complexity |
| 2 | Add Table Storage for state | High | Medium | Enables full CRUD operations |
| 3 | Enable Easy Auth (Entra ID) | High | Medium | Security and UX |
| 4 | Use Pinecone (Serverless) | High | Low | Cost savings (free tier) |
| 5 | Use DeepSeek V4 Flash | High | Low | Cost savings & quality |

**Recommended for immediate action:** #1, #2, #3, and #4 are architectural gaps that should be addressed before the pilot goes live.

---

## Appendix: Proposed Infrastructure Changes

### Remove from main.bicep

```bicep
// Remove this module
module frontDoor './modules/frontdoor.bicep' = {
  name: 'frontDoor'
  params: {
    profileName: frontDoorName
    frontendHostName: staticWebApp.outputs.staticWebAppHostName
    backendHostName: functions.outputs.functionAppHostName
    tags: tags
  }
}
```

### Add to storage.bicep

```bicep
resource tableStorage 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  name: '${storageAccount.name}/default/materials'
}

resource tableClasses 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  name: '${storageAccount.name}/default/classes'
}
```

### Add to staticwebapp.bicep

```bicep
@description('Entra ID Client ID for Easy Auth')
param entraClientId string = ''

@description('Entra ID Tenant ID for Easy Auth')
param entraTenantId string = ''

resource staticApp 'Microsoft.Web/staticSites@2023-01-01' = {
  // ... existing config ...
  properties: {
    // ... existing properties ...
    authenticationSettings: {
      enabled: true
      unauthenticatedRoutesAction: 'RedirectToLoginPage'
      registration: {
        openIdIssuer: 'https://login.microsoftonline.com/${entraTenantId}/v2.0'
        clientId: entraClientId
        clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
      }
    }
  }
}
```
