/*
  caudal-alert.bicep — aviso a quien opera cuando el caudal cruza el umbral (#458)

  El tope de servicio del backend anota un evento `CaudalEvent` en Application
  Insights cuando el caudal cruza el umbral reservado y cuando deniega pedidos
  (`backend/src/services/telemetry.js`). Estas reglas son el canal que llega sin
  que nadie esté mirando: mail al operador cuando se cruza el umbral y cuando
  las denegaciones se vuelven un patrón sostenido.
*/

@description('Azure region for monitor resources.')
param location string

@description('Resource ID of the Log Analytics Workspace connected to App Insights.')
param workspaceId string

@description('Email destination for alert notifications.')
param notificationEmail string

@secure()
@maxLength(2000)
@description('Optional webhook URI for Teams/HTTP notification channel. Empty string disables webhook.')
param webhookUri string = ''

@description('Name of the threshold scheduled query alert rule.')
param scheduledQueryRuleName string = 'alert-caudal-servicio'

@description('Name of the action group that sends email notifications.')
param actionGroupName string = 'ag-caudal-servicio'

@description('Denials per 5 minutes that count as a sustained degradation.')
param denialSurgeThreshold int = 50

@description('Tags to apply to resources.')
param tags object = {}

var trimmedWebhookUri = trim(webhookUri)

// Cruce de umbral: el backend ya deduplica una anotación por ventana y clase,
// así que cualquier fila es un aviso que vale la pena mandar.
var thresholdQuery = '''
AppEvents
| where Name == "CaudalEvent"
| where TimeGenerated >= ago(5m)
| where tostring(Properties.kind) == "threshold"
| extend caudalClass = tostring(Properties.caudalClass), reason = tostring(Properties.reason), route = tostring(Properties.route), used = todouble(Measurements.used), limit = todouble(Measurements.limit)
| project TimeGenerated, caudalClass, reason, route, used, limit
'''

// Denegaciones sostenidas: una ráfaga que no afloja en cinco minutos ya no es
// una persona apurada, es el servicio en su tope.
var denialSurgeQueryTemplate = '''
AppEvents
| where Name == "CaudalEvent"
| where TimeGenerated >= ago(5m)
| where tostring(Properties.kind) == "denial"
| extend caudalClass = tostring(Properties.caudalClass), reason = tostring(Properties.reason)
| summarize denials = count() by caudalClass, reason
| where denials >= {threshold}
| project caudalClass, reason, denials
'''

var denialSurgeQuery = replace(denialSurgeQueryTemplate, '{threshold}', format('{0}', denialSurgeThreshold))

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'CaudalAlert'
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

resource caudalThresholdRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: scheduledQueryRuleName
  location: location
  tags: tags
  properties: {
    description: 'Triggers when the service-wide request rate crosses the reserved threshold (CaudalEvent kind=threshold).'
    displayName: 'Caudal del servicio sobre el umbral'
    severity: 2
    enabled: true
    scopes: [
      workspaceId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: thresholdQuery
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          dimensions: [
            {
              name: 'caudalClass'
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

resource caudalDenialSurgeRule 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${scheduledQueryRuleName}-denegaciones'
  location: location
  tags: tags
  properties: {
    description: 'Triggers when the service denies ${denialSurgeThreshold} or more requests in 5 minutes (CaudalEvent kind=denial).'
    displayName: 'Denegaciones de caudal sostenidas'
    severity: 2
    enabled: true
    scopes: [
      workspaceId
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: denialSurgeQuery
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          dimensions: [
            {
              name: 'reason'
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
