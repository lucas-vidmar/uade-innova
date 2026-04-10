/*
  anomalous-usage-alert.bicep — Azure Monitor anomaly alert
  Story #72: Email alert when any user exceeds 1,000,000 tokens in 24h.
*/

@description('Azure region for monitor resources.')
param location string

@description('Resource ID of the Log Analytics Workspace connected to App Insights.')
param workspaceId string

@description('Email destination for alert notifications.')
param notificationEmail string

@description('Name of the scheduled query alert rule.')
param scheduledQueryRuleName string = 'alert-anomalous-token-usage'

@description('Name of the action group that sends email notifications.')
param actionGroupName string = 'ag-anomalous-token-usage'

@description('Tags to apply to resources.')
param tags object = {}

var tokenThreshold = 1000000

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'TokenAlert'
    enabled: true
    emailReceivers: [
      {
        name: 'operations-email'
        emailAddress: notificationEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource anomalousUsageRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: scheduledQueryRuleName
  location: location
  tags: tags
  properties: {
    description: 'Triggers when a single user exceeds 1,000,000 tokens over the last 24 hours.'
    displayName: 'Anomalous token usage (>1M tokens / 24h per user)'
    severity: 2
    enabled: true
    scopes: [
      workspaceId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT24H'
    criteria: {
      allOf: [
        {
          query: '''
let ragFromCustomEvents =
customEvents
| where name == "RAGInteraction"
| project timestamp, userId=tostring(customDimensions.userId), totalTokens=todouble(customMeasurements.totalTokens);
let ragFromAppEvents =
AppEvents
| where Name == "RAGInteraction"
| project timestamp=TimeGenerated, userId=tostring(Properties.userId), totalTokens=todouble(Measurements.totalTokens);
union isfuzzy=true ragFromCustomEvents, ragFromAppEvents
| where timestamp >= ago(24h)
| where isnotempty(userId)
| summarize tokens24h = sum(coalesce(totalTokens, 0.0)) by userId
| where tokens24h > 1000000
| project userId, tokens24h
'''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    muteActionsDuration: 'PT1H'
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

output actionGroupId string = actionGroup.id
output scheduledQueryRuleId string = anomalousUsageRule.id
output threshold int = tokenThreshold
