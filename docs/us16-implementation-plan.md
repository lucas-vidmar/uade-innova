# Implementation Plan: User Story #16

**Feature/Story Name**: API Rate Limiting & DDOS Protection  
**Status**: In Progress  
**Business Impact**: Prevents abusive scripted traffic from exhausting token/compute budgets while preserving platform availability for legitimate users.

## Requirements & Constraints Analysis
- Enforce API rate limiting at infrastructure edge (APIM or Front Door).
- Target policy: **max 10 requests/minute** for API traffic.
- Rapid bursts above threshold must result in **HTTP 429** behavior visible to users.
- Must stay aligned with existing IaC-first approach (Bicep) and prior Front Door/WAF hardening patterns.

## Edge Cases Considered
- Rate limit should apply only to backend API paths (`/api/*`) and not static frontend assets.
- Existing managed WAF rules (OWASP DRS) must remain active alongside custom rate limiting.
- Front Door module is currently commented in `main.bicep`; story requires re-enabling wiring to avoid configuration drift.
- 429 responses from backend-facing chat flows should surface a usable message in UI rather than a generic failure.

## Planned Milestones
- [ ] Add Front Door WAF custom `RateLimitRule` in `infra/modules/frontdoor.bicep` for `/api/*`.
- [ ] Re-enable Front Door module and Key Vault secret wiring in `infra/main.bicep`.
- [ ] Add backend IaC contract tests validating rate-limit policy and main wiring.
- [ ] Add Chrome Playwright usability test validating 429 user-visible handling in student chat.
- [ ] Run backend tests.
- [ ] Run frontend Playwright test(s), including Chrome-specific check for this story.
- [ ] Produce walkthrough artifact and backlog refinement notes.

## Out of Scope
- Adaptive per-user/per-role throttling policies.
- Complex DDoS analytics and auto-mitigation runbooks.
- APIM migration (story explicitly satisfied via Front Door path).
