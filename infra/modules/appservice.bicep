/*
  appservice.bicep — Azure App Service (B1 Linux)
  Hosts the frontend web application.
  Auth: System-Assigned Managed Identity (Zero-Trust)
  Note: Plan is managed externally (modules/plan.bicep) and passed via sharedServerFarmId.
*/

@description('Azure region for resources.')
param location string

@description('Name of the App Service.')
param appServiceName string

@description('Resource ID of the shared App Service Plan.')
param sharedServerFarmId string

@description('Application Insights connection string.')
param appInsightsConnectionString string

@description('Azure OpenAI endpoint URL.')
param openAiEndpoint string

@description('Azure OpenAI chat model deployment name.')
param openAiChatDeployment string

@description('Azure OpenAI embedding model deployment name.')
param openAiEmbeddingDeployment string

@description('Azure Functions base URL for API calls.')
param apiBaseUrl string

@description('Key Vault URI.')
param keyVaultUri string

@description('Tags to apply to resources.')
param tags object = {}

// ─── Web App ─────────────────────────────────────────────────────
resource appService 'Microsoft.Web/sites@2023-01-01' = {
  name: appServiceName
  location: location
  tags: union(tags, { 'azd-service-name': 'frontend' })
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: sharedServerFarmId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appCommandLine: 'npm run preview -- --port 8080 --host 0.0.0.0'
      use32BitWorkerProcess: false
      webSocketsEnabled: true
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'AZURE_OPENAI_ENDPOINT'
          value: openAiEndpoint
        }
        {
          name: 'AZURE_OPENAI_CHAT_DEPLOYMENT'
          value: openAiChatDeployment
        }
        {
          name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT'
          value: openAiEmbeddingDeployment
        }
        {
          name: 'VITE_API_BASE_URL'
          value: apiBaseUrl
        }
        {
          name: 'PINECONE_API_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/pinecone-api-key/)'
        }
        {
          name: 'PINECONE_INDEX_NAME'
          value: 'dashboard-edu-pilot'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
      ]
    }
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the App Service.')
output appServiceName string = appService.name

@description('The principal ID of the App Service Managed Identity.')
output appServicePrincipalId string = appService.identity.principalId

@description('The public URL of the App Service.')
output appServiceUri string = 'https://${appService.properties.defaultHostName}'

@description('The resource ID of the App Service.')
output appServiceId string = appService.id
