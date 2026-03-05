/*
  functions.bicep — Azure Functions App (Consumption Plan)
  Runtime: Node.js 20 on Linux
  Auth: System-Assigned Managed Identity (Zero-Trust)
*/

@description('Azure region for resources.')
param location string

@description('Name of the Function App.')
param functionAppName string

@description('Name of the Storage Account required by the Function runtime.')
param storageAccountName string

@description('Application Insights connection string.')
param appInsightsConnectionString string

@description('Azure OpenAI endpoint.')
param openAiEndpoint string

@description('Azure OpenAI chat model deployment name.')
param openAiChatDeployment string

@description('Azure OpenAI embedding model deployment name.')
param openAiEmbeddingDeployment string

@description('Azure Storage account name for class materials.')
param classMaterialsStorageAccount string

@description('Key Vault URI.')
param keyVaultUri string

@description('Tags to apply to resources.')
param tags object = {}

@description('Optional: resource ID of an existing App Service Plan to reuse (avoids creating a new plan). If empty, creates a new B1 plan.')
param sharedServerFarmId string = ''

// ─── App Service Plan (only created if no shared plan is provided) ──
resource consumptionPlan 'Microsoft.Web/serverfarms@2023-01-01' = if (empty(sharedServerFarmId)) {
  name: '${functionAppName}-plan'
  location: location
  tags: tags
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

var effectiveServerFarmId = empty(sharedServerFarmId) ? consumptionPlan.id : sharedServerFarmId

// ─── Function App ────────────────────────────────────────────────
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'backend' })
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned' // Managed Identity — no hardcoded credentials
  }
  properties: {
    serverFarmId: effectiveServerFarmId
    reserved: true
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      functionAppScaleLimit: 10
      minimumElasticInstanceCount: 0
      use32BitWorkerProcess: false
      cors: {
        allowedOrigins: ['*']
        supportCredentials: false
      }
      appSettings: [
        // Runtime essentials
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        // Observability
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        // Azure OpenAI — endpoint only (auth via Managed Identity)
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
        // Storage
        {
          name: 'AZURE_STORAGE_ACCOUNT_NAME'
          value: classMaterialsStorageAccount
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_MATERIALS'
          value: 'class-materials'
        }
        // Key Vault reference for Pinecone API Key
        {
          name: 'PINECONE_API_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/pinecone-api-key/)'
        }
        {
          name: 'PINECONE_INDEX_NAME'
          value: 'dashboard-edu-pilot'
        }
        // Node environment
        {
          name: 'NODE_ENV'
          value: 'production'
        }
      ]
    }
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the Function App.')
output functionAppName string = functionApp.name

@description('The principal ID of the Function App\'s Managed Identity.')
output functionAppPrincipalId string = functionApp.identity.principalId

@description('The default hostname of the Function App.')
output functionAppUri string = 'https://${functionApp.properties.defaultHostName}'

@description('The resource ID of the Function App.')
output functionAppId string = functionApp.id
