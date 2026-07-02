---
title: 'Add dispatcher telemetry for post-class summary notifications'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The post-class summary dispatcher only uses `context.log()` / `context.error()` with no structured telemetry, making it impossible to monitor reliability, throughput, and failures in Application Insights.

**Approach:** Add a `trackDispatcherRun` event to the existing telemetry service and instrument the dispatcher to emit structured run metrics (processed subjects/classes, dispatched notifications, skipped items, errors, duration) with correlation-friendly dimensions queryable in Log Analytics.

</frozen-after-approval>

## Suggested Review Order

- New `DispatcherRun` custom event in telemetry service following `trackNotificationInteraction` conventions
  [`telemetry.js:221`](../../backend/src/services/telemetry.js#L221)

- Entry point — dispatcher collects and emits structured run metrics including subjectCount, classCount, dispatched, skipped, errors, durationMs
  [`post-class-summary-dispatcher.js:49`](../../backend/src/functions/post-class-summary-dispatcher.js#L49)

- Telemetry import wiring
  [`post-class-summary-dispatcher.js:4`](../../backend/src/functions/post-class-summary-dispatcher.js#L4)

- Unit tests covering happy path, skip, and error reporting with telemetry assertions
  [`post-class-summary-dispatcher.test.js:1`](../../backend/src/functions/post-class-summary-dispatcher.test.js#L1)

## Design Notes

**KQL query for operational monitoring:**

```kusto
customEvents
| where name == "DispatcherRun"
| where customDimensions.dispatcherName == "post-class-summary"
| project timestamp,
            subjectCount = toint(customMeasurements.subjectCount),
            classCount = toint(customMeasurements.classCount),
            dispatched = toint(customMeasurements.dispatched),
            skipped = toint(customMeasurements.skipped),
            errors = toint(customMeasurements.errors),
            durationMs = toint(customMeasurements.durationMs),
            errorDetails = customDimensions.errorDetails
| order by timestamp desc
| take 100
```

**Failure drill-down query:**

```kusto
customEvents
| where name == "DispatcherRun"
| where customMeasurements.errors > 0
| project timestamp,
            dispatcherName = customDimensions.dispatcherName,
            errors = toint(customMeasurements.errors),
            errorDetails = customDimensions.errorDetails
| order by timestamp desc
```
