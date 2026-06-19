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
