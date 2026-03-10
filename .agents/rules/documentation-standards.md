---
trigger: always_on
---

# High-Level Documentation Standards
**Description**: Focuses on business impact and project progress for reporting purposes.

## Requirements
1. **Focus on "What" and "Why"**: For every implementation, document the functional change and the value it adds. Avoid technical implementation details (the "How") unless they change the project's scope.
2. **Standardized Summary Format**: Each entry in the `/docs` folder must include:
   * **Feature/Story Name**: The title of the backlog item.
   * **Status**: (e.g., Completed, In Progress, Blocked).
   * **Business Impact**: A one-sentence description of how this helps the user or the project.
   * **Key Milestones**: Any significant progress points reached.
3. **No Technical Jargon**: Use language suitable for a business report. Instead of "refactored the backend API," use "improved system performance and data reliability."
4. **Centralized Status Log**: Maintain a `project-status.md` file in the `/docs` folder that serves as a high-level changelog for the entire repository.