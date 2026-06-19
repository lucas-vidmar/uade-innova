---
title: 'Document notifications API contract for frontend/backend alignment'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
context: ['{project-root}/docs/sga-openapi.json', '{project-root}/backend/src/functions/notifications.js', '{project-root}/frontend/src/services/api.js']
---

# GH-93: Document notifications API contract

## Intent

**Problem:** Frontend and backend evolved the notifications feature independently without a formal API contract, risking integration regressions when either side changes request/response shapes or error behavior.

**Approach:** Publish an OpenAPI 3.0.3 contract (`docs/notifications-api.json`) covering all four notification endpoints — `GET /api/notifications`, `PATCH /api/notifications/{id}/read`, `POST /api/notifications/read`, `GET /api/notifications/stream` — with complete schemas for `PublicNotification`, `InternalNotification`, and `ErrorResponse` plus documented error/fallback behavior for each status code.

## Suggested Review Order

**Schema completeness**

- PublicNotification matches backend's `asPublicNotification` output shape with all required fields
  [`../../docs/notifications-api.json:323`](../../docs/notifications-api.json#L323)

- InternalNotification documents private fields (recipientUserIds, readByUserIds, origin) stripped before public exposure
  [`../../docs/notifications-api.json:342`](../../docs/notifications-api.json#L342)

**Endpoint coverage — CRUD**

- GET list with pagination (limit/skip), type filter, enrollment guard, and dedup merge doc
  [`../../docs/notifications-api.json:21`](../../docs/notifications-api.json#L21)

- PATCH single mark-read with seed-fallback flow and userId/subjectId validation
  [`../../docs/notifications-api.json:102`](../../docs/notifications-api.json#L102)

- POST bulk mark-read with dedup, empty-input guard, and count response
  [`../../docs/notifications-api.json:184`](../../docs/notifications-api.json#L184)

**Endpoint coverage — Real-time**

- SSE stream with snapshot/notification/keepalive event types and since parameter
  [`../../docs/notifications-api.json:253`](../../docs/notifications-api.json#L253)

- SSE event payload descriptions document per-event data shapes
  [`../../docs/notifications-api.json:286`](../../docs/notifications-api.json#L286)

**Error handling**

- All endpoints document 401/403/500 responses with consistent ErrorResponse schema
  [`../../docs/notifications-api.json:361`](../../docs/notifications-api.json#L361)
