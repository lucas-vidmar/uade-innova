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

@description('Azure OpenAI TTS model deployment name.')
param openAiTtsDeployment string

@description('Azure Storage account name for class materials.')
param classMaterialsStorageAccount string

@description('Pinecone index name for vectors.')
param pineconeIndexName string = 'dashboard-edu-pilot'

@description('Pinecone environment (optional when host is provided).')
param pineconeEnvironment string = ''

@description('Pinecone host endpoint (optional but recommended).')
param pineconeHost string = ''

@description('Key Vault secret name that stores the Pinecone API key.')
param pineconeApiKeySecretName string = 'PINECONE-API-KEY'

@description('Key Vault URI.')
param keyVaultUri string

@description('Resource ID of the Storage account.')
param storageAccountId string

@description('Tags to apply to resources.')
param tags object = {}

@description('Name of the Storage container for class materials.')
param classMaterialsContainerName string = 'class-materials'

@description('Name of the ingestion tasks queue for Queue-triggered functions.')
param ingestionQueueName string = 'ingestion-tasks'

@description('Allowed CORS origin (e.g., https://myapp.azurestaticapps.net). Use "*" only during development.')
param allowedCorsOrigin string = '*'



@description('Table name for material state entities.')
param materialsTableName string = 'materials'

@description('Table name for class state entities.')
param classesTableName string = 'classes'

@description('Table name for enrollment entities.')
param enrollmentsTableName string = 'Enrollments'

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
    type: 'SystemAssigned'  // Using System-Assigned for simplified deployment
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
      ipSecurityRestrictions: []
      scmIpSecurityRestrictionsUseMain: true
      cors: {
        allowedOrigins: [ allowedCorsOrigin ]
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
        // Azure OpenAI — Uses Managed Identity + RBAC (no API key needed)
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
          name: 'AZURE_OPENAI_TTS_DEPLOYMENT'
          value: openAiTtsDeployment
        }
        // Storage — Uses Managed Identity + RBAC (no access key in App Settings)
        {
          name: 'AZURE_STORAGE_ACCOUNT_NAME'
          value: classMaterialsStorageAccount
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_MATERIALS'
          value: classMaterialsContainerName
        }
        {
          name: 'AZURE_TABLE_MATERIALS'
          value: materialsTableName
        }
        {
          name: 'AZURE_TABLE_CLASSES'
          value: classesTableName
        }
        {
          name: 'AZURE_TABLE_ENROLLMENTS'
          value: enrollmentsTableName
        }
        {
          name: 'AZURE_STORAGE_ENROLLMENTS_TABLE'
          value: enrollmentsTableName
        }
        // Pinecone vector store
        {
          name: 'PINECONE_INDEX_NAME'
          value: pineconeIndexName
        }
        {
          name: 'PINECONE_ENVIRONMENT'
          value: pineconeEnvironment
        }
        {
          name: 'PINECONE_HOST'
          value: pineconeHost
        }
        {
          name: 'PINECONE_API_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/${pineconeApiKeySecretName}/)'
        }
        {
          name: 'NODE_ENV'
          value: 'production'
        }

        {
          name: 'SWA_ROLES_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/SWA-ROLES-SECRET/)'
        }
        {
          name: 'FRONT_DOOR_ID'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/FRONT-DOOR-ID/)'
        }
        // Storage Queue for async processing
        {
          name: 'AZURE_STORAGE_QUEUE_INGESTION'
          value: ingestionQueueName
        }
      ]
    }
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the Function App.')
output functionAppName string = functionApp.name

// @description('The principal ID of the Function App Managed Identity.')
// output functionAppPrincipalId string = functionApp.identity.principalId

@description('The default hostname of the Function App.')
output functionAppHostName string = functionApp.properties.defaultHostName

@description('The full URI of the Function App.')
output functionAppUri string = 'https://${functionApp.properties.defaultHostName}'

@description('The resource ID of the Function App.')
output functionAppId string = functionApp.id
