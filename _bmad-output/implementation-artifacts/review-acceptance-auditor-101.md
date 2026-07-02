# Acceptance Auditor Review — spec-gh-101-per-subject-token-alert

You have read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard` and the spec file. Review whether the diff satisfies the acceptance criteria and spec constraints.

## Spec File

Path: `_bmad-output/implementation-artifacts/spec-gh-101-per-subject-token-alert.md`

### Intent
Add a second scheduled query alert rule in the same module that groups by both `subjectId` and `userId` over 24h with a lower per-subject threshold. Enrich both alert payloads with structured dimensions. Keep the global per-user alert unchanged.

### Acceptance Criteria
1. Given the per-subject alert rule is deployed, when a user exceeds 500K tokens in a single subject over 24h, then an alert fires with `subjectId`, `userId`, and `tokens24h` in the payload.
2. Given both alert rules are deployed, when a user exceeds 500K tokens in one subject but < 1M total, then only the per-subject alert fires (no regression on global threshold).
3. Given no `subjectId` is present in a telemetry event, when the per-subject query runs, then the event is excluded from per-subject aggregation but still counted in the global alert.

### Boundaries & Constraints
- Must not modify or remove the existing global per-user alert rule
- All new alert rules must reference `subjectId` from `customDimensions` (or `Properties` for AppEvents)
- Alert payload must include `subjectId`, `userId`, and `tokens24h` as searchable dimensions
- Per-subject threshold must be configurable (default 500,000)
- New alert rule must use same action group
- Tests must be updated
- Do not modify `rag-query` or `telemetry.js` — subjectId is already present

## Diff

```diff
diff --git a/backend/src/services/anomalous-usage-alert-iac.test.js b/backend/src/services/anomalous-usage-alert-iac.test.js
index 0e56c39..f6d477f 100644
--- a/backend/src/services/anomalous-usage-alert-iac.test.js
+++ b/backend/src/services/anomalous-usage-alert-iac.test.js
@@ -28,4 +28,17 @@ test('main.bicep wires anomalous usage alert behind notification email', async (
   assert.match(content, /module\s+anomalousUsageAlert\s+'\.\/modules\/anomalous-usage-alert\.bicep'\s*=\s*if\s*\(!empty\(notificationEmail\)\)/);
   assert.match(content, /workspaceId:\s*appInsights\.outputs\.logAnalyticsWorkspaceId/);
   assert.match(content, /notificationEmail:\s*notificationEmail/);
+  assert.match(content, /subjectTokenThreshold:\s*500000/);
+});
+
+test('per-subject anomalous usage alert rule is defined with lower threshold and subjectId grouping', async () => {
+  const content = await readRepoFile('infra/modules/anomalous-usage-alert.bicep');
+
+  assert.match(content, /param\s+subjectTokenThreshold\s+int\s*=\s*500000/);
+  assert.match(content, /perSubjectUsageRule/);
+  assert.match(content, /'\$\{scheduledQueryRuleName\}-per-subject'/);
+  assert.match(content, /customDimensions\.subjectId/);
+  assert.match(content, /summarize\s+tokens24h\s*=\s*sum\(coalesce\(totalTokens,\s*0\.0\)\)\s+by\s+userId,\s*subjectId/);
+  assert.match(content, /where\s+tokens24h\s*>\s*\$\{subjectTokenThreshold\}/);
+  assert.match(content, /name:\s+'subjectId'/);
 });
diff --git a/infra/main.bicep b/infra/main.bicep
index 71ffe90..882a099 100644
--- a/infra/main.bicep
+++ b/infra/main.bicep
@@ -259,6 +259,7 @@ module anomalousUsageAlert './modules/anomalous-usage-alert.bicep' = if (!empty(
     notificationEmail: notificationEmail
     scheduledQueryRuleName: anomalousUsageAlertName
     actionGroupName: anomalousUsageActionGroupName
+    subjectTokenThreshold: 500000
     tags: tags
   }
 }
diff --git a/infra/modules/anomalous-usage-alert.bicep b/infra/modules/anomalous-usage-alert.bicep
index 8519643..867eb3f 100644
--- a/infra/modules/anomalous-usage-alert.bicep
+++ b/infra/modules/anomalous-usage-alert.bicep
@@ -21,6 +21,9 @@ param actionGroupName string = 'ag-anomalous-token-usage'
 @description('Tags to apply to resources.')
 param tags object = {}
 
+@description('Threshold for per-subject token anomaly alert (tokens per userId+subjectId over 24h).')
+param subjectTokenThreshold int = 500000
+
 var tokenThreshold = 1000000
 
 resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
@@ -76,6 +79,78 @@ union isfuzzy=true ragFromCustomEvents, ragFromAppEvents
           timeAggregation: 'Count'
           operator: 'GreaterThanOrEqual'
           threshold: 1
+          dimensions: [
+            {
+              name: 'userId'
+              operator: 'Include'
+              values: ['*']
+            }
+          ]
+          failingPeriods: {
+            numberOfEvaluationPeriods: 1
+            minFailingPeriodsToAlert: 1
+          }
+        }
+      ]
+    }
+    autoMitigate: true
+    muteActionsDuration: 'PT1H'
+    actions: {
+      actionGroups: [
+        actionGroup.id
+      ]
+    }
+  }
+}
+
+resource perSubjectUsageRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
+  name: '${scheduledQueryRuleName}-per-subject'
+  location: location
+  tags: tags
+  properties: {
+    description: 'Triggers when a user exceeds ${subjectTokenThreshold} tokens in a single subject over the last 24 hours.'
+    displayName: 'Per-subject anomalous token usage (>${subjectTokenThreshold} tokens / 24h per subject+user)'
+    severity: 2
+    enabled: true
+    scopes: [
+      workspaceId
+    ]
+    evaluationFrequency: 'PT5M'
+    windowSize: 'PT24H'
+    criteria: {
+      allOf: [
+        {
+          query: '''
+let ragFromCustomEvents =
+customEvents
+| where name == "RAGInteraction"
+| project timestamp, userId=tostring(customDimensions.userId), subjectId=tostring(customDimensions.subjectId), totalTokens=todouble(customMeasurements.totalTokens);
+let ragFromAppEvents =
+AppEvents
+| where Name == "RAGInteraction"
+| project timestamp=TimeGenerated, userId=tostring(Properties.userId), subjectId=tostring(Properties.subjectId), totalTokens=todouble(Measurements.totalTokens);
+union isfuzzy=true ragFromCustomEvents, ragFromAppEvents
+| where timestamp >= ago(24h)
+| where isnotempty(userId) and isnotempty(subjectId)
+| summarize tokens24h = sum(coalesce(totalTokens, 0.0)) by userId, subjectId
+| where tokens24h > ${subjectTokenThreshold}
+| project userId, subjectId, tokens24h
+'''
+          timeAggregation: 'Count'
+          operator: 'GreaterThanOrEqual'
+          threshold: 1
+          dimensions: [
+            {
+              name: 'userId'
+              operator: 'Include'
+              values: ['*']
+            }
+            {
+              name: 'subjectId'
+              operator: 'Include'
+              values: ['*']
+            }
+          ]
           failingPeriods: {
             numberOfEvaluationPeriods: 1
             minFailingPeriodsToAlert: 1
@@ -95,4 +170,6 @@ union isfuzzy=true ragFromCustomEvents, ragFromAppEvents
 
 output actionGroupId string = actionGroup.id
 output scheduledQueryRuleId string = anomalousUsageRule.id
+output perSubjectScheduledQueryRuleId string = perSubjectUsageRule.id
 output threshold int = tokenThreshold
+output subjectTokenThresholdValue int = subjectTokenThreshold
```

Check:
1. Does the diff satisfy all acceptance criteria?
2. Are all boundaries & constraints respected?
3. Are the tests adequate?
4. Does the KQL query correctly handle the telemetry event schema?
