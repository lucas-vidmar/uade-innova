# KQL Correlation Queries

These KQL examples show how to join request traces with custom telemetry events.

## Native Approach (operation_Id)

App Insights automatically attaches `operation_Id` to both `requests` and `customEvents` when the SDK correlation context is active. This is the most reliable join:

```kusto
customEvents
| where name == "RAGInteraction"
| where timestamp between(startofday(now()) .. now())
| project timestamp,
            operation_Id,
            userId = tostring(customDimensions.userId),
            subjectId = tostring(customDimensions.subjectId),
            totalTokens = toint(customMeasurements.totalTokens),
            durationMs = toint(customMeasurements.durationMs),
            sourceMix = tostring(customDimensions.sourceMix)
| join kind=leftouter (
    requests
    | project operation_Id,
              url,
              duration,
              resultCode
) on operation_Id
| order by timestamp desc
```

## Custom correlationId Approach

When the SDK context is not available (e.g., async blob-triggered pipelines), join on the custom `correlationId` field emitted by each telemetry event:

```kusto
customEvents
| where name == "IngestionInteraction"
| where isnotempty(tostring(customDimensions.correlationId))
| where timestamp between(startofday(now()) .. now())
| project timestamp,
            correlationId = tostring(customDimensions.correlationId),
            materialId = tostring(customDimensions.materialId),
            materialType = tostring(customDimensions.materialType),
            status = tostring(customDimensions.status),
            durationMs = toint(customMeasurements.durationMs)
```

## Trace Events from a Specific Correlation

```kusto
let targetCorrelationId = "your-correlation-id-here";
customEvents
| where customDimensions.correlationId == targetCorrelationId
| project timestamp,
            eventName = name,
            userId = tostring(customDimensions.userId),
            subjectId = tostring(customDimensions.subjectId),
            details = strcat(
                iff(isnotempty(tostring(customDimensions.sourceMix)), strcat("sourceMix: ", tostring(customDimensions.sourceMix)), ""),
                iff(isnotempty(tostring(customDimensions.materialId)), strcat("materialId: ", tostring(customDimensions.materialId)), ""),
                iff(isnotempty(tostring(customDimensions.status)), strcat("status: ", tostring(customDimensions.status)), "")
            ),
            durationMs = toint(customMeasurements.durationMs)
| order by timestamp asc
```

## RAG Errors (Streaming Failures)

Find RAG interactions that did not complete successfully — streaming errors never emit `RAGInteraction`, so check for incomplete sessions:

```kusto
customEvents
| where name == "RAGInteraction"
| where isnotempty(tostring(customDimensions.correlationId))
| where timestamp > ago(24h)
| project timestamp,
            correlationId = tostring(customDimensions.correlationId),
            userId = tostring(customDimensions.userId),
            durationMs = toint(customMeasurements.durationMs),
            totalTokens = toint(customMeasurements.totalTokens)
| where totalTokens == 0 and durationMs > 1000
| order by timestamp desc
```

## Polling Efficiency (Processing Notifications)

Monitor material-status endpoint adoption and reliability. High `classes_fallback` ratio indicates the batch endpoint is not meeting polling needs.

```kusto
// Weekly polling efficiency summary
customEvents
| where name == "PollingEvent"
| where timestamp > ago(7d)
| summarize
    TotalEvents = count(),
    // Endpoint usage breakdown
    BatchSuccess = countif(customDimensions.eventType == "material_status_batch_success"),
    BatchGetSuccess = countif(customDimensions.eventType == "material_status_batch_get_success"),
    PerItemFallback = countif(customDimensions.eventType == "per_item_fallback"),
    ClassesFallback = countif(customDimensions.eventType == "classes_fallback"),
    PollingErrors = countif(customDimensions.eventType == "polling_error"),
    // Latency metrics
    AvgLatencyMs = avg(todouble(customMeasurements.latencyMs)),
    P95LatencyMs = percentile(todouble(customMeasurements.latencyMs), 95),
    // Material volume
    TotalMaterials = sum(todouble(customMeasurements.materialCount))
| extend
    MaterialStatusPct = round((BatchSuccess + BatchGetSuccess) * 100.0 / TotalEvents, 1),
    ClassesFallbackPct = round(ClassesFallback * 100.0 / TotalEvents, 1),
    ErrorPct = round(PollingErrors * 100.0 / TotalEvents, 1)
| project
    TotalEvents,
    MaterialStatusPct,
    ClassesFallbackPct,
    ErrorPct,
    PerItemFallback,
    AvgLatencyMs,
    P95LatencyMs,
    TotalMaterials
```

```kusto
// Per-subject breakdown for weekly review
customEvents
| where name == "PollingEvent"
| where timestamp > ago(7d)
| summarize
    Events = count(),
    BatchSuccess = countif(customDimensions.eventType == "material_status_batch_success"),
    ClassesFallback = countif(customDimensions.eventType == "classes_fallback"),
    Errors = countif(customDimensions.eventType == "polling_error"),
    AvgLatencyMs = avg(todouble(customMeasurements.latencyMs))
    by subjectId = tostring(customDimensions.subjectId)
| extend FallbackPct = round(ClassesFallback * 100.0 / Events, 1)
| order by Events desc
```

## Ingestion Failures

```kusto
customEvents
| where name == "IngestionInteraction"
| where customDimensions.status == "error"
| where timestamp > ago(7d)
| project timestamp,
            correlationId = tostring(customDimensions.correlationId),
            materialId = tostring(customDimensions.materialId),
            fileName = tostring(customDimensions.fileName),
            materialType = tostring(customDimensions.materialType),
            durationMs = toint(customMeasurements.durationMs)
```
