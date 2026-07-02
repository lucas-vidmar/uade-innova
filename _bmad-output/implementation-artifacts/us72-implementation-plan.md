# Implementation Plan: User Story #72

**Feature/Story Name**: Anomalous Usage Alerts  
**Status**: In Progress  
**Business Impact**: Operations receives proactive email alerts when any user exceeds 1,000,000 tokens in 24 hours, reducing FinOps risk and enabling rapid investigation.

## Requirements & Constraints Analysis
- Trigger an alert when a single user consumes more than **1,000,000 tokens over 24h**.
- Alert must be implemented as an **Azure Monitor rule with KQL** over telemetry logs.
- Solution must be **IaC-first** (Bicep) and integrated into `infra/main.bicep`.
- Email notifications should be configurable via existing environment parameter (`notificationEmail`) and should not hardcode recipients.

## Edge Cases Considered
- Missing `userId` in telemetry events → exclude from aggregation to avoid false positives.
- Missing/invalid `totalTokens` measurement → coalesce to `0` to keep query resilient.
- Empty notification email in lower environments → skip alert resource creation safely.
- Rolling 24h usage spikes spread across multiple interactions → aggregate with `sum(totalTokens)` grouped by user.

## Planned Milestones
- [ ] Add a dedicated IaC module for anomalous token usage alerting:
  - [ ] Azure Monitor Action Group (email receiver).
  - [ ] Scheduled Query Rule (KQL against App Insights workspace).
- [ ] Wire module in `infra/main.bicep` using existing `notificationEmail` parameter.
- [ ] Add automated tests for IaC contract and KQL guardrails.
- [ ] Add a UI visibility cue for administrators so the feature is discoverable.
- [ ] Add a Chrome/Chromium Playwright usability test covering the admin experience.
- [ ] Run backend + frontend test suites and capture results.
- [ ] Produce walkthrough artifact and backlog refinement notes.

## Out of Scope
- PagerDuty/Teams/SMS escalation channels.
- Auto-remediation or account throttling.
- Per-subject token caps (this story is per-user global usage window).
