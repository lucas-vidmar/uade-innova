# Implementation Plan: User Story #56

**Feature/Story Name**: Academic Deadline Management  
**Status**: Completed  
**Business Impact**: Teachers can coordinate class-linked deadlines and students see them on the main dashboard and calendar with timely reminders.

## Planned Milestones
- [x] Add backend storage/API for class-linked deadlines.
- [x] Add teacher UI to create, edit, and delete deadlines linked to classes.
- [x] Surface deadlines on the student main dashboard and calendar view.
- [x] Trigger reminders one day before and on the deadline day.
- [x] Add backend unit tests and a Chrome/Chromium flow for creating a deadline and verifying it on the student list.
- [x] Update project tracking docs.

## Scope Boundaries
- Deadlines are separate from tasks/grades.
- Deadlines are subject-scoped and linked to one class.
- Notifications are in-app reminders (toast/banner) for the prototype.
