---
title: 'Multi-Channel Anomalous Usage Notifications (Email + Webhook/Teams)'
type: 'feature'
created: '2026-06-20'
status: 'done'
baseline_commit: '03f2ad22f99d56b31bbbbbf7d801e9e083a5ab49'
---

## Intent

**Problem:** Anomalous token usage alerts (critical at 1M, warning at 750K, per-subject at 500K) only support email notifications, forcing operations teams to rely on a single channel that may be missed or delayed.

**Approach:** Add an optional webhook receiver to the existing Azure Monitor Action Groups for both anomalous-usage and TTFT alerts, configured via an environment-driven parameter. The webhook URI supports Teams connectors and generic HTTP endpoints. Existing email paths remain untouched.

## Boundaries & Constraints

**Always:** Existing email receivers must remain functional and untouched. The webhook receiver must be optional — an empty/null `webhookUri` produces no webhook. The Bicep module must accept `webhookUri` as a `@secure()` parameter to avoid leaking the URI in logs.

**Ask First:** Whether to also add webhook support to the TTFT anomaly alert (same pattern, same module) — recommended for consistency but optional from the story.

**Never:** Do not remove or modify any existing email receiver configuration. Do not hardcode webhook URIs. Do not add application-level notification logic — this is IaC-only (the Action Group routes to the channel; the channel app handles dispatch).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `webhookUri` = `https://hooks.office.com/...` | Action Group deploys with both `emailReceivers` and `webhookReceivers` | N/A |
| NO_WEBHOOK | `webhookUri` = `''` (empty string, default) | Action Group deploys with only `emailReceivers` (no webhook) | N/A |
| INVALID_URI | `webhookUri` = `not-a-url` | Bicep validation rejects; deployment fails at preflight | Azure rejects the resource |

</frozen-after-approval>

## Code Map

- `infra/modules/anomalous-usage-alert.bicep` -- Primary module: add conditional `webhookReceivers` to the action group
- `infra/modules/ttft-anomaly-alert.bicep` -- Secondary module: same webhook pattern for TTFT alerts
- `infra/main.bicep` -- Orchestrator: pass `webhookUri` parameter to both alert modules
- `infra/main.parameters.json` -- Wire `webhookUri` from azd environment variable

## Tasks & Acceptance

**Execution:**
- [x] `infra/modules/anomalous-usage-alert.bicep` -- Add optional `webhookUri` param and conditional `webhookReceivers` block to `actionGroup` resource
- [x] `infra/modules/ttft-anomaly-alert.bicep` -- Same webhook receiver pattern for TTFT alert action group
- [x] `infra/main.bicep` -- Add `@secure()` `webhookUri` param, pass to both alert modules
- [x] `infra/main.parameters.json` -- Add `webhookUri` mapping from `${webhookUri}` env var

**Acceptance Criteria:**
- Given anomalous-usage alerts are enabled, when `webhookUri` is set, then the Action Group includes both email and webhook receivers
- Given `webhookUri` is empty, when the module deploys, then only email receivers are provisioned (backward compatible)
- Given `webhookUri` is set for TTFT alerts, when `ttft-anomaly-alert.bicep` deploys, then its Action Group also includes a webhook receiver

## Verification

**Commands:**
- `az deployment group what-if --resource-group RG_UADE_INNOVA_DEV --template-file infra/main.bicep --parameters infra/main.parameters.json` -- expected: no breaking changes, new webhook receivers shown in what-if output

**Manual checks (if no CLI):**
- Inspect `anomalous-usage-alert.bicep` action group definition to confirm `webhookReceivers` is conditionally added via `empty()` ternary
- Confirm both alert modules accept `webhookUri` param with `''` default

## Suggested Review Order

**Core logic — conditional webhook receiver**

- Entry point: webhook URI parameter and conditional receiver in anomalous-usage alert action group
  [`anomalous-usage-alert.bicep:75`](../../infra/modules/anomalous-usage-alert.bicep#L75)

- Same webhook pattern applied to TTFT alert action group for consistency
  [`ttft-anomaly-alert.bicep:74`](../../infra/modules/ttft-anomaly-alert.bicep#L74)

**Module wiring — parameter propagation**

- Top-level `@secure()` `webhookUri` param with azd env-driven default
  [`main.bicep:91`](../../infra/main.bicep#L91)

- Webhook URI wired into both alert modules alongside existing `notificationEmail`
  [`main.bicep:289`](../../infra/main.bicep#L289)

- Same wiring for TTFT alert module
  [`main.bicep:305`](../../infra/main.bicep#L305)

**Environment binding**

- Maps `webhookUri` from azd env var to deployment parameter
  [`main.parameters.json:59`](../../infra/main.parameters.json#L59)
