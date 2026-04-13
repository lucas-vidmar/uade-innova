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

// turbo
5. **Commit Changes with Strict Governance**:  
   * Use the run_command tool to stage relevant files. Ensure you *only* stage changes produced by the current issue to keep the git history atomic.  
   * Follow the Conventional Commits pattern.  
   * **Format**: <type>(<scope>): <description> #<issue_number> (e.g., feat(rag): implement metadata filtering for specific materias #42).  
   * The issue ID is mandatory at the end of the message to ensure GitHub Project automation correctly links the activity.  

// turbo
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

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAaCAYAAADBuc72AAADAElEQVR4Xu2WW4hNURjH5+S4RQx1HDmXtc9FOac8nXhwy3jwMEopJUYp4mFeeEBkXiSXhmSmSBHilZRxK2OUXFKUGreGIdfyJoyimTl+39lrjWW1z8wo8bL/9W+t7/99a61vrf2tvXdNTYgQ/wee542Bta4+JDwfa1zdIJVKzce/U6iUqnf9GlH8C3Xcimw2O9ENYJ6ljP8Ey/CS6w8EgQUm3Ef7APZXG4h+AJ6BDcQfou2D7XIqVlgE7XQ6nT5JWwfXwleZTGa2FVNBMpnM4yszfrvrC4RMIhMyeYn2e1CickLoD/P5/ARLa5GFYLPR6K+Dx4yttSXwaalUGunoDTKedefa+rBQLVG0Jj3pUaOxwQU60XdW3HF4zdgCNlQrcWwyZus6tqdYLI6y9WGhWqLU1CySvIdvmdFyudwUnfwbo9HfqJNvNiWh/MffYWIM0Lphu7EphbHYdWxotB0XiGqJBkH5j1SSajUaiyWw34pOol1wG/07ottj2WRKj20SW/l1f4H2IjxsxwbiDxO9DT/Dgq1z+jm0LzoROfFT8Xh8nB2Dtlp88hahbcReD4t6zAk7NhA60cuu7oJJN+hkFjn6JLRbcAv9rbTf9OIy5wgTp/z67IX7iVsuWiwWG4+9meSnDUxYDTrRK65uQ/mvnQ9StwG+Nhbea2we+XS0u5Isj3alFfcCfoXv4cGgd+2gGCpRFp6Jv5NFZxhNLpC0iUQiia9f6u/XiIFbLyVSqWVdx2W4Q06P9j585r6+BoUkysJXXV2gL0CHnYhMLm8D6ZPAZPx9bqIC9POSmPTlZHWic7S9SWxJWj+BygWrClmUoB8MvIkZtX36VB7DR/A6vCFxtE/gORMnG0FvoRuxxnror+WS6ZgjsMecIP1G2Es3SruLjc8zY38Dznr4XPn1Io9I+JH5u0ztYO9W+ha7ZOI9Zi59qlKT3Z7/P9AKO5X1X6D8y3bW2PIhwH4J2yTe6P8C8r0vwFV8vRbbn10BG5ga8FKPSI07WogQIUKE+Ev4CQgm8Vs1XRQqAAAAAElFTkSuQmCC>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACoAAAAaCAYAAADBuc72AAACIklEQVR4Xu2UPWhTURTHE+rXJApSyOd7+SjUoBgIDgU/QydF0E3aQnEpiFDBoS5FENGh7ZBGhwySxS5F3FwEGyFSqJtgWrBupXUVKg4d2vi7fffK7SGBJDxB8P3gz33vnP857+TmvhcKBQT8xyQSiYuu6z5Wchznmsz/EzDYHHqFRhm0xLqL3nN9THr/CtFo9JSMSRjmCkN9zmazx63YPLEmmrG9vpNKpc7pHXrNAEdl3gbPtBoqmUxWTIz6S3rQTdvrG+zEZZq/RQucuTMy3wp85xnyEzW3TCyTyfTr4Tdsr4FcitwN/YywzLcjrIoorqldQWlap6BZ6Xdc7WpY5/cLVec4k6yKeOemR9GEaQctoFkWkoVd0z2102o6z0wkVZ8iT2vccNWzPH3K53BGMExhWWB+ZIr/QvX+iosyxg3eJ76EH8Xg8hneYWF769sE0hLYwTfn9+aDvVfRdnVuZU+iz+8vxjoXSC+k5gBoQ0z31EqCH9qelV9ihs/T8Qu9BE6P3fdujUD8C31P0VQ2LZ0x6WnGIxuOOd6aedPLdbIU+ezW1mlihUDisNsLcky+jb9Z9BO3w/Nsm1glhCm5S+IG1FIvF4tLQDvwnqFtFDbSke9RZ19Ab4+P6B6qae37EBXzrqt7EuoJmRcf7lr7k7xyQeYnj/Y3NVmKYZ8bHQHeIfXS8N71K7h0x12rVG/TI06zi+vvC9dEz7XPPgICAgADBb7fzisS5F69JAAAAAElFTkSuQmCC>