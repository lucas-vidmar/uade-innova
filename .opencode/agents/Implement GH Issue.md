---
description: Comprehensive standard process for implementing, testing, and expanding on GitHub backlog items for the UADE AI Educational Dashboard.
---

## **Pre-Implementation Phase**

1. **Analyze Requirements & Domain Logic**:  
   * Read the provided GitHub issue or user story carefully.  
   * Identify all edge cases (e.g., handling empty Stream transcripts, unauthorized student access, or Pinecone index timeouts).  
   * Map the requirement to the existing functional analysis (Hito 1).  
   * Identify technical constraints such as GPT-4o mini token limits (![][image1] context window) or Azure Function execution timeouts.  
2. **Generate Implementation Plan Artifact**:  
   * Before writing code, create a dedicated document or comment detailing the architectural approach.  
   * Include proposed changes to the RAG pipeline (chunking strategy or metadata filtering).  
   * Define any new environment variables required in the Azure App Service.  
   * List specific Azure resources affected (e.g., updates to Managed Identity permissions or new Application Insights custom events).

## **Technical Execution Phase**

3. **Execute Implementation & Coding Standards**:  
   * Apply code changes following the project's coding standards (e.g., Clean Architecture, modular Azure Functions).  
   * Ensure all logic related to Microsoft Graph API is abstracted to handle token expiration gracefully.  
   * If UI changes are made to the dashboard, ensure they are responsive and adhere to UADE's visual identity.  
   * Maintain a "Zero-Trust" approach: never hardcode secrets; use Azure Key Vault references or Managed Identities for service-to-service authentication.  
4. **Multi-Layer Verification (Local)**:  
   * **Unit/Integration Tests**: Run existing test suites and create new ones for the specific feature.  
   * **Performance Benchmarking**: For RAG-related features, verify that similarity search latency is within acceptable bounds (![][image2]).  
   * **Browser Usability**: Manually navigate the local version of the webpage. Verify the end-to-end flow, specifically focusing on authentication simulation and interactive elements like the RAG chat history or conceptual maps.

## **Deployment & Version Control**

5. **Commit Changes with Strict Governance**:  
   * Use the run_command tool to stage relevant files. Ensure you *only* stage changes produced by the current issue to keep the git history atomic.  
   * Follow the Conventional Commits pattern.  
   * **Format**: <type>(<scope>): <description> #<issue_number> (e.g., feat(rag): implement metadata filtering for specific materias #42).  
   * The issue ID is mandatory at the end of the message to ensure GitHub Project automation correctly links the activity.  
6. **Azure Deployment & Production Smoke Testing**:  
   * Redeploy to the UADE Azure environment using the Azure Developer CLI (azd deploy).  
   * **Environment Validation**: Verify that the production App Service has the correct configuration and that Managed Identities have the necessary roles (e.g., Cognitive Services User, Storage Blob Data Reader).  
   * **Cloud Walkthrough**: Test the live URL. Verify that the flow works with real-world latency and standard application authentication.  
   * **Telemetry Check**: Open the Application Insights dashboard to ensure no 5xx errors are being thrown during the new feature's execution. Iterate until the production environment is stable.

## **Post-Implementation & Refinement**

7. **Backlog Refinement & Future Scoping**:  
   * Identify if the implementation uncovered new technical debt or "nice-to-have" features (e.g., "The current RAG works, but we should add support for PowerPoint files in SharePoint next").  
   * Capture these by creating new issues in the GitHub Project board.  
   * **Metadata Requirement**: Every new issue must include:  
     * **Priority**: (High/Medium/Low) based on the quadmester timeline.  
     * **Size/Estimate**: (Story points or T-shirt sizes).  
     * **Context**: A link back to the current "solved" issue as the origin.  
8. **Final Walkthrough & Issue Closure**:  
   * Produce a summary report of the changes made.  
   * Include screenshots of the successful local and Azure verification steps.  
   * List any resolved technical constraints and provide a brief handover note for the UADE technical team (Diego or Fernando).  
   * **Close the Story**: Formally close the GitHub issue/user story and ensure the corresponding GitHub Project card is moved to the "Done" or "Completed" column.

Always abide by the documentation standards set in the project rules to ensure long-term maintainability for the university.