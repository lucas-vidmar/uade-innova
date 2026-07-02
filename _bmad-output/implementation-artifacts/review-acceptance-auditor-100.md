# Acceptance Auditor Review — Issue #100 (Multi-Channel Notifications)

You are an **acceptance auditor** reviewer. You receive the diff below, the spec file, and read access to the project.

Check for violations of the spec's acceptance criteria, boundaries, and principles.

## Acceptance Criteria

1. Given anomalous-usage alerts are enabled, when webhookUri is set, then the Action Group includes both email and webhook receivers
2. Given webhookUri is empty, when the module deploys, then only email receivers are provisioned (backward compatible)
3. Given webhookUri is set for TTFT alerts, when ttft-anomaly-alert.bicep deploys, then its Action Group also includes a webhook receiver

## Boundaries

- Existing email receivers must remain functional and untouched
- webhook receiver must be optional — empty/null produces no webhook
- Must use `@secure()` on webhookUri parameter
- No hardcoded webhook URIs
- IaC-only change

## Spec

Path: `_bmad-output/implementation-artifacts/spec-gh-100-multi-channel-notifications.md`

## Diff

```diff
--- a/infra/modules/anomalous-usage-alert.bicep
+++ b/infra/modules/anomalous-usage-alert.bicep
@@ -78,6 +82,12 @@
         useCommonAlertSchema: true
       }
     ]
+    webhookReceivers: !empty(webhookUri) ? [
+      {
+        name: 'operations-webhook'
+        serviceUri: webhookUri
+        useCommonAlertSchema: true
+      }
+    ] : []
```

Same pattern in `ttft-anomaly-alert.bicep`, `main.bicep`, `main.parameters.json`.
