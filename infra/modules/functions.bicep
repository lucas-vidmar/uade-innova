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

@description('List of allowed CORS origins (e.g., ["https://myapp.azurestaticapps.net"]). Default "*" allows all origins during development.')
param allowedCorsOrigins array = ['*']



@description('Table name for material state entities.')
param materialsTableName string = 'materials'

@description('Table name for class state entities.')
param classesTableName string = 'classes'

@description('Table name for enrollment entities.')
param enrollmentsTableName string = 'Enrollments'

@description('Table name for user consent records.')
param userConsentTableName string = 'UserConsent'

@description('Table name for verified answer corrections.')
param correctionsTableName string = 'Corrections'

@description('Table name for pending correction index.')
param correctionsPendingTableName string = 'CorrectionsPending'

@description('Table name for saved conversation threads.')
param conversationsTableName string = 'Conversations'

@description('Table name for conversation ratings.')
param conversationRatingsTableName string = 'ConversationRatings'

@description('Table name for notification preferences.')
param notificationPreferencesTableName string = 'NotificationPreferences'

@description('Table name for user activity events.')
param userEventsTableName string = 'UserEvents'

@description('Table name for intervention records.')
param interventionsTableName string = 'Interventions'

@description('Table name for per-subject risk thresholds.')
param riskThresholdsTableName string = 'RiskThresholds'

@description('Name of the glossary-files blob container.')
param glossaryFilesContainerName string = 'glossary-files'

@description('Name of the summaries blob container.')
param summariesContainerName string = 'summaries'

@description('Name of the notification dispatch queue.')
param notificationQueueName string = 'notification-queue'

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
        allowedOrigins: allowedCorsOrigins
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
        // Azure Resource Management (Storage Lifecycle Drift Detection)
        {
          name: 'AZURE_SUBSCRIPTION_ID'
          value: subscription().subscriptionId
        }
        {
          name: 'AZURE_RESOURCE_GROUP_NAME'
          value: resourceGroup().name
        }
        // Storage — Uses Connection String for data-plane operations
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};AccountKey=${listKeys(storageAccountId, '2023-01-01').keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
        }
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
        // Vector backup scheduler
        {
          name: 'VECTOR_BACKUP_WINDOW_CRON'
          value: '0 0 3 * * *'
        }
        // Vector health monitor (Issue #150)
        {
          name: 'VECTOR_HEALTH_ALERT_CRON'
          value: '0 */15 * * * *'
        }
        {
          name: 'VECTOR_HEALTH_FULLNESS_THRESHOLD'
          value: '0.80'
        }
        {
          name: 'VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER'
          value: '3'
        }
        {
          name: 'VECTOR_HEALTH_DEDUP_WINDOW_MINUTES'
          value: '60'
        }
        // Graph API (Teams notifications)
        {
          name: 'GRAPH_API_CLIENT_ID'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-CLIENT-ID/)'
        }
        {
          name: 'GRAPH_API_CLIENT_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-CLIENT-SECRET/)'
        }
        {
          name: 'GRAPH_API_TENANT_ID'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-TENANT-ID/)'
        }
        // Storage Queue for async processing
        {
          name: 'AZURE_STORAGE_QUEUE_INGESTION'
          value: ingestionQueueName
        }
        {
          name: 'AZURE_STORAGE_QUEUE_NOTIFICATION'
          value: notificationQueueName
        }
        // Table names for Epics 3-7
        {
          name: 'AZURE_TABLE_USER_CONSENT'
          value: userConsentTableName
        }
        {
          name: 'AZURE_TABLE_CORRECTIONS'
          value: correctionsTableName
        }
        {
          name: 'AZURE_TABLE_CORRECTIONS_PENDING'
          value: correctionsPendingTableName
        }
        {
          name: 'AZURE_TABLE_CONVERSATIONS'
          value: conversationsTableName
        }
        {
          name: 'AZURE_TABLE_CONVERSATION_RATINGS'
          value: conversationRatingsTableName
        }
        {
          name: 'AZURE_TABLE_NOTIFICATION_PREFERENCES'
          value: notificationPreferencesTableName
        }
        {
          name: 'AZURE_TABLE_USER_EVENTS'
          value: userEventsTableName
        }
        {
          name: 'AZURE_TABLE_INTERVENTIONS'
          value: interventionsTableName
        }
        {
          name: 'AZURE_TABLE_RISK_THRESHOLDS'
          value: riskThresholdsTableName
        }
        // Blob container names
        {
          name: 'AZURE_STORAGE_CONTAINER_GLOSSARY'
          value: glossaryFilesContainerName
        }
        {
          name: 'AZURE_STORAGE_CONTAINER_SUMMARIES'
          value: summariesContainerName
        }
        {
          name: 'DIRECTOR_BUDGET_MONTHLY_USD'
          value: '10000'
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
