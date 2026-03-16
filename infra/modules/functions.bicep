/*
  functions.bicep — Azure Functions App (True Consumption Plan / Serverless)
  Runtime: Node.js 20 on Linux
  Auth: System-Assigned Managed Identity (Zero-Trust)

  IMPORTANTE: Usa el plan Y1 (Consumption) real — no requiere VM quota.
  Escala a 0 cuando no hay tráfico. Primeros 1M ejecuciones/mes son gratis.
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

@description('Resource ID of the Storage account.')
param storageAccountId string

@description('Tags to apply to resources.')
param tags object = {}

@description('Name of the Pinecone index.')
param pineconeIndexName string = 'dashboard-edu-pilot'

@description('Name of the Storage container for class materials.')
param classMaterialsContainerName string = 'class-materials'

@description('Resource ID of the User-Assigned Managed Identity.')
param userAssignedIdentityId string

@description('Client ID of the User-Assigned Managed Identity.')
param userAssignedClientId string

// ─── Consumption Plan (Y1 — sin VM quota, serverless real) ───────
resource consumptionPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${functionAppName}-plan'
  location: location
  tags: tags
  sku: {
    name: 'Y1' // Consumption Plan — pago por ejecución, sin VM quota
    tier: 'Dynamic'
  }
  kind: 'functionapp'
  properties: {
    reserved: true // Linux
  }
}

// ─── Function App ────────────────────────────────────────────────
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  tags: union(tags, { 'azd-service-name': 'backend' })
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: consumptionPlan.id
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
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${listKeys(storageAccountId, '2023-01-01').keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
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
        {
          name: 'AzureWebJobsFeatureFlags'
          value: 'EnableWorkerIndexing'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        // Observability
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        // Azure OpenAI
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
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${listKeys(storageAccountId, '2023-01-01').keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
        // Storage
        {
          name: 'AZURE_STORAGE_ACCOUNT_NAME'
          value: classMaterialsStorageAccount
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_MATERIALS'
          value: classMaterialsContainerName
        }
        // Pinecone
        {
          name: 'PINECONE_API_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/pinecone-api-key/)'
        }
        {
          name: 'PINECONE_INDEX_NAME'
          value: pineconeIndexName
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'AZURE_CLIENT_ID'
          value: userAssignedClientId
        }
      ]
    }
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the Function App.')
output functionAppName string = functionApp.name

@description('The principal ID of the Function App Managed Identity.')
output functionAppPrincipalId string = functionApp.identity.principalId

@description('The default hostname of the Function App.')
output functionAppHostName string = functionApp.properties.defaultHostName

@description('The full URI of the Function App.')
output functionAppUri string = 'https://${functionApp.properties.defaultHostName}'

@description('The resource ID of the Function App.')
output functionAppId string = functionApp.id
