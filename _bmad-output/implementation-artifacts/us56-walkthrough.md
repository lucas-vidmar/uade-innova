# Walkthrough: User Story #56

**Feature/Story Name**: Academic Deadline Management  
**Status**: Completed  
**Business Impact**: Teachers can coordinate class-linked deadlines and students are reminded in time.

## What Changed
- Added `deadlines` and `deadline-reminders` backend endpoints.
- Added teacher deadline creation/editing on the teacher dashboard.
- Added student dashboard deadline cards and calendar deadline markers.
- Added in-app reminder notifications for the day before and the day of a deadline.

## Verification Results
- **Backend tests**: deadline save + reminder logic covered in `backend/src/functions/deadlines.test.js`.
- **Browser test (Chrome/Chromium)**: create "Final Project", link to Class 14, verify it appears in the student dashboard and calendar.

## Backlog Refinement
- Future improvement: richer recurring deadline scheduling and optional per-student overrides.
