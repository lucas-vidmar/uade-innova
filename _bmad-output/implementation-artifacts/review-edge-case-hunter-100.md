# Edge Case Hunter Review — Issue #100 (Multi-Channel Notifications)

You are an **edge case hunter** reviewer. You receive the diff below + read access to the project.

Inspect the full project context (especially the Bicep files in `infra/`) and the diff. Walk every branching path and boundary condition. Report only unhandled edge cases.

## Diff

```diff
--- a/infra/modules/anomalous-usage-alert.bicep
+++ b/infra/modules/anomalous-usage-alert.bicep
@@ -12,6 +12,10 @@
 @description('Email destination for alert notifications.')
 param notificationEmail string

+@secure()
+@description('Optional webhook URI for Teams/HTTP notification channel (e.g. Teams connector). Empty string disables webhook.')
+param webhookUri string = ''
+
 @description('Name of the scheduled query alert rule.')
 param scheduledQueryRuleName string = 'alert-anomalous-token-usage'

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
   }
 }
```

Same pattern in `infra/modules/ttft-anomaly-alert.bicep`.

`infra/main.bicep` — passes `webhookUri` to both alert modules.
`infra/main.parameters.json` — maps `webhookUri` from `${webhookUri}` env var.
