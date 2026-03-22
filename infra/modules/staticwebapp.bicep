/*
  staticwebapp.bicep — Azure Static Web Apps
  Hostea el frontend (React/Vite) como sitio estático serverless.
  - No requiere VM quota (serverless CDN)
  - Tier Free: 100 GB bandwidth/mes, SSL incluido, custom domain
  - Deploy vía GitHub Actions o azd
*/

@description('Azure region for the Static Web App.')
param location string = 'eastus2'

@description('Name of the Static Web App.')
param staticWebAppName string

@description('Azure OpenAI endpoint URL.')
param openAiEndpoint string

@description('Azure OpenAI chat model deployment name.')
param openAiChatDeployment string

@description('Azure OpenAI embedding model deployment name.')
param openAiEmbeddingDeployment string

@description('Azure Functions base URL for API calls.')
param functionAppUri string

@description('Application Insights connection string.')
param appInsightsConnectionString string

@description('Tags to apply to resources.')
param tags object = {}

// ─── Static Web App ──────────────────────────────────────────────
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'frontend' })
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// ─── App Settings (env vars expuestos al frontend) ───────────────
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    VITE_API_BASE_URL: '${functionAppUri}/api'
    VITE_AZURE_OPENAI_ENDPOINT: openAiEndpoint
    VITE_AZURE_OPENAI_CHAT_DEPLOYMENT: openAiChatDeployment
    VITE_AZURE_OPENAI_EMBEDDING_DEPLOYMENT: openAiEmbeddingDeployment
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the Static Web App.')
output staticWebAppName string = staticWebApp.name

@description('The default hostname of the Static Web App.')
output staticWebAppHostName string = staticWebApp.properties.defaultHostname

@description('The full URI of the Static Web App.')
output staticWebAppUri string = 'https://${staticWebApp.properties.defaultHostname}'

@description('The resource ID of the Static Web App.')
output staticWebAppId string = staticWebApp.id
