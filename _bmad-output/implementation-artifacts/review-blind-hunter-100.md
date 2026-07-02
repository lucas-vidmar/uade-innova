# Blind Hunter Review — Issue #100 (Multi-Channel Notifications)

You are a **blind hunter** reviewer. You receive ONLY the diff below — no spec, no context, no project access.

Inspect the diff and report any findings. Look for:
- Security issues (secrets in plaintext, missing @secure())
- Logic errors in conditional deployment
- Backward compatibility breaks
- Any code quality issues

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

--- a/infra/modules/ttft-anomaly-alert.bicep
+++ b/infra/modules/ttft-anomaly-alert.bicep
@@ -10,6 +10,10 @@
 @description('Email destination for alert notifications.')
 param notificationEmail string

+@secure()
+@description('Optional webhook URI for Teams/HTTP notification channel (e.g. Teams connector). Empty string disables webhook.')
+param webhookUri string = ''
+
 @description('Name of the scheduled query alert rule.')
 param scheduledQueryRuleName string = 'alert-ttft-anomaly'

@@ -74,6 +78,12 @@
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

--- a/infra/main.bicep
+++ b/infra/main.bicep
@@ -74,6 +74,10 @@
 @description('Lista de correos para notificaciones de presupuesto.')
 param notificationEmail string = ''

+@secure()
+@description('Optional webhook URI for Teams/HTTP anomaly alert notifications (e.g. Teams connector URL).')
+param webhookUri string = ''
+
 @minValue(1)
 @description('TTFT P95 threshold in milliseconds for the anomaly alert rule.')
 param ttftAnomalyThresholdMs int = 2000

@@ -283,6 +287,7 @@
   params: {
     location: location
     workspaceId: appInsights.outputs.logAnalyticsWorkspaceId
+    webhookUri: webhookUri
     notificationEmail: notificationEmail
     scheduledQueryRuleName: anomalousUsageAlertName
     actionGroupName: anomalousUsageActionGroupName

@@ -298,6 +303,7 @@
   params: {
     location: location
     workspaceId: appInsights.outputs.logAnalyticsWorkspaceId
+    webhookUri: webhookUri
     notificationEmail: notificationEmail
     scheduledQueryRuleName: ttftAnomalyAlertName
     actionGroupName: ttftAnomalyActionGroupName

--- a/infra/main.parameters.json
+++ b/infra/main.parameters.json
@@ -56,6 +56,9 @@
         "notificationEmail": {
             "value": "${notificationEmail}"
         },
+        "webhookUri": {
+            "value": "${webhookUri}"
+        },
         "pineconeApiKey": {
             "value": "${PINECONE_API_KEY}"
         }
```
