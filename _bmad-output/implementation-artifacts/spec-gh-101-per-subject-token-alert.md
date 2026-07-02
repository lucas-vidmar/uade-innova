---
title: 'Per-Subject Anomalous Token Usage Alerts'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: '638f3b10cfca10c1c9055de95df65da102d4b11a'
context:
  - 'infra/modules/anomalous-usage-alert.bicep'
  - 'backend/src/services/telemetry.js'
  - 'docs/kql-correlation-queries.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The current anomalous token usage alert (`alert-anomalous-token-usage`) only aggregates per-user across all subjects. A single user with moderate token usage spread across multiple subjects cannot trigger the alert (threshold is 1M tokens globally), while a subject-heavy user can exceed a reasonable per-subject budget without detection. Administrators lack visibility into which subject is driving anomalous consumption, making FinOps remediation impossible.

**Approach:** Add a second scheduled query alert rule in the same module that groups by both `subjectId` and `userId` over 24h with a lower per-subject threshold. Enrich both the existing and new alert payloads with structured dimensions (`subjectId`, `userId`, `tokens24h`). Keep the global per-user alert unchanged.

## Boundaries & Constraints

**Always:**
- Must not modify or remove the existing global per-user alert rule (`alert-anomalous-token-usage`)
- All new alert rules must reference `subjectId` from the telemetry event's `customDimensions` (or `Properties` for AppEvents)
- Alert payload must include `subjectId`, `userId`, and `tokens24h` as searchable dimensions
- The per-subject threshold must be expressed as a configurable parameter (default 500,000 tokens)
- The new alert rule must use the same action group (`ag-token-usage-{token}`) for email notification
- Bicep tests in `backend/src/services/anomalous-usage-alert-iac.test.js` must be updated

**Ask First:**
- Setting the per-subject token threshold value (default proposed: 500,000 tokens per subject/user over 24h)

**Never:**
- Do not modify the `rag-query` or `telemetry.js` to add `subjectId` — it is already present in `RAGInteraction` and `IngestionInteraction` custom events
- Do not change the evaluation frequency (PT5M) or window size (PT24H) of the existing alert

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal usage | $subjectId + $userId with 50K tokens in 24h | No alert fires | N/A |
| Per-subject anomaly | $subjectId + $userId with 600K tokens in 24h | Per-subject alert fires with subjectId, userId, tokens24h | N/A |
| Global anomaly | $userId with 1.2M tokens across subjects in 24h | Global alert fires (no regression) | N/A |
| Both anomalies | $subjectId + $userId with 600K AND 1.2M total | Both alerts fire independently | N/A |
| No subjectId in event | Event missing `subjectId` | Event excluded from per-subject query; still counted in global | Query filters `isnotempty(subjectId)` |

</frozen-after-approval>

## Code Map

- `infra/modules/anomalous-usage-alert.bicep` -- Add second scheduled query rule for per-subject grouping; enrich both alert payloads
- `backend/src/services/anomalous-usage-alert-iac.test.js` -- Update tests to cover the new rule

## Tasks & Acceptance

**Execution:**
- [x] `infra/modules/anomalous-usage-alert.bicep` -- Add `subjectTokenThreshold` parameter (default 500000), add second `Microsoft.Insights/scheduledQueryRules` resource for per-subject aggregation, enrich customProperties on both rules with `subjectId` + `userId` + `tokens24h`
- [x] `backend/src/services/anomalous-usage-alert-iac.test.js` -- Add test case verifying the per-subject rule is defined, has correct KQL query structure, lower threshold, and references `customDimensions.subjectId`

**Acceptance Criteria:**
- Given the per-subject alert rule is deployed, when a user exceeds 500K tokens in a single subject over 24h, then an alert fires with `subjectId`, `userId`, and `tokens24h` in the payload.
- Given both alert rules are deployed, when a user exceeds 500K tokens in one subject but < 1M total, then only the per-subject alert fires (no regression on global threshold).
- Given no `subjectId` is present in a telemetry event, when the per-subject query runs, then the event is excluded from per-subject aggregation but still counted in the global alert.

## Design Notes

The per-subject KQL query follows the same structure as the existing global rule but adds `subjectId` to the `summarize by` clause and applies a `where isnotempty(subjectId)` filter:

```kusto
let ragFromCustomEvents =
customEvents
| where name == "RAGInteraction"
| project timestamp, userId=tostring(customDimensions.userId), subjectId=tostring(customDimensions.subjectId), totalTokens=todouble(customMeasurements.totalTokens);
let ragFromAppEvents =
AppEvents
| where Name == "RAGInteraction"
| project timestamp=TimeGenerated, userId=tostring(Properties.userId), subjectId=tostring(Properties.subjectId), totalTokens=todouble(Measurements.totalTokens);
union isfuzzy=true ragFromCustomEvents, ragFromAppEvents
| where timestamp >= ago(24h)
| where isnotempty(userId) and isnotempty(subjectId)
| summarize tokens24h = sum(coalesce(totalTokens, 0.0)) by userId, subjectId
| where tokens24h > {subjectTokenThreshold}
| project userId, subjectId, tokens24h
```

Both rules output `customProperties` so that the alert payload includes structured dimensions for incident correlation. The per-subject rule uses a separate `dimensions` configuration on the scheduled query rule resource to make `subjectId` and `userId` searchable in Azure Monitor.

The existing global rule gets its payload enriched with `userId` as a dimension (currently it only projects `userId` and `tokens24h` in the query result, but does not declare `dimensions` on the criteria — adding `dimensions` makes the alert resource-centric and searchable).

## Verification

**Commands:**
- `cd infra && az deployment group validate --resource-group RG_UADE_INNOVA_DEV --template-file main.bicep --parameters main.parameters.json` -- expected: passes validation without errors
- `npx jest backend/src/services/anomalous-usage-alert-iac.test.js` -- expected: all tests pass, including new per-subject rule test

**Manual checks (if no CLI):**
- After `azd deploy`, verify in Azure Portal: both alert rules visible under Monitor > Alerts > Alert rules
- Verify per-subject rule description contains "subjectId" and the subject token threshold
- Verify global rule description remains unchanged
