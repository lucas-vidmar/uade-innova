---
title: 'Tiered Token Usage Alerts (Warning at 750k/24h)'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Operations teams have no early warning before the 1M tokens/24h critical alert fires — by the time it triggers, a user has already breached the anomalous threshold with no intermediate signal for proactive intervention.

**Approach:** Add a third Azure Monitor scheduled query rule at 750K tokens/24h per user with severity 1 (Warning), clearly distinguishable from the existing severity 2 (Informational) critical rule, leaving all existing alerts unchanged.

## Suggested Review Order

**Entry point — new warning rule definition**

- Warning tier rule at 750K with severity 1, same KQL structure as existing critical rule but with parameterized threshold
  [`anomalous-usage-alert.bicep:174`](../../infra/modules/anomalous-usage-alert.bicep#L174)

**Module wiring in main.bicep**

- New `warningTokenThreshold: 750000` passed to the module alongside existing `subjectTokenThreshold`
  [`main.bicep:263`](../../infra/main.bicep#L263)

**Tests**

- Verifies warning parameter default, resource naming, severity 1, and parameterized threshold in KQL
  [`anomalous-usage-alert-iac.test.js:34`](../../backend/src/services/anomalous-usage-alert-iac.test.js#L34)

- Verifies main.bicep wires `warningTokenThreshold: 750000` to the module
  [`anomalous-usage-alert-iac.test.js:32`](../../backend/src/services/anomalous-usage-alert-iac.test.js#L32)
