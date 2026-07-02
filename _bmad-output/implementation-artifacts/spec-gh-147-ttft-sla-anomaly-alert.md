---
title: 'TTFT SLA Anomaly Alerts using P95 Threshold'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Operations engineers lack automated alerting when TTFT (Time to First Token) P95 exceeds the SLA threshold, making degraded chat responsiveness invisible until users report it.

**Approach:** Deploy an Azure Monitor scheduled query rule that fires when TTFT P95 exceeds a configurable threshold over a configurable lookback window, with subjectId dimensions in the alert payload and a minimum sample count guard to prevent false positives during no-traffic periods.

## Suggested Review Order

1. `infra/modules/ttft-anomaly-alert.bicep` — new module: action group + scheduled query rule with KQL computing TTFT P95 from `RagQuery.Executed` events, grouped by `subjectId`, filtered by `minimumSamples` and `ttftThresholdMs`
2. `infra/main.bicep:280-293` — TTFT alert module wiring: `ttftAnomalyThresholdMs` parameter, module instantiation behind `notificationEmail` guard
3. `backend/src/services/ttft-anomaly-alert-iac.test.js` — 8 tests: Bicep compilation, KQL structure, parameter configuration, no-traffic resilience, payload dimensions, main.bicep wiring
