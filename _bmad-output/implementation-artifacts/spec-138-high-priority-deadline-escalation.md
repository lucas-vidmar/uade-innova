---
title: 'High-Priority Deadline Escalation Reminder (2h)'
type: 'feature'
created: '2026-06-19'
status: 'done'
context: ['backend/src/functions/deadline-proximity-dispatcher.js', 'backend/src/functions/deadlines.js']
baseline_commit: '9dda6bcaeb2835f964ddcf72c2d3ecdd2450f811'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students receive 48h/24h reminders for all deadlines equally, but high-stakes submissions (e.g., partial exams, major TP with weight >= 25%) need a final escalation at 2 hours to prevent missed critical submissions.

**Approach:** Add `weight` and `status` fields to the deadline data model, then extend the deadline-proximity-dispatcher to emit an additional 2h escalation notification only for high-priority (weight >= threshold), non-completed deadlines. Deduplication follows the existing notification-ID pattern.

## Boundaries & Constraints

**Always:**
- Deadline model gains optional `weight` (0-100, default 0) and `status` ("pending" | "completed", default "pending")
- 2h escalation only fires for deadlines with `weight` >= `DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD` (env var, default 25) AND `status` !== "completed"
- Notification ID format for 2h: `notif-deadline-{subjectId}-{deadlineId}-2h` (same pattern as 48h/24h)
- Notification title: "⚠️ Deadline urgente — 2 horas restantes"
- Existing 48h/24h thresholds must continue unchanged for all deadlines
- `normalizeDeadline` in `deadlines.js` must include `weight` and `status`
- Tests must cover: 2h escalation fires for high-weight pending deadline, 2h does not fire for low-weight, 2h does not fire for completed, dedup works

**Ask First:**
- Adding `DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD` env var to any Bicep/app settings config

**Never:**
- Do not change the 48h/24h behavior
- Do not add external dependencies
- Do not create new Timer triggers — the existing 30-min dispatcher handles this
- Do not modify the notification-store

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| High-weight pending deadline within 2h | `weight: 35, status: "pending"`, due in 90 min | 2h escalation notification emitted | N/A |
| Low-weight pending deadline within 2h | `weight: 5, status: "pending"`, due in 90 min | No 2h notification (48h/24h still fire) | N/A |
| High-weight completed deadline within 2h | `weight: 35, status: "completed"`, due in 90 min | No 2h notification | N/A |
| High-weight pending deadline, 2h notification already sent | Same deadline, 2h notif ID already exists | Skipped (dedup) | N/A |
| Deadline with no weight field | `weight: 0` (default) | Treated as low priority — no 2h escalation | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/functions/deadline-proximity-dispatcher.js` -- Timer trigger: add 2h threshold for high-priority pending deadlines, update `buildReminderNotification`
- `backend/src/functions/deadline-proximity-dispatcher.test.js` -- Tests for 2h escalation, weight threshold, status filter, dedup
- `backend/src/functions/deadlines.js` -- `normalizeDeadline`: add `weight` and `status` fields with defaults

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/deadlines.js` -- Add `weight: deadline.weight || 0` and `status: deadline.status || "pending"` to `normalizeDeadline`
- [x] `backend/src/functions/deadline-proximity-dispatcher.js` -- Add `DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD` (default 25); add 2h to thresholds array with weight+status guard; update `buildReminderNotification` for 2h title
- [x] `backend/src/functions/deadline-proximity-dispatcher.test.js` -- Add 4 tests for the I/O matrix scenarios

**Acceptance Criteria:**
- Given a deadline with weight >= 25 and status "pending" within 2h of due, when the dispatcher runs, then a 2h escalation notification is emitted
- Given a deadline with weight < 25 within 2h of due, when the dispatcher runs, then no 2h notification is emitted
- Given a deadline with weight >= 25 but status "completed" within 2h of due, when the dispatcher runs, then no 2h notification is emitted
- Given a 2h notification already exists for a deadline, when the dispatcher runs again, then no duplicate is created
- Given existing 48h/24h deadlines, when the dispatcher runs, then those notifications continue to emit unchanged

## Verification

**Commands:**
- `node --experimental-test-module-mocks --test backend/src/functions/deadline-proximity-dispatcher.test.js` -- all 11+ tests pass

## Suggested Review Order

**Entry point — escalation logic**

- New `weightThreshold` env var and 2h escalation block added after existing 48h/24h loop; guarded by `isHighPriority && isPending`
  [`deadline-proximity-dispatcher.js:70`](../../backend/src/functions/deadline-proximity-dispatcher.js#L70)

**Schema — new deadline fields**

- `weight` (0-100, default 0) and `status` ("pending"/"completed") added to `normalizeDeadline` for escalation eligibility
  [`deadlines.js:29`](../../backend/src/functions/deadlines.js#L29)

**Notification title**

- Ternary extended to handle `thresholdHours === 2` with urgent Spanish title and warning emoji
  [`deadline-proximity-dispatcher.js:48`](../../backend/src/functions/deadline-proximity-dispatcher.js#L48)

**Tests — edge cases**

- Happy path: high-weight pending deadline within 2h window emits escalation
  [`deadline-proximity-dispatcher.test.js:197`](../../backend/src/functions/deadline-proximity-dispatcher.test.js#L197)

- Low-weight guard: weight below threshold suppresses 2h notification
  [`deadline-proximity-dispatcher.test.js:220`](../../backend/src/functions/deadline-proximity-dispatcher.test.js#L220)

- Completed guard: completed status suppresses 2h notification even with high weight
  [`deadline-proximity-dispatcher.test.js:248`](../../backend/src/functions/deadline-proximity-dispatcher.test.js#L248)

- Dedup guard: existing 2h notification ID prevents duplicate emission
  [`deadline-proximity-dispatcher.test.js:276`](../../backend/src/functions/deadline-proximity-dispatcher.test.js#L276)
