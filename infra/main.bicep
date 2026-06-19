/*
  main.bicep — Orquestador principal de infraestructura
  Dashboard Educativo Inteligente — UADE Pilot

  Arquitectura Serverless (sin VM quota):
    - Frontend: Azure Static Web Apps (Free tier, CDN global)
    - Backend:  Azure Functions Consumption Plan Y1 (pago por ejecución)
    - IA:       Azure OpenAI (Embeddings & Fallback) + Azure AI Foundry (DeepSeek)

  targetScope = 'resourceGroup' — deploya dentro de RG_UADE_INNOVA_DEV
  sin requerir permisos a nivel suscripción.

  Uso:
    azd provision                    → deploya toda la infra
    azd env get-values               → muestra outputs como env vars
*/

targetScope = 'resourceGroup'

// ─── Parameters ─────────────────────────────────────────────────
@minLength(1)
@maxLength(64)
@description('Nombre del entorno azd (ej: uade-dev).')
param environmentName string

@minLength(1)
@description('Región Azure primaria para todos los recursos.')
param location string = resourceGroup().location

@description('Región para Azure OpenAI (Embeddings & Fallback). eastus2 tiene quota de gpt-4o-mini en UADE.')
param openAiLocation string = 'eastus2'

@description('SKU del recurso Azure OpenAI.')
param openAiSkuName string = 'S0'

@description('Nombre del modelo GPT a deployar en Azure OpenAI (Fallback).')
param gptModelName string = 'gpt-4.1-mini'

@description('Versión del modelo GPT.')
param gptModelVersion string = '2025-04-14'

@description('Capacidad del deployment GPT en miles de TPM.')
param gptDeploymentCapacity int = 10

@description('Nombre del modelo de embeddings a deployar.')
param embeddingModelName string = 'text-embedding-3-small'

@description('Versión del modelo de embeddings.')
param embeddingModelVersion string = '1'

@description('Capacidad del deployment de embeddings en miles de TPM.')
param embeddingDeploymentCapacity int = 10

@description('Location for the Static Web App. Note: limited region availability.')
param staticWebAppLocation string = 'eastus2'

@description('Name of the Pinecone vector index.')
param vectorIndexName string = 'dashboard-edu-pilot'

@description('Pinecone environment (optional when PINECONE_HOST is provided).')
param pineconeEnvironment string = ''

@description('Pinecone data-plane host (optional but recommended).')
param pineconeHost string = ''

@description('Key Vault secret name that stores the Pinecone API key.')
param pineconeApiKeySecretName string = 'PINECONE-API-KEY'

@description('Name of the Storage container for class materials.')
param classMaterialsContainerName string = 'class-materials'

@description('Monto total del presupuesto mensual.')
param budgetAmount int = 100

@description('Lista de correos para notificaciones de presupuesto.')
param notificationEmail string = ''

@secure()
@description('Client ID of the Entra ID app registration for Microsoft Graph API (Teams notifications).')
param graphApiClientId string

@secure()
@description('Client secret of the Entra ID app registration for Microsoft Graph API.')
param graphApiClientSecret string

@description('Tenant ID for Microsoft Graph API. Defaults to the subscription\'s tenant ID.')
param graphApiTenantId string = subscription().tenantId

// ─── Variables & naming ──────────────────────────────────────────
var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
  project: 'dashboard-educativo-uade'
  environment: environmentName
}

// Nombres de recursos
var openAiName = '${abbrs.cognitiveServicesAccounts}dashboard-${resourceToken}'
var storageAccountName = '${abbrs.storageStorageAccounts}dashboard${resourceToken}'
var functionAppName = '${abbrs.webSitesFunctions}dashboard-ingest-${resourceToken}'
var staticWebAppName = 'stapp-dashboard-${resourceToken}'
var logAnalyticsName = '${abbrs.operationalInsightsWorkspaces}dashboard-${resourceToken}'
var appInsightsName = '${abbrs.insightsComponents}dashboard-${resourceToken}'
var keyVaultName = 'kv-edu-${take(resourceToken, 17)}'

var frontDoorName = 'afd-dashboard-${resourceToken}'
var workbookName = guid(resourceGroup().id, 'cost-per-interaction-workbook')
var anomalousUsageAlertName = 'alert-anomalous-token-usage-${take(resourceToken, 8)}'
var anomalousUsageActionGroupName = 'ag-token-usage-${take(resourceToken, 8)}'

// SWA hostname is randomly generated (e.g., agreeable-beach-..., not the resource name).
// Use "*" during development; override in main.parameters.json for production.
var allowedCorsOrigins = ['*']

// Storage account: max 24 chars, no hyphens
var safeStorageName = take(replace(storageAccountName, '-', ''), 24)

// ─── Module: Application Insights ───────────────────────────────
module appInsights './modules/appinsights.bicep' = {
  name: 'appInsights'
  params: {
    location: location
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    tags: tags
  }
}

// ─── Module: Azure OpenAI ────────────────────────────────────────
// Deployed in openAiLocation (eastus2) — quota disponible en UADE
module openAi './modules/openai.bicep' = {
  name: 'openAi'
  params: {
    location: openAiLocation
    name: openAiName
    skuName: openAiSkuName
    gptModelName: gptModelName
    gptModelVersion: gptModelVersion
    gptDeploymentCapacity: gptDeploymentCapacity
    embeddingModelName: embeddingModelName
    embeddingModelVersion: embeddingModelVersion
    embeddingDeploymentCapacity: embeddingDeploymentCapacity
    tags: tags
  }
}

// ─── Module: Storage Account ──────────────────────────────────────
module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    name: safeStorageName
    tags: tags
  }
}

// ─── Module: Key Vault ────────────────────────────────────────────
module keyVault './modules/keyvault.bicep' = {
  name: 'keyVault'
  params: {
    location: location
    name: keyVaultName
    tags: tags
    graphApiClientId: graphApiClientId
    graphApiClientSecret: graphApiClientSecret
    graphApiTenantId: graphApiTenantId
  }
}

// ─── Storage Connection String in Key Vault ────────────────────
resource existingStorageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: safeStorageName
}

resource storageConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVaultName}/AZURE-STORAGE-CONNECTION-STRING'
  properties: {
    value: 'DefaultEndpointsProtocol=https;AccountName=${existingStorageAccount.name};AccountKey=${existingStorageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
  }
}

// ─── Module: Azure Functions (Consumption Plan — sin VM quota) ────
// Plan Y1/Dynamic: pago por ejecución, escala a 0, sin reserva de VM.
module functions './modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    functionAppName: functionAppName

    storageAccountName: safeStorageName
    appInsightsConnectionString: appInsights.outputs.connectionString
    openAiEndpoint: openAi.outputs.endpoint
    openAiChatDeployment: openAi.outputs.chatDeploymentName
    openAiEmbeddingDeployment: openAi.outputs.embeddingDeploymentName
    openAiTtsDeployment: openAi.outputs.ttsDeploymentName
    classMaterialsStorageAccount: safeStorageName
    pineconeIndexName: vectorIndexName
    pineconeEnvironment: pineconeEnvironment
    pineconeHost: pineconeHost
    pineconeApiKeySecretName: pineconeApiKeySecretName
    keyVaultUri: keyVault.outputs.keyVaultUri
    classMaterialsContainerName: classMaterialsContainerName
    materialsTableName: storage.outputs.materialsTableName
    classesTableName: storage.outputs.classesTableName
    enrollmentsTableName: storage.outputs.enrollmentsTableName
    storageAccountId: storage.outputs.accountId
    ingestionQueueName: storage.outputs.ingestionQueueName
    userConsentTableName: storage.outputs.userConsentTableName
    correctionsTableName: storage.outputs.correctionsTableName
    correctionsPendingTableName: storage.outputs.correctionsPendingTableName
    conversationsTableName: storage.outputs.conversationsTableName
    conversationRatingsTableName: storage.outputs.conversationRatingsTableName
    notificationPreferencesTableName: storage.outputs.notificationPreferencesTableName
    userEventsTableName: storage.outputs.userEventsTableName
    interventionsTableName: storage.outputs.interventionsTableName
    riskThresholdsTableName: storage.outputs.riskThresholdsTableName
    glossaryFilesContainerName: storage.outputs.glossaryFilesContainerName
    summariesContainerName: storage.outputs.summariesContainerName
    notificationQueueName: storage.outputs.notificationQueueName
    allowedCorsOrigins: allowedCorsOrigins
    tags: tags
  }
}

// ─── Module: Static Web App (frontend — sin VM quota) ─────────────
// Free tier: CDN global, SSL automático, 100 GB bandwidth/mes incluido.
module staticWebApp './modules/staticwebapp.bicep' = {
  name: 'staticWebApp'
  params: {
    location: staticWebAppLocation
    staticWebAppName: staticWebAppName
    openAiEndpoint: openAi.outputs.endpoint
    openAiChatDeployment: openAi.outputs.chatDeploymentName
    openAiEmbeddingDeployment: openAi.outputs.embeddingDeploymentName
    functionAppUri: functions.outputs.functionAppUri
    appInsightsConnectionString: appInsights.outputs.connectionString
    tags: tags
  }
}

// ─── Module: Azure Workbook (Cost-per-Interaction) ──────────────
module workbook './modules/workbook.bicep' = {
  name: 'workbook'
  params: {
    location: location
    workbookName: workbookName
    appInsightsId: appInsights.outputs.appInsightsId
    tags: tags
  }
}

// ─── Module: Anomalous Usage Alert (Issue #72) ───────────────────
module anomalousUsageAlert './modules/anomalous-usage-alert.bicep' = if (!empty(notificationEmail)) {
  name: 'anomalousUsageAlert'
  params: {
    location: location
    workspaceId: appInsights.outputs.logAnalyticsWorkspaceId
    notificationEmail: notificationEmail
    scheduledQueryRuleName: anomalousUsageAlertName
    actionGroupName: anomalousUsageActionGroupName
    subjectTokenThreshold: 500000
    tags: tags
  }
}

// // ─── Module: Azure Front Door (WAF) ───────────────────────────────
// // Proporciona protección OWASP y enrutamiento a los endpoints
// // DISABLED: Subscription not registered for Microsoft.Cdn
// module frontDoor './modules/frontdoor.bicep' = {
//   name: 'frontDoor'
//   params: {
//     profileName: frontDoorName
//     frontendHostName: staticWebApp.outputs.staticWebAppHostName
//     backendHostName: functions.outputs.functionAppHostName
//     tags: tags
//   }
// }

/*

/*
// ─── Module: Azure Budget (Issue #71) ─────────────────────────────
module budget './modules/budget.bicep' = {
  name: 'budget'
  params: {
    budgetAmount: budgetAmount
    contactEmails: !empty(notificationEmail) ? [ notificationEmail ] : []
  }
}
*/

// // ─── Front Door ID Secret in Key Vault ────────────────────────────
// // DISABLED: Front Door not deployed
// resource fdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
//   name: '${keyVaultName}/FRONT-DOOR-ID'
//   properties: {
//     value: frontDoor.outputs.frontDoorId
//   }
// }

// ─── Outputs ────────────────────────────────────────────────────
output AZURE_OPENAI_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_CHAT_DEPLOYMENT string = openAi.outputs.chatDeploymentName
output AZURE_OPENAI_EMBEDDING_DEPLOYMENT string = openAi.outputs.embeddingDeploymentName
output AZURE_OPENAI_TTS_DEPLOYMENT string = openAi.outputs.ttsDeploymentName
output AZURE_STORAGE_ACCOUNT_NAME string = storage.outputs.accountName
output AZURE_STORAGE_CONTAINER_MATERIALS string = storage.outputs.classMaterialsContainerName
output PINECONE_INDEX_NAME string = vectorIndexName
output PINECONE_ENVIRONMENT string = pineconeEnvironment
output PINECONE_HOST string = pineconeHost
output AZURE_KEY_VAULT_URI string = keyVault.outputs.keyVaultUri
output AZURE_FUNCTION_APP_URI string = functions.outputs.functionAppUri
output APPLICATIONINSIGHTS_CONNECTION_STRING string = appInsights.outputs.connectionString
output AZURE_STATIC_WEB_APP_URI string = staticWebApp.outputs.staticWebAppUri
// output AZURE_FRONT_DOOR_URI string = ''  // Disabled - CDN not registered
output AZURE_RESOURCE_GROUP string = resourceGroup().name
