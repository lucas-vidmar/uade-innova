---
title: 'Vector Index Fullness Anomaly Alerts'
type: 'feature'
created: '2026-06-20'
status: 'done'
story_key: '7-2-vector-health-and-budget-alerts'
baseline_commit: dd34f84b5c0841602623c134da0e2302753a3f8f
context:
  - 'infra/modules/ttft-anomaly-alert.bicep'
  - 'infra/modules/anomalous-usage-alert.bicep'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The platform has no automated alerts when Pinecone index fullness approaches capacity or when daily document growth deviates from the baseline — we only discover issues when retrieval quality degrades or ingestion fails.

**Approach:** Add a timer-triggered monitor function that periodically fetches index stats, evaluates fullness and daily growth against configurable thresholds, and emits structured `VectorIndexAnomalyAlert` telemetry events with deduplication logic to prevent noisy repeats.

## Boundaries & Constraints

**Always:**
- Use existing `getIndexStats()` from `vector-store.js` — no new Pinecone API calls
- Use existing `telemetry.js` pattern for event emission
- Alert events must include `indexName`, `alertType`, `observedValue`, `threshold`, and `timestamp`
- Dedup window must be configurable per alert type to prevent alert storms
- All thresholds must be configurable via env vars with sensible defaults
- Use Blob Storage for dedup state persistence (timer functions can lose in-memory state)

**Ask First:**
- Whether to add an Azure Monitor scheduled query rule Bicep module on top of the telemetry event (existing pattern), or keep alerting code-only

**Never:**
- Do not modify the existing `vector-health` HTTP endpoint
- Do not add new npm dependencies
- Do not store dedup state in-memory only

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| FULLNESS_BREACH | `indexFullness > fullnessThreshold` | Emit `VectorIndexAnomalyAlert` with alertType=`fullness`, observedValue, threshold | Log error if telemetry emit fails, continue |
| GROWTH_SPIKE | dailyGrowth > growthSpikeMultiplier * rollingAvg | Emit `VectorIndexAnomalyAlert` with alertType=`growthSpike`, observedValue, threshold | Log error if telemetry emit fails |
| WITHIN_THRESHOLDS | All metrics below thresholds | No alert emitted, update baseline blob silently | N/A |
| DUPLICATE_WINDOW | Same breach already alerted within dedupWindow | Skip alert, log "Deduplicated" at debug level | N/A |
| FIRST_RUN_NO_BASELINE | No previous baseline blob exists | Create baseline, skip growth evaluation for this cycle | N/A |
| PINECONE_UNAVAILABLE | `getIndexStats()` throws | Log error, emit `VectorIndexAnomalyAlert` with alertType=`connectivity`, skip all checks | Retry on next cycle |

</frozen-after-approval>

## Code Map

- `backend/src/services/vector-health-monitor.js` — New timer handler: fetches stats, evaluates thresholds, emits alerts, manages dedup state
- `backend/services/telemetry.js` — Add `trackVectorIndexAnomalyAlert()` custom event emitter
- `backend/src/index.js` — Register the new timer function
- `infra/modules/functions.bicep` — Add env vars for configurable thresholds and cron schedule

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/telemetry.js` — Add `trackVectorIndexAnomalyAlert()`: emits `VectorIndexAnomalyAlert` event with `indexName`, `alertType` (fullness|growthSpike|connectivity), `observedValue`, `threshold`, `timestamp`, `dedupWindowMinutes`
- [x] `backend/src/functions/vector-health-monitor.js` — Create timer-triggered function that runs periodically (default every 15 min), calls `getIndexStats()`, evaluates fullness and growth thresholds, emits alerts with dedup
- [x] `backend/src/index.js` — Import and register `vector-health-monitor.js`
- [x] `infra/modules/functions.bicep` — Add env vars: `VECTOR_HEALTH_ALERT_CRON`, `VECTOR_HEALTH_FULLNESS_THRESHOLD`, `VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER`, `VECTOR_HEALTH_DEDUP_WINDOW_MINUTES`
- [x] `infra/modules/storage.bicep` — Add `monitor-state` container for dedup/baseline state blobs

**Acceptance Criteria:**
- Given a timer tick fires, when `indexFullness` exceeds `VECTOR_HEALTH_FULLNESS_THRESHOLD` (default: 0.80), then a `VectorIndexAnomalyAlert` event is emitted with `alertType: "fullness"`
- Given a timer tick fires, when daily vector count growth exceeds `VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER` * rolling average (default: 3x), then a `VectorIndexAnomalyAlert` event is emitted with `alertType: "growthSpike"`
- Given a breach was already alerted within `VECTOR_HEALTH_DEDUP_WINDOW_MINUTES` (default: 60), when the same alert type fires again, then no duplicate event is emitted
- Given Pinecone returns an error, when the monitor runs, then a `connectivity` alert is emitted and remaining checks are skipped
- Given no prior baseline exists, when the monitor runs, then it silently creates a baseline and defers growth evaluation until the next cycle

## Spec Change Log

- **2026-06-20**: Review fixes applied: connectivity dedup added, threshold validation + NaN guard, EWMA `||`→`??`, `>=`→`>` for AC1, storage try-catch, `client.flush()` added, `getEnv` `??` fix, baseline validation, inconsistent `context.error`→`context.log`. (specLoopIteration=1)

## Design Notes

**Dedup mechanism:** State is persisted as a JSON blob in the `monitor-state/` container: `monitor-state/vector-alert-dedup.json`. Structure:
```json
{
  "fullness": { "lastAlertedAt": "2026-06-20T10:00:00Z", "observedValue": 0.82 },
  "growthSpike": { "lastAlertedAt": "2026-06-19T22:00:00Z", "observedValue": 4200 }
}
```
If `lastAlertedAt + dedupWindowMinutes` is in the future, the alert is suppressed.

**Baseline tracking:** The monitor maintains a second blob `monitor-state/vector-baseline.json`:
```json
{
  "vectorCount": 15234,
  "recordedAt": "2026-06-20T00:00:00Z",
  "rollingAvgDailyGrowth": 500
}
```
The rolling average is an exponentially weighted moving average (alpha=0.3) updated each run. Daily growth is extrapolated: `(currentVectorCount - lastVectorCount) / hoursSinceLastRun * 24`. The growth spike threshold is `rollingAvgDailyGrowth * VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER`.

**Telemetry event pattern:** Follows existing `trackVectorBackupRun()` convention in `telemetry.js`.

**Alerting via App Insights:** The `VectorIndexAnomalyAlert` event is queryable via KQL:
```kusto
customEvents
| where name == "VectorIndexAnomalyAlert"
| where timestamp >= ago(1d)
| project timestamp, alertType=tostring(customDimensions.alertType),
    observedValue=todouble(customMeasurements.observedValue),
    threshold=todouble(customMeasurements.threshold),
    indexName=tostring(customDimensions.indexName)
```

## Verification

**Commands:**
- `node --test backend/src/functions/vector-health-monitor.test.js` — expected: all tests pass
- `node --test backend/src/functions/vector-health.test.js` — expected: existing tests still pass (no regression)

**Manual checks (if no CLI):**
- Deploy and verify the timer function triggers on schedule (check App Insights traces)
- Temporarily set fullness threshold to 0 and confirm `VectorIndexAnomalyAlert` events appear in App Insights
- Check `monitor-state/vector-alert-dedup.json` in Blob Storage to verify dedup state

## Suggested Review Order

**Entry point — timer handler design**

- Core orchestrator: stats fetch → threshold eval → alert → state persistence
  [`vector-health-monitor.js:95`](../../backend/src/functions/vector-health-monitor.js#L95)

**Threshold parsing and validation**

- Env-var parsing with NaN guards and clamped defaults for all thresholds
  [`vector-health-monitor.js:20`](../../backend/src/functions/vector-health-monitor.js#L20)

**Alert evaluation — fullness, growth spike, connectivity**

- Fullness breach check with `>` (not `>=`) per AC1 precision requirement
  [`vector-health-monitor.js:128`](../../backend/src/functions/vector-health-monitor.js#L128)

- Growth spike detection: EWMA rolling avg vs. spike multiplier, only fires when rolling avg > 0
  [`vector-health-monitor.js:150`](../../backend/src/functions/vector-health-monitor.js#L150)

- Connectivity failure alert with own dedup state, emitted when `getIndexStats` throws
  [`vector-health-monitor.js:109`](../../backend/src/functions/vector-health-monitor.js#L109)

**Dedup mechanism**

- Blob-backed dedup window using `isWithinDedupWindow`, persisted before return
  [`vector-health-monitor.js:55`](../../backend/src/functions/vector-health-monitor.js#L55)

- Dedup state loaded/saved with try-catch wrappers (no crash on storage failure)
  [`vector-health-monitor.js:36`](../../backend/src/functions/vector-health-monitor.js#L36)

**Baseline management and EWMA**

- Baseline validation guard — checks `vectorCount` finite, `recordedAt` parseable
  [`vector-health-monitor.js:85`](../../backend/src/functions/vector-health-monitor.js#L85)

- EWMA with `??` guard for zero-rolling-average edge case
  [`vector-health-monitor.js:79`](../../backend/src/functions/vector-health-monitor.js#L79)

**Telemetry emission**

- `trackVectorIndexAnomalyAlert` with `client.flush()` for reliable emission
  [`telemetry.js:456`](../../backend/src/services/telemetry.js#L456)

- Measurements include `observedValue`, `threshold`, `vectorCount`, `indexFullness`
  [`telemetry.js:467`](../../backend/src/services/telemetry.js#L467)

**Module registration**

- Timer function import and app registration in main index
  [`index.js:43`](../../backend/src/index.js#L43)

**Infrastructure as Code**

- Env var definitions for cron, thresholds, dedup window
  [`functions.bicep:273`](../../infra/modules/functions.bicep#L273)

- `monitor-state` container for dedup and baseline blobs
  [`storage.bicep:111`](../../infra/modules/storage.bicep#L111)

**Supporting peripherals**

- `getIndexStats` returns `{ totalVectorCount, indexFullness, namespaces }` consumed by the monitor
  [`vector-store.js:42`](../../backend/src/services/vector-store.js#L42)
