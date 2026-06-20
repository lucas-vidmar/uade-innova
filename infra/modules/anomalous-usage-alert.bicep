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

@secure()
@maxLength(2000)
@description('Optional webhook URI for Teams/HTTP notification channel (e.g. Teams connector). Empty string disables webhook.')
param webhookUri string = ''

var trimmedWebhookUri = trim(webhookUri)

@description('Name of the scheduled query alert rule.')
param scheduledQueryRuleName string = 'alert-anomalous-token-usage'

@description('Name of the action group that sends email notifications.')
param actionGroupName string = 'ag-anomalous-token-usage'

@description('Tags to apply to resources.')
param tags object = {}

@description('Threshold for per-subject token anomaly alert (tokens per userId+subjectId over 24h).')
param subjectTokenThreshold int = 500000

@description('Threshold for warning-tier token anomaly alert (tokens per user over 24h, before critical threshold).')
param warningTokenThreshold int = 750000

var tokenThreshold = 1000000

var perSubjectQueryTemplate = '''
AppEvents
| where Name == "RAGInteraction"
| where TimeGenerated >= ago(24h)
| where isnotempty(tostring(Properties.userId)) and isnotempty(tostring(Properties.subjectId))
| extend userId = tostring(Properties.userId), subjectId = tostring(Properties.subjectId), totalTokens = todouble(Measurements.totalTokens)
| summarize tokens24h = sum(coalesce(totalTokens, 0.0)) by userId, subjectId
| where tokens24h > {threshold}
| project userId, subjectId, tokens24h
'''

var perSubjectQuery = replace(perSubjectQueryTemplate, '{threshold}', format('{0}', subjectTokenThreshold))

var warningQueryTemplate = '''
AppEvents
| where Name == "RAGInteraction"
| where TimeGenerated >= ago(24h)
| where isnotempty(tostring(Properties.userId))
| extend userId = tostring(Properties.userId), totalTokens = todouble(Measurements.totalTokens)
| summarize tokens24h = sum(coalesce(totalTokens, 0.0)) by userId
| where tokens24h > {threshold}
| project userId, tokens24h
'''

var warningQuery = replace(warningQueryTemplate, '{threshold}', format('{0}', warningTokenThreshold))

var criticalQueryTemplate = '''
AppEvents
| where Name == "RAGInteraction"
| where TimeGenerated >= ago(24h)
| where isnotempty(tostring(Properties.userId))
| extend userId = tostring(Properties.userId), totalTokens = todouble(Measurements.totalTokens)
| summarize tokens24h = sum(coalesce(totalTokens, 0.0)) by userId
| where tokens24h > {threshold}
| project userId, tokens24h
'''

var criticalQuery = replace(criticalQueryTemplate, '{threshold}', format('{0}', tokenThreshold))

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
    webhookReceivers: !empty(trimmedWebhookUri) ? [
      {
        name: 'operations-webhook'
        serviceUri: trimmedWebhookUri
        useCommonAlertSchema: true
      }
    ] : []
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
          query: criticalQuery
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          dimensions: [
            {
              name: 'userId'
              operator: 'Include'
              values: ['*']
            }
          ]
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource perSubjectUsageRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${scheduledQueryRuleName}-per-subject'
  location: location
  tags: tags
  properties: {
    description: 'Triggers when a user exceeds ${subjectTokenThreshold} tokens in a single subject over the last 24 hours.'
    displayName: 'Per-subject anomalous token usage (>${subjectTokenThreshold} tokens / 24h per subject+user)'
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
          query: perSubjectQuery
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          dimensions: [
            {
              name: 'userId'
              operator: 'Include'
              values: ['*']
            }
            {
              name: 'subjectId'
              operator: 'Include'
              values: ['*']
            }
          ]
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource warningUsageRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${scheduledQueryRuleName}-warning'
  location: location
  tags: tags
  properties: {
    description: 'Triggers when a single user exceeds ${warningTokenThreshold} tokens over the last 24 hours (warning tier before critical threshold).'
    displayName: 'Elevated token usage (>${warningTokenThreshold} tokens / 24h per user)'
    severity: 1
    enabled: true
    scopes: [
      workspaceId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT24H'
    criteria: {
      allOf: [
        {
          query: warningQuery
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          dimensions: [
            {
              name: 'userId'
              operator: 'Include'
              values: ['*']
            }
          ]
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

output actionGroupId string = actionGroup.id
output scheduledQueryRuleId string = anomalousUsageRule.id
output perSubjectScheduledQueryRuleId string = perSubjectUsageRule.id
output warningScheduledQueryRuleId string = warningUsageRule.id
output threshold int = tokenThreshold
output subjectTokenThresholdValue int = subjectTokenThreshold
output warningTokenThresholdValue int = warningTokenThreshold
