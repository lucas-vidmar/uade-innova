---
title: 'Storage Lifecycle Drift Detection Endpoint'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** FinOps/Platform engineers have no runtime way to detect when the deployed Azure Storage lifecycle management policy drifts from the IaC contract, risking unbounded storage costs or premature data deletion.

**Approach:** Add a GET endpoint (`/api/storage-lifecycle/compliance`) scoped to Directors that fetches the active Storage management policy via Azure SDK and compares it against the expected rule set defined in `infra/modules/storage.bicep`, returning `compliant: true/false` with per-field mismatch details.

## Suggested Review Order

1. `backend/src/services/storage-lifecycle.js` -- Core drift detection logic: fetches policy, compares rules, reports mismatches. Key concerns: correctness of comparison (`arraysMatchUnordered` for prefix lists), detection of unexpected rules, error handling for Azure API failures.
2. `backend/src/functions/storage-lifecycle.js` -- HTTP trigger wrapping the service. Auth (Director-only), error boundary wrapping all auth + business logic.
3. `backend/src/index.js` -- Registration import (1 line).
4. `infra/modules/functions.bicep` -- Two new env vars wired into the Function App: `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP_NAME`.
5. `backend/package.json` -- New dependency `@azure/arm-storage` for management-plane API access.
