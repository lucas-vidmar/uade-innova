---
description: Standard process for implementing, testing, and expanding on GitHub backlog items.
---

## Steps
1. **Analyze Requirements**: Read the provided GitHub issue/story carefully. Identify all edge cases and technical constraints.
2. **Implementation Plan**: Generate an Implementation Plan artifact before writing any code. 
3. **Execute Implementation**: Apply the code changes based on the plan, following the project's coding standards.
4. **Verification**: Run existing tests and create new unit/integration tests for the new functionality. Verify all tests pass. At least one of the tests should be using Chrome to navigate to webpage and verify usability of the implemented feature.
5. **Commit Changes**: Use the `run_command` tool to commit your changes (`git add . ; git commit -m "..."`). Ensure the commit message STRICTLY follows the project's conventional commit pattern matching previous commits (e.g., `feat(component): [description] #[issue_number]` or `fix(component): [description] #[issue_number]`). The issue ID must always be appended at the end of the commit message.
6. **Backlog Refinement**: Identify if the implementation uncovers any new requirements or edge cases that should be captured as new user stories. If so, list them clearly.
7. **Final Walkthrough**: Produce a Walkthrough artifact summarizing the changes and verification results.

Always abide by the documentation standards set in the rules.