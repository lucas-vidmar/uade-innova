# Project Overview — Dashboard Educativo Inteligente (UADE Innova)

## Executive Summary

Transformación de la experiencia académica mediante IA generativa sobre materiales de clase (transcripciones, presentaciones, apuntes y bibliografía). Piloto con 65 alumnos y docentes en una materia. Meta de adopción: 60% de uso activo durante el cuatrimestre.

## Tech Stack Summary

| Componente | Tecnología | Plan |
|---|---|---|
| Frontend | Vanilla JS + Vite 5 | Azure Static Web Apps (Free) |
| Backend | Node.js 20 + Azure Functions | Consumption Y1 (Serverless) |
| Chat LLM | DeepSeek V4 Flash | Azure AI Foundry |
| Embeddings | text-embedding-3-small | Azure OpenAI (S0) |
| Vector DB | Pinecone Serverless | Standard tier |
| Storage | Azure Blob + Table Storage | Standard_LRS |
| Observability | Application Insights | Workspace-based |
| Secrets | Azure Key Vault | Standard |
| Auth | Microsoft Entra ID (SSO) | Via SWA EasyAuth |

## Architecture Type

**Multi-part monorepo**: 3 partes independientes
- **Frontend** (web): SPA con Vanilla JavaScript
- **Backend** (backend): Azure Functions serverless + RAG pipeline
- **Infrastructure** (infra): Bicep IaC

## Repository Structure

```
azure-educational-dashboard/    ← Monorepo root (azd)
├── frontend/                   ← SPA dashboard
├── backend/                    ← Azure Functions
├── infra/                      ← Bicep IaC
├── docs/                       ← Project knowledge
└── .github/workflows/          ← CI/CD
```

## Key Features

- **Chat RAG**: Consultas de alumnos con respuestas basadas en materiales de clase
- **Ingesta de Materiales**: Docentes suben transcripciones, presentaciones, apuntes y bibliografía
- **Pipeline Automático**: Parsing → chunking → embeddings → Pinecone
- **Resúmenes IA**: Generación automática de resúmenes y mapas conceptuales
- **Correcciones**: Sistema de corrección de respuestas y transcripciones
- **Intervenciones**: Detección temprana de alumnos en riesgo
- **Dashboard Director**: KPIs, métricas de uso, compliance
- **SAT Analytics**: Seguimiento de satisfacción de respuestas IA

## Architecture Pattern

**Serverless RAG (Retrieval-Augmented Generation)** con:
- Arquitectura serverless 100% (sin VMs)
- Pipeline de ingesta event-driven
- Retrieval híbrido con ranking ponderado
- A/B testing de prompts (shadow testing)
- Filtrado por metadatos (subjectId, classId)
- Streaming SSE para respuestas en tiempo real
