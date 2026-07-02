# Edge Case Hunter Review

You have read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard/`. Review the diff for edge cases.

```diff
(same diff as blind hunter)
```

Probe these edge cases:
1. What if `listKeys()` returns empty or fails at deploy time?
2. What if `keyVaultName` exceeds the 24-char limit for Key Vault names?
3. What if the storage account connection string contains special characters that break the secret value?
4. What happens if `azd provision` is run twice — are resources idempotent?
5. What if `storage.outputs.accountName` contains characters invalid in a connection string?
6. Are there any naming collisions between existing resources and new ones?
7. What happens during a partial deployment failure — would some tables be created and others not?
8. Does the `dependsOn` chain guarantee correct ordering (KV secret depends on KV, which depends on storage)?
