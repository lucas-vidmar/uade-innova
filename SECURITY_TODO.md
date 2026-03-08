# 🛡️ Security To-Do List (Post-MVP / Production)

This document tracks pending security implementations that are bypassed or mocked during the local development phase but are **critical** for production deployment.

## 🛑 Critical Tasks (High Priority)

### 2. API Authentication (Backend Functions)
- **Problem:** Functions are currently set to `authLevel: "anonymous"`.
- **Action:** 
  - Update `host.json` or individual functions to `authLevel: "function"` or `"user"`.
  - Integrate with **Microsoft Entra ID (OIDC)** to validate `Authorization: Bearer <token>` headers from the frontend.
  - Ensure the teacher's panel endpoints check for the `teacher` role in the JWT claims.

### 6. CORS Policy Restriction
- **Problem:** Backend is running with `--cors "*"` for easier local debugging.
- **Action:** 
  - Restrict Allowed Origins in the Azure Function App configuration to only the production URL of the Static Web App (e.g., `https://uade-innova.azurestaticapps.net`).
  - Disable `--cors "*"` in production settings.

## ⚠️ Important Tasks (Medium Priority)

### Secret Management (Zero-Trust)
- **Problem:** Local development relies on `local.settings.json` which can be accidentally committed.
- **Action:**
  - Standardize on **Azure Key Vault** for all API Keys (Pinecone, OpenAI).
  - Use **Managed Identities** for Azure Storage and OpenAI access to eliminate the need for connection strings or keys in the application code.

### Rate Limiting & FinOps
- **Problem:** No per-user limit on RAG queries or file uploads.
- **Action:**
  - Implement a rate-limiter in the RAG pipeline to prevent a single user from exhausting the token budget.
  - Implement a "quota" per teacher for file uploads.

### Prompt Monitoring
- **Problem:** Risks of "Jailbreaking" or non-academic use of the LLM.
- **Action:**
  - Enable **Azure OpenAI Content Safety** filters.
  - Log and audit "unanswered" queries to identify potential prompt injection attempts or gaps in knowledge materials.

---
*Created on 2026-03-08*
