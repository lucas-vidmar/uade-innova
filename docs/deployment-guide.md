# Guía de Despliegue

## Infraestructura

Todos los recursos se despliegan en `RG_UADE_INNOVA_DEV` usando Bicep + azd.

### Provisionar Infraestructura
```bash
azd provision
```
Esto crea:
- Azure Functions (Consumption Y1, Node 20)
- Azure Static Web Apps (Free Tier)
- Azure Storage (Standard_LRS)
- Azure OpenAI (S0)
- Application Insights
- Key Vault (Standard)

### Desplegar Aplicación
```bash
azd deploy
```
Esto ejecuta:
1. `prepackage` hook: build frontend con variables de entorno
2. Deploy `frontend/dist` → Static Web Apps
3. Deploy `backend/` → Azure Functions

## CI/CD

### Pipeline de Producción (branch `main`)
```
[Push to main] → Secrets Check → Backend Tests → Frontend E2E →
→ Deploy Frontend (SWA token) → Deploy Backend (publish profile) →
→ Smoke Test (curl /api/hello + SWA URL)
```

### Pipeline de Staging (branch `staging`)
```
[Push to staging] → Secrets Check → Backend Tests → Frontend E2E →
→ Deploy Frontend (SWA token) → Deploy Backend (azd + OIDC) →
→ Health Check → Auto PR staging → main
```

## Variables de Entorno Requeridas

### Backend (App Settings en Azure Functions)
| Variable | Fuente |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | azd output |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | text-embedding-3-small |
| `AI_FOUNDRY_DEEPSEEK_ENDPOINT` | Azure AI Foundry |
| `AI_FOUNDRY_DEEPSEEK_KEY` | Key Vault reference |
| `PINECONE_HOST` | Pinecone console |
| `PINECONE_API_KEY` | Key Vault reference |
| `AZURE_STORAGE_CONNECTION_STRING` | azd output |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | azd output |
| `FRONT_DOOR_ID` | Azure Front Door (si aplica) |

### Frontend (Static Web Apps App Settings)
| Variable | Fuente |
|---|---|
| `VITE_API_BASE_URL` | Functions URL |
| `VITE_AZURE_OPENAI_ENDPOINT` | OpenAI endpoint |
| `VITE_AZURE_OPENAI_CHAT_DEPLOYMENT` | Chat model name |

## Deployments Especiales

### Actualizar solo Frontend
```bash
cd frontend && npm run build
azd deploy frontend
```

### Actualizar solo Backend
```bash
azd deploy backend
```

## Troubleshooting

| Problema | Comando |
|---|---|
| Ver logs | `az functionapp logs tail -n func-dashboard-ingest-{token} -g RG_UADE_INNOVA_DEV` |
| Listar recursos | `az resource list --resource-group RG_UADE_INNOVA_DEV --output table` |
| Obtener deployment token SWA | `az staticwebapp secrets list --name stapp-dashboard-{token} -g RG_UADE_INNOVA_DEV` |
| Tests locales | `cd backend && npm test` |

## Destruir Entorno
```bash
azd down
```
⚠️ Esto elimina todos los recursos de Azure en el resource group.
