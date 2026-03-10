# Infra Management Safety Rules

This rule is designed to prevent data loss and friction with Azure administrators by prohibiting the deletion of the primary Resource Group.

## Context
The primary Resource Group (`RG_UADE_INNOVA_DEV`) is strictly managed by UADE IT. Deleting or attempting to delete this group requires a manual request and approval process, causing significant project delays.

## Rules
- **NEVER** run `azd down` or any command that attempts to delete the Resource Group `RG_UADE_INNOVA_DEV`.
- If resources inside the group need to be cleaned up or reset, prefer manual deletion of individual resources within the group rather than deleting the group itself.
- If the user specifically asks to "reset" or "clean" the environment, warn them that the Resource Group itself must be preserved.
- When using `azd down`, always use configurations that avoid resource group deletion, or inform the user that this action is prohibited.
