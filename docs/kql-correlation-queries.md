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

## Vector Dependency Correlation

When the SDK context is not available (e.g., dependency telemetry from non-HTTP pipelines), join vector search dependency events with RAG interactions using the custom `correlationId` field:

```kusto
// Join Pinecone dependency telemetry with RAG interactions by correlationId
dependencies
| where dependencyTypeName == "Pinecone"
| where isnotempty(tostring(customDimensions.correlationId))
| where timestamp between(startofday(now()) .. now())
| project timestamp,
            correlationId = tostring(customDimensions.correlationId),
            operation = name,
            target,
            dependencyDurationMs = duration,
            success,
            resultCode
| join kind=leftouter (
    customEvents
    | where name == "RAGInteraction"
    | project correlationId = tostring(customDimensions.correlationId),
              ragTimestamp = timestamp,
              userId = tostring(customDimensions.userId),
              subjectId = tostring(customDimensions.subjectId),
              sourceMix = tostring(customDimensions.sourceMix),
              ragDurationMs = toint(customMeasurements.durationMs),
              totalTokens = toint(customMeasurements.totalTokens)
) on correlationId
| order by timestamp desc
```

```kusto
// Full trace of a single request across all telemetry types
let targetCorrelationId = "your-correlation-id-here";
union
    customEvents
    | where customDimensions.correlationId == targetCorrelationId
    | extend eventType = "customEvent", eventName = name,
              durationMs = toint(customMeasurements.durationMs)
    | project timestamp, eventType, eventName, durationMs,
              details = strcat("userId: ", tostring(customDimensions.userId)),
              correlationId = tostring(customDimensions.correlationId),
              subjectId = tostring(customDimensions.subjectId),
              provider = "",
    dependencies
    | where dependencyTypeName == "Pinecone"
    | where tostring(customDimensions.correlationId) == targetCorrelationId
    | extend eventType = "dependency", eventName = name,
              durationMs = duration,
              details = strcat("target: ", target, " success: ", success)
    | project timestamp, eventType, eventName, durationMs, details,
              correlationId = tostring(customDimensions.correlationId),
              subjectId = "",
              provider = tostring(customDimensions.provider)
| order by timestamp asc
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

## RAG Latency Decomposition Analysis

The `RAGInteraction` event includes three latency measurements for root-cause analysis:

| Measurement | Type | Description | Present in |
|---|---|---|---|
| `durationMs` | `customMeasurements` | Full end-to-end wall-clock latency from handler start to response completion | Stream & Blocking |
| `networkSetupMs` | `customMeasurements` | Time spent before the LLM call: request parsing, auth, embedding, Pinecone search, context building | Stream & Blocking |
| `ttftMs` | `customMeasurements` | Time-to-first-token: from handler start until the first content token is emitted by the LLM | Stream only |

**Decomposition formula:** `durationMs ≈ networkSetupMs + (ttftMs - networkSetupMs) + postProcessingMs`

For blocking mode, `ttftMs` is absent and model inference time can be approximated as `durationMs - networkSetupMs`.

### Per-Interaction Latency Breakdown

```kusto
customEvents
| where name == "RAGInteraction"
| where timestamp between(startofday(now()) .. now())
| project timestamp,
          correlationId = tostring(customDimensions.correlationId),
          subjectId = tostring(customDimensions.subjectId),
          sourceMix = tostring(customDimensions.sourceMix),
          durationMs = toint(customMeasurements.durationMs),
          networkSetupMs = toint(customMeasurements.networkSetupMs),
          ttftMs = toint(customMeasurements.ttftMs),
          totalTokens = toint(customMeasurements.totalTokens)
| extend
    // Model response latency (diff between setup end and first token)
    modelResponseMs = ttftMs - networkSetupMs,
    // Inference-only time for blocking mode (approximate)
    inferenceMs = durationMs - networkSetupMs,
    // What % of total time was spent on setup/network vs model
    setupPct = round(networkSetupMs * 100.0 / durationMs, 1),
    modelPct = round((ttftMs - networkSetupMs) * 100.0 / ttftMs, 1)
| order by timestamp desc
```

### Bottleneck Detection — High Setup Latency

```kusto
// Find interactions where setup/network was >50% of total time (potential Pinecone or embedding bottleneck)
customEvents
| where name == "RAGInteraction"
| where timestamp > ago(24h)
| where isnotempty(todouble(customMeasurements.networkSetupMs))
| where todouble(customMeasurements.networkSetupMs) > 0
| project timestamp,
          correlationId = tostring(customDimensions.correlationId),
          subjectId = tostring(customDimensions.subjectId),
          sourceMix = tostring(customDimensions.sourceMix),
          durationMs = toint(customMeasurements.durationMs),
          networkSetupMs = toint(customMeasurements.networkSetupMs)
| extend setupPct = round(networkSetupMs * 100.0 / durationMs, 1)
| where setupPct > 50
| order by setupPct desc
```

### Bottleneck Detection — High TTFT (Model Slow)

```kusto
// Find interactions with slow model response (TTFT > 5s)
customEvents
| where name == "RAGInteraction"
| where timestamp > ago(24h)
| where isnotempty(todouble(customMeasurements.ttftMs))
| where todouble(customMeasurements.ttftMs) > 0
| project timestamp,
          correlationId = tostring(customDimensions.correlationId),
          subjectId = tostring(customDimensions.subjectId),
          durationMs = toint(customMeasurements.durationMs),
          networkSetupMs = toint(customMeasurements.networkSetupMs),
          ttftMs = toint(customMeasurements.ttftMs),
          totalTokens = toint(customMeasurements.totalTokens)
| extend modelResponseMs = ttftMs - networkSetupMs
| where modelResponseMs > 5000
| order by modelResponseMs desc
```

### Streaming vs Blocking Latency Comparison

```kusto
// Compare average latency profile between stream and blocking modes
customEvents
| where name == "RAGInteraction"
| where timestamp > ago(7d)
| summarize
    Count = count(),
    AvgDurationMs = avg(todouble(customMeasurements.durationMs)),
    P95DurationMs = percentile(todouble(customMeasurements.durationMs), 95),
    AvgNetworkSetupMs = avg(todouble(customMeasurements.networkSetupMs)),
    P95NetworkSetupMs = percentile(todouble(customMeasurements.networkSetupMs), 95),
    AvgTotalTokens = avg(todouble(customMeasurements.totalTokens)),
    // Only stream events have ttftMs
    AvgTTFTMs = avg(todouble(customMeasurements.ttftMs)),
    P95TTFTMs = percentile(todouble(customMeasurements.ttftMs), 95)
```

### Subject-Level Latency Profile

```kusto
// Latency profile grouped by subject for capacity planning
customEvents
| where name == "RAGInteraction"
| where timestamp > ago(7d)
| summarize
    Interactions = count(),
    AvgDurationMs = round(avg(todouble(customMeasurements.durationMs)), 1),
    AvgNetworkSetupMs = round(avg(todouble(customMeasurements.networkSetupMs)), 1),
    AvgTTFTMs = round(avg(todouble(customMeasurements.ttftMs)), 1),
    AvgTotalTokens = round(avg(todouble(customMeasurements.totalTokens)), 0)
    by subjectId = tostring(customDimensions.subjectId)
| extend setupPct = round(AvgNetworkSetupMs * 100.0 / AvgDurationMs, 1)
| order by AvgDurationMs desc
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
