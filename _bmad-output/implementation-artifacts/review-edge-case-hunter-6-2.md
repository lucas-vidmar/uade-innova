# Edge Case Hunter Review — Story 6.2 (Student Intervention Signals)

You have the diff AND read access to the project. Focus on edge cases.

## Diff

Files changed: same as blind hunter review file.

## Spec

Story 6.2 implements:
1. Risk computation from UserEvents telemetry (login recency + query count heuristics)
2. Intervention CRUD with workflow states (assigned → contacted → resolved)
3. Per-subject configurable risk thresholds with defaults
4. Director-only auth on all endpoints

## Instructions

Walk every branching path and boundary condition:

1. **Risk computation edge cases:**
   - User with no UserEvents at all
   - User with only login events, no query events
   - User with only query events, no login events
   - User on exact boundary days (7, 14, 21)
   - User with exactly 1 query in 7d window, exactly 2 in 7d, exactly 4 in 14d, exactly 5 in 14d
   - User with events spanning timezone boundaries (UTC vs local)
   - Very large number of users (>1000) in UserEvents table

2. **Intervention API edge cases:**
   - PUT to non-existent intervention ID
   - PUT with invalid state value
   - PUT with missing required fields
   - GET with invalid filter values
   - Concurrent state transitions on same intervention

3. **Threshold API edge cases:**
   - PUT with missing thresholds
   - PUT with negative or zero values
   - PUT with non-numeric values
   - GET for non-existent subjectId

4. **Frontend edge cases:**
   - Empty interventions list
   - API failure during load
   - Rapid filter changes
   - Modal open while data refreshes
   - Very long reason text

Return a numbered list of unhandled edge cases with file/line references.
