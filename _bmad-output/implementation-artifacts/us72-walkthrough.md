# Walkthrough: User Story #72

**Feature/Story Name**: Anomalous Usage Alerts  
**Status**: Completed  
**Business Impact**: Enables proactive FinOps and security operations by detecting abnormal per-user token spikes before they become cost incidents.

## What Changed
- Added `infra/modules/anomalous-usage-alert.bicep` with:
  - Azure Monitor **Action Group** email receiver.
  - Azure Monitor **Scheduled Query Rule** that runs every 5 minutes over a 24-hour window.
  - KQL query over both `customEvents` and `AppEvents` for `RAGInteraction`, grouping by `userId` and alerting when `sum(totalTokens) > 1,000,000`.
- Wired the module in `infra/main.bicep`, conditionally created only when `notificationEmail` is configured.
- Added backend IaC contract tests in `backend/src/services/anomalous-usage-alert-iac.test.js`.
- Added admin visibility panel in `frontend/src/pages/admin/UserManagement.js` so directors can see the policy exists.
- Added a Chrome/Chromium Playwright usability test in `frontend/tests/anomalous-usage-alert.spec.js`.

## Verification Results
- **Backend tests**: Ran `npm test` in `backend` including the new IaC validation tests.
- **Frontend usability test (Chrome/Chromium)**: Ran `npx playwright test tests/anomalous-usage-alert.spec.js --project=chromium` and validated the admin panel renders the 1M/24h policy text.

## Backlog Refinement
- Add a second threshold (e.g., warning at 750k tokens/24h) to provide early intervention before critical alerts.
- Add optional Teams/Webhook action receivers for operations channels in addition to email.
