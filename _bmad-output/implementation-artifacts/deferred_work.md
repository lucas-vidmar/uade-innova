# Deferred Work — Archive Tier Dashboard (gh-176)

Items identified during review that are pre-existing patterns not introduced by this story.

## Pre-existing Patterns

| ID | Issue | Justification |
|----|-------|--------------|
| D1 | `AZURE_STORAGE_CONNECTION_STRING` env var — may not exist in environments using `AZURE_STORAGE_ACCOUNT_NAME` + key | Same pattern as `storage-lifecycle.js` throughout the codebase |
| D2 | `authLevel: 'anonymous'` on all HTTP functions | SWA Front Door handles auth upstream; consistent with all other functions |
| D3 | Credential exposure via error message on missing env var | Consistent pattern across all services |
| D4 | No transient fault/retry logic on blob enumeration | Same as all other blob operations |
| D5 | No request timeout in frontend service layer | Pre-existing; not introduced here |
