/*
  ttft-anomaly-alert.bicep — Azure Monitor scheduled query alert for TTFT P95
  Issue #147: Automated TTFT anomaly alerts based on P95 thresholds
*/

@description('Azure region for monitor resources.')
param location string

@description('Resource ID of the Log Analytics Workspace connected to App Insights.')
param workspaceId string

@description('Email destination for alert notifications.')
param notificationEmail string

@description('Name of the scheduled query alert rule.')
param scheduledQueryRuleName string = 'alert-ttft-anomaly'

@description('Name of the action group that sends email notifications.')
param actionGroupName string = 'ag-ttft-anomaly'

@description('Tags to apply to resources.')
param tags object = {}

@minValue(1)
@description('TTFT P95 threshold in milliseconds. Alert fires when P95 exceeds this value.')
param ttftThresholdMs int = 2000

@description('Lookback window for the alert query in ISO 8601 duration format.')
param lookbackWindow string = 'PT15M'

@minValue(1)
@description('Minimum number of samples required to prevent false positives during no-traffic periods.')
param minimumSamples int = 3

@minValue(0)
@maxValue(4)
@description('Alert severity (0=Critical, 1=Error, 2=Warning, 3=Informational, 4=Verbose).')
param severity int = 2

@description('How often the alert query is evaluated, in ISO 8601 duration format.')
param evaluationFrequency string = 'PT5M'

var ttftQueryTemplate = '''
AppEvents
| where Name == "RagQuery.Executed"
| where TimeGenerated >= ago({lookbackWindow})
| where isnotempty(tostring(Measurements.llmFirstTokenLatencyMs))
| extend subjectId = tostring(Properties.subjectId), llmFirstTokenLatencyMs = todouble(Measurements.llmFirstTokenLatencyMs)
| summarize
    ttftP95Ms = percentile(llmFirstTokenLatencyMs, 95),
    sampleCount = count()
    by subjectId
| where sampleCount >= {minimumSamples}
| where ttftP95Ms > {ttftThresholdMs}
| project subjectId, ttftP95Ms, sampleCount
'''

var ttftQuery = replace(
  replace(
    replace(ttftQueryTemplate, '{lookbackWindow}', lookbackWindow),
    '{minimumSamples}', format('{0}', minimumSamples)
  ),
  '{ttftThresholdMs}', format('{0}', ttftThresholdMs)
)

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'TTFTAlert'
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

resource ttftAnomalyRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: scheduledQueryRuleName
  location: location
  tags: tags
  properties: {
    description: 'Triggers when TTFT P95 exceeds ${ttftThresholdMs}ms over the last ${lookbackWindow} (minimum ${minimumSamples} samples required).'
    displayName: 'TTFT P95 anomaly (>${ttftThresholdMs}ms over ${lookbackWindow})'
    severity: severity
    enabled: true
    scopes: [
      workspaceId
    ]
    evaluationFrequency: evaluationFrequency
    windowSize: lookbackWindow
    criteria: {
      allOf: [
        {
          query: ttftQuery
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          dimensions: [
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

output actionGroupId string = actionGroup.id
output scheduledQueryRuleId string = ttftAnomalyRule.id
output ttftThresholdMsValue int = ttftThresholdMs
output minimumSamplesValue int = minimumSamples
output severityValue int = severity
output evaluationFrequencyValue string = evaluationFrequency
