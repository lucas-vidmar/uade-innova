/*
  appinsights.bicep — Log Analytics Workspace + Application Insights
  Used for observability, latency tracking, and FinOps cost-per-token monitoring.
*/

@description('Azure region for resources.')
param location string

@description('Name of the Log Analytics Workspace.')
param logAnalyticsName string

@description('Name of the Application Insights resource.')
param appInsightsName string

@description('Tags to apply to resources.')
param tags object = {}

// ─── Log Analytics Workspace ────────────────────────────────────
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

// ─── Application Insights ───────────────────────────────────────
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    RetentionInDays: 30
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('Application Insights connection string (injected as env var).')
output connectionString string = appInsights.properties.ConnectionString

@description('Application Insights instrumentation key (legacy, still needed by some SDKs).')
output instrumentationKey string = appInsights.properties.InstrumentationKey

@description('The resource name of Application Insights.')
output name string = appInsights.name

@description('The resource ID of the Log Analytics Workspace.')
output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id

@description('The resource ID of Application Insights component.')
output appInsightsId string = appInsights.id
