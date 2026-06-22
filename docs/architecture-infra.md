# Arquitectura — Infraestructura (Azure)

## Resumen Ejecutivo

Infraestructura 100% serverless definida como código con Bicep. Desplegada mediante Azure Developer CLI (`azd`) en el resource group `RG_UADE_INNOVA_DEV`. Sin VMs reservadas — todas las cargas de trabajo en planes Consumption/Free.

## Stack Tecnológico

| Categoría | Tecnología |
|---|---|
| IaC | Bicep (compilado a ARM) |
| Orquestación | Azure Developer CLI (azd) |
| CI/CD | GitHub Actions |
| Región Principal | Este de US |
| OpenAI Region | East US 2 |

## Recursos Azure

| Recurso | SKU/Tier | Propósito |
|---|---|---|
| Azure Functions | Consumption Y1 (Linux, Node 20) | Backend serverless |
| Azure Static Web Apps | Free Tier | Frontend hosting + CDN |
| Azure Storage | Standard\_LRS, Hot tier | Blobs, Tables, Queues |
| Azure OpenAI | S0 | Embeddings, TTS (fallback chat) |
| Application Insights | Workspace-based | Observabilidad |
| Log Analytics | PerGB2018 (30d retention) | Logs |
| Key Vault | Standard | Secrets management |

## Diagrama de Despliegue

```
                     GitHub Actions
                          │
              ┌───────────┴───────────┐
              │                       │
        Production (main)       Staging (staging)
              │                       │
     ┌────────┴────────┐    ┌────────┴────────┐
     │ SWA Token       │    │ OIDC (azd)      │
     │ Publish Profile │    │ SWA Token       │
     └────────┬────────┘    └────────┬────────┘
              │                       │
              └───────────┬───────────┘
                          │
              ┌───────────▼───────────┐
              │   Azure Resources     │
              │  RG_UADE_INNOVA_DEV   │
              └───────────────────────┘
```

## Módulos Bicep (10 activos)

| Módulo | Recursos Clave |
|---|---|
| `appinsights.bicep` | Log Analytics + Application Insights |
| `openai.bicep` | Cognitive Services + GPT-4.1-mini + text-embedding-3-small |
| `storage.bicep` | StorageV2 (7 contenedores, 11 tablas, 2 colas, lifecycle rules) |
| `keyvault.bicep` | Key Vault + 5 secrets (Pinecone API Key, Graph API, SWA Roles) |
| `functions.bicep` | Consumption Plan + Function App (Node 20, 40+ app settings) |
| `staticwebapp.bicep` | Static Web App Free + 5 app settings |
| `workbook.bicep` | Cost-per-Interaction dashboard (FinOps) |
| `latency-workbook.bicep` | Vector vs LLM Latency Percentiles |
| `anomalous-usage-alert.bicep` | 3 alert rules por token usage |
| `ttft-anomaly-alert.bicep` | 1 alert rule por TTFT P95 |

## CI/CD

### Producción (`main`)
1. Secrets check
2. Backend tests (`npm test`)
3. Frontend E2E tests (Playwright)
4. Deploy: SWA token + Functions publish profile
5. Smoke test (curl hello + static web app)

### Staging (`staging`)
1. Secrets check
2. Backend tests
3. Frontend E2E tests
4. Deploy: SWA token + `azd deploy backend` (OIDC)
5. Health check
6. Auto PR `staging → main`

## Seguridad de Red

- Key Vault: Default-deny network ACLs, Azure services bypass
- Storage: TLS 1.2, no public blob access
- Functions: HTTPS-only, CORS configurado
- Front Door: Comentado (subscriptión no registrada para Microsoft.Cdn)

## FinOps

- Budget: $100 USD/mes (comentado en Bicep)
- Alerts de anomalías por token usage
- Cost-per-Interaction Workbook
- Latency Percentiles Workbook
- Objetivo: < $1.50 USD/alumno/mes
