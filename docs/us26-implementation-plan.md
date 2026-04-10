# Implementation Plan: User Story #26

**Feature/Story Name**: SGA API Schema Mapping  
**Status**: In Progress  
**Business Impact**: Defines a contract-first integration boundary for SGA data (tareas, alertas tempranas y asistencia), reducing future integration risk and enabling consistent backend/frontend alignment.

## Requirements & Constraints Analysis
- The story requires a generated **OpenAPI/Swagger schema** for real SGA integration.
- Mock academic data must be validated against the schema.
- The solution must stay compatible with current dashboard flows (student tasks and director alerts).
- Keep security posture aligned with existing conventions (no hardcoded secrets, no auth bypass changes).

## Edge Cases Considered
- Missing `studentId` / `subjectId` query params in SGA endpoints.
- Invalid role access for director-only or teacher/director API usage.
- Schema drift between mock payload shape and runtime endpoint responses.
- Unexpected task status/alert risk values outside enumerated sets.

## Planned Milestones
- [ ] Add OpenAPI schema artifact for SGA integration (Swagger-compatible JSON).
- [ ] Implement backend SGA mock endpoints aligned to the schema.
- [ ] Wire frontend SGA API methods to consume backend endpoints with safe fallbacks.
- [ ] Add backend tests validating endpoint behavior and schema conformance of mock payloads.
- [ ] Add Chrome/Chromium Playwright usability test covering SGA-backed task visualization.
- [ ] Execute backend unit tests and frontend e2e test.
- [ ] Document walkthrough and backlog refinements.

## Out of Scope
- Live connector to institutional SGA production systems.
- Token-based SGA authentication handshake (to be defined in a future story).
- Gradebook write-back operations to SGA.
