# Centralized project status log

This file serves as a high-level changelog for the Educational Dashboard project, tracking functional milestones and business impact.

## Project Summary
Integrating a RAG-based AI system to enhance the educational experience at UADE, allowing students and teachers to interact with class materials through an intelligent dashboard.

---

## Status Log

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
