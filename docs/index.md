# Project Documentation Index — Dashboard Educativo UADE Innova

## Project Overview

- **Type:** Multi-part monorepo con 3 partes
- **Primary Language:** JavaScript (Node.js 20)
- **Architecture:** Serverless RAG (Retrieval-Augmented Generation)

## Quick Reference

### Frontend (frontend/)
- **Type:** Web SPA (Vanilla JS, Vite 5)
- **Entry Point:** `frontend/index.html` → `frontend/src/main.js`
- **Architecture Pattern:** Hash-based router + Componentes funcionales
- **Hosting:** Azure Static Web Apps (Free Tier)

### Backend (backend/)
- **Type:** Backend Serverless (Azure Functions Consumption Y1)
- **Tech Stack:** Node.js 20, OpenAI, DeepSeek V4 Flash, Pinecone
- **Entry Point:** `backend/src/index.js`
- **Architecture Pattern:** Serverless microservicios + RAG pipeline

### Infrastructure (infra/)
- **Type:** Infrastructure as Code (Bicep)
- **Root:** `infra/main.bicep`
- **Architecture Pattern:** Módulos Bicep con azd orchestration

## Generated Documentation

- [Project Overview](./project-overview.md)
- [Architecture — Frontend](./architecture-frontend.md)
- [Architecture — Backend](./architecture-backend.md)
- [Architecture — Infrastructure](./architecture-infra.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Component Inventory — Frontend](./component-inventory-frontend.md)
- [Development Guide](./development-guide.md)
- [Deployment Guide](./deployment-guide.md)
- [API Contracts — Backend](./api-contracts-backend.md)
- [Integration Architecture](./integration-architecture.md)
- [Data Models — Backend](./data-models-backend.md) _(To be generated)_
- [Component Inventory — Backend](./component-inventory-backend.md) _(To be generated)_

## Existing Documentation

- [Documento de Alcance Funcional](./Documento%20de%20Alcance%20Funcional.md) — Functional scope specification
- [Architecture Review](./architecture-review.md) — Architecture decisions and review
- [API Error Contracts](./api-error-contracts.md) — Standardized error response contracts
- [Correlation Middleware](./correlation-middleware.md) — Distributed tracing documentation
- [KQL Correlation Queries](./kql-correlation-queries.md) — App Insights KQL queries
- [Graph API Credentials](./graph-api-credentials.md) — Microsoft Graph configuration
- [Reindex Vector ClassId Migration](./reindex-vector-classid-migration.md) — Vector index migration plan
- [Secrets Inventory (Key Vault / Managed Identity)](./secrets-inventory.md) — Secretos y clasificación Key Vault vs Managed Identity
- [Azure Cost Management Setup](./azure-cost-setup.md) — Configuración de SP y variables para Cost Management API
- [Project Status](./project-status.md) — Current project status
- [Notifications API (OpenAPI)](./notifications-api.json) — Notifications API specification
- [SGA OpenAPI](./sga-openapi.json) — SGA API specification
- [Dashboard Educativo — Context Document](./Dashboard%20educativo%20inteligente%20con%20IA%20integrando%20transcripts%20de%20Microsoft%20Stream.txt) — Project vision document

## Getting Started

### Prerequisites
- Node.js >= 20
- Azure Functions Core Tools 4.x
- Azure Developer CLI (azd)
- Azurite (local storage emulator)

### Quick Start
```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend (separate terminal)
cd backend && npm install && npm start

# Storage emulator
cd backend && npm run azurite
```

### Environment Variables
Copy `.env.local.template` to `.env.local` and configure:
- `AZURE_OPENAI_ENDPOINT` — Azure OpenAI endpoint
- `AZURE_OPENAI_API_KEY` — OpenAI API key
- `PINECONE_HOST` — Pinecone host URL
- `PINECONE_API_KEY` — Pinecone API key
- `AI_FOUNDRY_DEEPSEEK_ENDPOINT` — DeepSeek endpoint
- `AI_FOUNDRY_DEEPSEEK_KEY` — DeepSeek API key

### Testing
```bash
cd backend && npm test        # Unit tests
cd frontend && npm run test:e2e  # E2E tests
```

### Deployment
```bash
azd provision     # Create Azure resources
azd deploy        # Deploy frontend + backend
```
