---
title: 'Timezone-Aware Deadline Notifications'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: '34ec1b22669d8ca315277f3ff72c724ca8461acf'
context: ['backend/package.json']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The deadline proximity dispatcher evaluates 48h/24h thresholds using UTC-only comparisons, causing reminder timing errors for users outside UTC (e.g. Argentina UTC-3 receives reminders 3 hours early or late depending on threshold direction).

**Approach:** Make the dispatcher timezone-aware by resolving each deadline's target timezone (per-deadline field, falling back to system default), converting deadlines to that timezone before threshold evaluation, and emitting normalized `dueDateTimezone` context in notification payloads.

## Boundaries & Constraints

**Always:**
- Timezone resolution precedence: deadline-level `timezone` field → `DEFAULT_TIMEZONE` env var → `America/Argentina/Buenos_Aires` hard default
- Use Node.js native `Intl.DateTimeFormat` and UTC offset math — no new external dependencies (moment-timezone is transitive but avoid adding direct dep)
- Notification payload must include `dueDateTimezone` string field with resolved IANA timezone name
- All existing tests must continue passing (update test mocks to include timezone where needed)
- Timer trigger must remain idempotent and fast (< 5s execution)

**Ask First:**
- Adding a new env var `DEFAULT_TIMEZONE` to any Bicep/app settings

**Never:**
- Do not add student-level timezone storage (no user profile system exists yet — Story 5.3 can extend later)
- Do not modify the deadline CRUD HTTP endpoints (`get-deadlines`, `save-deadline`) — timezone is added at the data level only (deadline JSON model)
- Do not add external timezone libraries — use native Node.js capabilities

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deadline with explicit timezone | `dueDate: "2026-04-13T09:00:00.000Z"`, `timezone: "America/Argentina/Buenos_Aires"` | 48h threshold evaluated at 2026-04-11T06:00 ART = 2026-04-11T09:00Z | N/A |
| Deadline without timezone, env var set | `dueDate: "..."`, no timezone field, `DEFAULT_TIMEZONE=America/New_York` | Uses America/New_York for threshold eval | N/A |
| Deadline without timezone, no env var | No timezone field, no env var set | Falls back to America/Argentina/Buenos_Aires | N/A |
| Invalid timezone value | `timezone: "Invalid/Zone"` | Logs warning, falls back to default | Context.error with deadline id + invalid zone |
| UTC deadline in UTC timezone | `dueDate: "..."`, `timezone: "UTC"` | Threshold eval uses UTC directly (no offset change) | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/functions/deadline-proximity-dispatcher.js` -- Timer trigger that evaluates deadline thresholds — primary modification target
- `backend/src/functions/deadline-proximity-dispatcher.test.js` -- Tests for the dispatcher — add timezone-aware test cases
- `backend/src/functions/deadlines.js` -- Deadline CRUD HTTP endpoints — no changes, but reference for data model
- `backend/package.json` -- No new deps needed, but verify `moment-timezone` transitive dep status
- `backend/host.json` -- Optional: no changes unless env var binding needed
- `infra/modules/functions.bicep` -- Optional: add DEFAULT_TIMEZONE app setting if env var route chosen

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/deadline-proximity-dispatcher.js` -- Add `resolveTimezone()` helper, modify `parseDeadlineDueAtUtc` to `parseDeadline`, and update `isWithinThresholdWindow` to accept timezone parameter; add `dueDateTimezone` to notification payload
- [x] `backend/src/functions/deadline-proximity-dispatcher.test.js` -- Add tests for: deadline with explicit timezone, missing timezone fallback, invalid timezone fallback, UTC timezone edge case
- [x] `backend/src/functions/deadlines.js` -- Add `timezone` field to `normalizeDeadline` with default null (no changes to endpoints)

**Acceptance Criteria:**
- Given a deadline with `timezone: "America/Argentina/Buenos_Aires"` and `dueDate: "2026-04-13T09:00:00.000Z"`, when the dispatcher runs at `2026-04-11T09:00:00.000Z` (09:00 UTC), then the 48h reminder is emitted (09:00 UTC = 06:00 ART, which is exactly 48h before 06:00 ART)
- Given a deadline with no timezone field and `DEFAULT_TIMEZONE` set to `"America/New_York"`, when the dispatcher runs, then the evaluation uses America/New_York for threshold calculation
- Given a deadline with `timezone: "Invalid/Zone"`, when the dispatcher evaluates it, then the error is logged with context.error and the deadline falls back to the system default timezone
- Given a deadline with `timezone: "UTC"`, when the dispatcher evaluates it, then the threshold behaves identically to the current UTC-only logic
- Given any notification emitted by the dispatcher, then the payload includes `dueDateTimezone` set to the resolved IANA timezone name

## Verification

**Commands:**
- `cd backend && npm test -- --test-name-pattern="deadline-proximity-dispatcher"` -- all existing tests pass plus new timezone tests
- `node -e "new Intl.DateTimeFormat('en',{timeZone:'America/Argentina/Buenos_Aires'})"` -- verify native timezone support works in the runtime Node version

## Suggested Review Order

**Timezone resolution & parsing**

- Entry point: deadline timezone resolved before threshold evaluation
  [`deadline-proximity-dispatcher.js:87`](../../backend/src/functions/deadline-proximity-dispatcher.js#L88)

- Resolves timezone from deadline field, env var, or hard default; validates with moment-timezone
  [`deadline-proximity-dispatcher.js:9`](../../backend/src/functions/deadline-proximity-dispatcher.js#L9)

- Date-only dueDates interpreted as midnight in target timezone using moment-timezone
  [`deadline-proximity-dispatcher.js:15`](../../backend/src/functions/deadline-proximity-dispatcher.js#L15)

**Notification payload**

- `dueDateTimezone` added to notification payload for traceability
  [`deadline-proximity-dispatcher.js:64`](../../backend/src/functions/deadline-proximity-dispatcher.js#L64)

**Data model**

- Optional `timezone` field in deadline normalization
  [`deadlines.js:26`](../../backend/src/functions/deadlines.js#L26)

**Tests**

- 5 new tests: payload traceability, date-only dueDate, missing tz fallback, invalid tz fallback, UTC edge case
  [`deadline-proximity-dispatcher.test.js:104`](../../backend/src/functions/deadline-proximity-dispatcher.test.js#L104)

**Dependencies**

- moment-timezone added as direct dependency (already transitive)
  [`package.json:27`](../../backend/package.json#L27)
