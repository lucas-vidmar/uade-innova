# Acceptance Auditor Review

You have read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard/`. Review the diff against the spec at `_bmad-output/implementation-artifacts/spec-9-196-bicep-provisioning.md`.

Also read context docs: `_bmad-output/planning-artifacts/epics.md`, `_bmad-output/planning-artifacts/architecture.md`, `_bmad-output/implementation-artifacts/epic-9-context.md`.

```diff
(same diff as blind hunter)
```

Verify:
1. **AC1**: 4 blob containers are provisioned (class-materials, processed, glossary-files, summaries)
2. **AC2**: All required tables exist (Enrollments, UserConsent, Corrections, CorrectionsPending, Conversations, ConversationRatings, NotificationPreferences, UserEvents + existing materials, classes, UserProfiles, SessionMetrics)
3. **AC3**: 2 queues exist (ingestion-tasks, notification-queue)
4. **AC4**: Key Vault gets AZURE-STORAGE-CONNECTION-STRING secret
5. Existing resources were NOT modified (only added)
6. All new resources have proper outputs in storage.bicep
7. Functions app settings are properly wired for all new table/container/queue names
8. Naming conventions match existing resources (kebab-case for containers, PascalCase for tables)
