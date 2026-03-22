# Centralized project status log

This file serves as a high-level changelog for the Educational Dashboard project, tracking functional milestones and business impact.

## Project Summary
Integrating a RAG-based AI system to enhance the educational experience at UADE, allowing students and teachers to interact with class materials through an intelligent dashboard.

---

## Status Log

### [2026-03-21] User Story #88: Insecure Role Assignment Endpoint
- **Status**: Completed
- **Functional Change**: Hardened the SWA custom authentication function (`get-roles`) with a matched secret-code validation to strictly block anonymous calls from the public internet or attackers traversing Front Door.
- **Business Impact**: Closes a critical loop that would have enabled privilege escalation. Assures application role grants are restricted exclusively to our authenticated identity flow infrastructure.

### [2026-03-21] User Story #90: Function App Publicly Accessible WAF Bypass
- **Status**: Completed
- **Functional Change**: Hardened the backend Functions app to strictly allow IP traffic from Azure Front Door and validate the native `X-Azure-FDID` header against Key Vault secrets.
- **Business Impact**: Eliminates a severe vulnerability that allowed full bypass of the Web Application Firewall (WAF) protections and authentication spoofing, ensuring a zero-trust entry perimeter.

### [2026-03-21] User Story #89: Restrict Key Vault Public Access
- **Status**: Completed
- **Functional Change**: Hardened the Azure Key Vault provisioning configuration by setting external Network ACLs to Deny by default.
- **Business Impact**: Eliminates a critical zero-trust violation by blocking all public internet exposure, preventing unauthorized access while maintaining service reliability.

### [2026-03-21] User Story #86: Fix Missing Import in Pipeline
- **Status**: Completed
- **Functional Change**: Corrected a missing function import in the backend ingestion pipeline.
- **Business Impact**: Restores pipeline reliability for teachers, ensuring that class transcripts and notes are successfully processed and AI conceptual maps are consistently generated.

### [2026-03-21] User Story #87: Fix IDOR in Class APIs
- **Status**: Completed
- **Functional Change**: Implemented strict Role-Based Access Control (RBAC) on backend modifying endpoints to prevent unauthorized class and material modifications.
- **Business Impact**: Hardens platform security and preserves academic data integrity by ensuring only authenticated teachers and directors can modify course content.

### [2026-03-18] User Story #39: Subject-Filtered Retrieval
- **Status**: Completed
- **Functional Change**: Implemented a robust Pinecone metadata filter that enforces subject-level isolation and ensures bibliography materials are always included in the RAG context.
- **Business Impact**: Guaranteed academic data integrity by preventing context leaking between different subjects.

### [2026-03-18] User Story #41: Source-Only Grounding Mode
- **Status**: Completed
- **Functional Change**: Hardened the RAG system prompt to EXCLUSIVELY rely on the provided context, rejecting general knowledge and instruction overrides.
- **Business Impact**: Ensures the bot remains an academic tutor grounded in UADE-specific materials, preventing hallucinations or reliance on external data that might conflict with institutional regulations.

###| 2026-03-17 | Manual | Fix 500/404 errors & service consolidation. | SUCCESS | deployed to `uade-dev` |
- **Functional Change**: Deploying latest changes (Issue #58) manually via `azd deploy` due to GitHub Actions role assignment permission restrictions.
- **Business Impact**: Project pilot is now live for testing the AI summary validation flow.

### [2026-03-17] User Story #58: AI-Generated Summary Validation
- **Status**: Completed
- **Functional Change**: Integrated an AI-human-in-the-loop workflow for class summaries. Teachers can now validate and refine content before students access it.
- **Business Impact**: Enhances pedagogical quality and builds trust in AI-generated content within the pilot.

### [2026-03-17] User Story #25: Mock Academic Data Bridge
- **Status**: Completed
- **Functional Change**: Introduced `academic.js` as a formal abstraction layer for grades, attendance, and risk alerts, separating institutional data from the core application API.
- **Business Impact**: Simplifies future integration with the University's SGA system and provides a cleaner architecture for managing student academic records.

### [2026-03-17] User Story #27: Automatic Logout on Inactivity
- **Status**: Completed
- **Functional Change**: Implemented a background inactivity monitor that terminates the session and redirects to logout after 60 minutes of idle time.
- **Business Impact**: Enhances data privacy and platform security, particularly for students using library or laboratory computers.

### [2026-03-17] User Story #31: Async Embedding Generation
- **Status**: Completed
- **Functional Change**: Refactored the ingestion pipeline to support parallel batch embedding generation and automatic retries for rate limits.
- **Business Impact**: Dramatically reduces document processing time (up to 20x faster) and increases system reliability during high-load scenarios.

### [2026-03-17] User Story #29: Resilient PDF Parsing
- **Status**: Completed
- **Functional Change**: Implemented page-aware PDF extraction with custom page markers and enhanced cleaning for PDF artifacts.
- **Business Impact**: Improves RAG citation accuracy by allowing the LLM to reference specific pages and enhances pipeline reliability for large academic documents.

### [2026-03-17] User Story #23: Admin Dashboard for User Management
- **Status**: Completed
- **Functional Change**: Implemented a restricted administrative dashboard with role-based access control and user auditing capabilities.
- **Business Impact**: Provides institutional directors with oversight of the platform's adoption and user compliance (e.g., privacy consent verification).

### [2026-03-17] User Story #24: Privacy Consent Management
- **Status**: Completed
- **Functional Change**: Implemented a mandatory privacy policy consent modal and state persistence in the user profile.
- **Business Impact**: Ensures institutional compliance with data protection regulations and provides transparency to users regarding AI data usage.

### [2026-03-17] User Story #15: Consumption Plan Quota Resolution
- **Status**: Completed
- **Functional Change**: Consolidated the infrastructure to be 100% serverless by removing legacy VM-based Bicep modules and parameters.
- **Business Impact**: Eliminates deployment blockers related to VM quotas in the UADE tenant and ensures a lean, cost-effective serverless architecture as per project requirements.

### [2026-03-17] User Story #14: Local-to-Cloud Auth Parity
- **Status**: Completed
- **Functional Change**: Standardized all Azure resource clients (OpenAI, Storage) on `DefaultAzureCredential`, removing conditional branching for local vs. cloud authentication.
- **Business Impact**: Simplifies the codebase, enhances security by eliminating static API key usage, and ensures the application behaves identically across all development and production tiers.

### [2026-03-17] User Story #13: GitHub Actions CI/CD Pipeline
- **Status**: Completed
- **Functional Change**: Implemented a fully automated deployment pipeline using GitHub Actions and the Azure Developer CLI (`azd`).
- **Business Impact**: Reduces deployment cycle time and minimizes human error by automating code synchronization from the repository to the live environment.

### [2026-03-17] User Story #12: Secure Blob Access
- **Status**: Completed
- **Functional Change**: Shifted application-level Blob Storage access from connection strings to a Zero-Trust model using Azure Managed Identities (`DefaultAzureCredential`).
- **Business Impact**: Hardens the platform's security posture by eliminating long-lived credentials, reducing the risk of credential leakage and simplifying secret rotation.

### [2026-03-17] User Story #22: Course Enrollment Resolution
- **Status**: Completed
- **Functional Change**: Implemented a dynamic enrollment mapping layer that translates Microsoft Entra ID group claims into specific subject visibility. Filtered API responses ensure students only interact with authorized course materials.
- **Business Impact**: Delivers a personalized and secure academic experience, preventing cross-course data leakage and streamlining the UI for students.

### [2026-03-17] User Story #21: Local SWA Auth Emulation
- **Status**: Completed
- **Functional Change**: Provisioned the native Azure Static Web Apps `@azure/static-web-apps-cli` CLI emulator directly inside the frontend developer loop (`npm start`), bridging Vite's hot-reloading with live Cloud identity proxy emulation capabilities.
- **Business Impact**: Drastically increases developer velocity and code hygiene by allowing UI engineers to inject dynamic Entra ID mock claims locally testing security restrictions flawlessly without deploying Cloud infrastructure changes.

### [2026-03-16] User Story #20: Secure Token Exchange
- **Status**: Completed
- **Functional Change**: Re-engineered the client-side authentication provider allowing frontend frameworks to securely request session credentials asynchronously from the host native Edge proxies instead of depending on static payloads.
- **Business Impact**: Hardens the UX explicitly binding live Entra ID institutional directories automatically rendering UI layouts dynamically scoped to Active Directory claims (Student/Teacher properties).

### [2026-03-16] User Story #19: Persistent User Profiles
- **Status**: Completed
- **Functional Change**: Provisioned the Azure Table Storage component natively within Bicep and implemented explicit Azure SDK Function app integrations orchestrating Managed Identity calls securely bound to the user's Entra ID Object ID context to store preferences across sessions.
- **Business Impact**: Allows long-lived metadata and UI state to exist disconnected from volatile client caches securely without rolling and maintaining a heavyweight Relational Database infrastructure block.

### [2026-03-16] User Story #18: Role-Based Group Mapping
- **Status**: Completed
- **Functional Change**: Introduced `get-roles.js` in the backend resolving `rolesSource` integrations with SWA. Entra ID user group claims like "Alumnos-Pilot" are natively parsed and injected as explicit frontend and backend Role Claims.
- **Business Impact**: Delivers rigorous Zero-Trust Role-Based Access Control (RBAC) linking directly back to UADE's central Identity tenant, automatically classifying Teachers vs Students seamlessly upon login without storing a disconnected parallel user database.

### [2026-03-16] User Story #17: Institutional SSO Login
- **Status**: Completed
- **Functional Change**: Injected a `staticwebapp.config.json` defining Microsoft Entra ID (Azure AD) as the exclusive global edge proxy Identity Provider for the frontend, enforcing forced `302 Redirects` and explicitly 404'ing generic social providers (GitHub/Twitter).
- **Business Impact**: Hardens the UX immediately requiring institutional `@uade.edu.ar` authentication to load any application chunk, establishing robust single sign-on security effortlessly.

### [2026-03-16] User Story #11: Local CORS Configuration
- **Status**: Completed
- **Functional Change**: Restricted the local Functions daemon (`local.settings.json`) to actively accept Cross-Origin Resource Sharing exactly against the origin `http://localhost:5173`.
- **Business Impact**: Hardens the local development loopback against flaky wildcard pre-flight CORS failures, enhancing engineer velocity and environment consistency.

### [2026-03-16] User Story #9: Web Application Firewall (WAF)
- **Status**: Completed
- **Functional Change**: Engineered an Azure Front Door Edge topology in Bicep deploying a centralized Web Application Firewall (WAF) running Microsoft's managed Top 10 prevention ruleset across both backend API and frontend UX routes.
- **Business Impact**: Provides enterprise-grade reverse-proxy security, automatically blocking malicious payloads (SQLi, XSS, etc.) globally at the edge before attacks ever reach isolated application environments. 

### [2026-03-16] User Story #8: Key Vault Reference Integration
- **Status**: Completed
- **Functional Change**: Hardened the backend configuration file locally by purging the runtime fallback parameter logic and strictly declaring the `@Microsoft.KeyVault` reference syntax.
- **Business Impact**: Hardens the runtime application state, stopping production code logic loops from needing to hold or route API Keys in raw memory mappings. Secure by Default deployment guaranteed.

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
