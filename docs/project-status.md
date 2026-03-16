# Centralized project status log

This file serves as a high-level changelog for the Educational Dashboard project, tracking functional milestones and business impact.

## Project Summary
Integrating a RAG-based AI system to enhance the educational experience at UADE, allowing students and teachers to interact with class materials through an intelligent dashboard.

---

## Status Log

### [2026-03-16] User Story #7: Pinecone Secret Encapsulation
- **Status**: Completed
- **Functional Change**: Upgraded the Bicep deployment templates to natively insert the `pineconeApiKey` into Azure Key Vault as a secret upon provisioning.
- **Business Impact**: Hardens the system against secret exposure and accelerates environment cloning by securely migrating configuration values out of manual portals and into automated IaC flows.

### [2026-03-16] User Story #6: Resource Group Scoped RBAC
- **Status**: Completed
- **Functional Change**: Modified the Role-Based Access Control configuration in Bicep so that roles (OpenAI, Storage, Key Vault) are scoped explicitly to their respective specific resources instead of inheriting across the entire Resource Group.
- **Business Impact**: Hardens the backend authorization layer by applying strict Least-Privilege inheritance ("This resource" scoping), preventing identity compromise risks radiating through the Resource Group environment.

### [2026-03-16] User Story #5: Zero-Trust Backend Auth
- **Status**: Completed
- **Functional Change**: Removed the Azure OpenAI API Key from the Bicep template's application settings. The backend now authenticates exclusively using a Managed Identity via `DefaultAzureCredential`.
- **Business Impact**: Fully eliminates secret-rotation overhead and enforces strict Zero-Trust security principles on the AI infrastructure.

### [2026-03-16] User Story #4: User-Assigned Managed Identity
- **Status**: Completed
- **Functional Change**: Abstracted the Function App's identity into a dedicated User-Assigned Managed Identity securely provisioned via Bicep.
- **Business Impact**: Improved security lifecycle management by decoupling access rights from the Function App instance, ensuring robust Zero-Trust policies.

### [2026-03-16] User Story #3: Bicep Parameterization for Environments
- **Status**: Completed
- **Functional Change**: Fully parameterized Bicep infrastructure templates to decouple environment names, regions, and naming conventions.
- **Business Impact**: Lowered deployment risk and ensured completely isolated and reproducible dev/prod environments without manual template edits.

### [2026-03-13] User Story #30 & #34: Token-based Chunking & VTT Cleaning
- **Status**: Completed
- **Functional Change**: Switched to `js-tiktoken` for exact token-based splitting and added automated WebVTT metadata stripping.
- **Business Impact**: Optimized context window usage for LLM queries and improved answer quality by removing non-educational technical noise from transcripts.

### [2026-03-13] User Story #28: Triggered Ingestion
- **Status**: Completed
- **Functional Change**: Refactored the ingestion pipeline to use an Azure Blob Trigger for automated, asynchronous processing.
- **Business Impact**: Improved system responsiveness and scalability by decoupling file uploads from complex RAG processing steps.

### [2026-03-13] User Story #1: Teacher Material Upload
- **Status**: Completed
- **Functional Change**: Enabled teachers to upload PDF, PPTX, TXT, and DOCX materials up to 25MB directly to the platform.
- **Business Impact**: Provides the foundational data layer for the RAG system, ensuring that students have access to up-to-date and relevant class content.

### [2026-03-13] Development Infrastructure: Local Storage Emulation
- **Status**: Completed
- **Functional Change**: Integrated Azurite for local storage emulation.
- **Business Impact**: Accelerated development cycles and reduced Azure consumption costs by allowing full feature testing in local environments.

### [2026-03-08] UADE Branding Refresh
- **Status**: Completed
- **Functional Change**: Applied institutional color palette (Astronaut Blue) and typography (Montserrat).
- **Business Impact**: Strengthened institutional identity and improved user trust through a premium, branded interface.
