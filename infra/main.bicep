/*
  main.bicep — Orquestador principal de infraestructura
  Dashboard Educativo Inteligente — UADE Pilot

  Arquitectura Serverless (sin VM quota):
    - Frontend: Azure Static Web Apps (Free tier, CDN global)
    - Backend:  Azure Functions Consumption Plan Y1 (pago por ejecución)
    - IA:       Azure OpenAI (ya provisionado por UADE como RS-OPENAI-LLM)

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

@description('Región para Azure OpenAI. eastus2 tiene quota de gpt-4o-mini en UADE.')
param openAiLocation string = 'eastus2'

@description('SKU del recurso Azure OpenAI.')
param openAiSkuName string = 'S0'

@description('Nombre del modelo GPT a deployar.')
param gptModelName string = 'gpt-4o-mini'

@description('Versión del modelo GPT.')
param gptModelVersion string = '2024-07-18'

@description('Capacidad del deployment GPT en miles de TPM.')
param gptDeploymentCapacity int = 10

@description('Nombre del modelo de embeddings a deployar.')
param embeddingModelName string = 'text-embedding-3-small'

@description('Versión del modelo de embeddings.')
param embeddingModelVersion string = '1'

@description('Capacidad del deployment de embeddings en miles de TPM.')
param embeddingDeploymentCapacity int = 10

// Reservado para cuando UADE otorgue permisos roleAssignments/write
// #disable-next-line no-unused-params
// @description('Object ID del usuario que ejecuta azd provision (para permisos KV en el futuro).')
@description('Pinecone API Key (Plan B)')
@secure()
param pineconeApiKey string = ''

@description('Location for the Static Web App. Note: limited region availability.')
param staticWebAppLocation string = 'eastus2'

@description('Name of the Pinecone index.')
param pineconeIndexName string = 'dashboard-edu-pilot'

@description('Name of the Storage container for class materials.')
param classMaterialsContainerName string = 'class-materials'

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
var identityName = 'id-dashboard-edu-${resourceToken}'

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
    pineconeApiKey: pineconeApiKey
    tags: tags
  }
}

// ─── Module: Identity & RBAC ─────────────────────────────────────
module identity './modules/identity.bicep' = {
  name: 'identity'
  params: {
    identityName: identityName
    location: location
    openAiAccountId: openAi.outputs.id
    storageAccountId: storage.outputs.accountId
    keyVaultId: keyVault.outputs.keyVaultId
  }
}

// ─── Module: Azure Functions (Consumption Plan — sin VM quota) ────
// Plan Y1/Dynamic: pago por ejecución, escala a 0, sin reserva de VM.
module functions './modules/functions.bicep' = {
  name: 'functions'
  params: {
    location: location
    functionAppName: functionAppName
    userAssignedIdentityId: identity.outputs.identityId
    userAssignedClientId: identity.outputs.clientId
    storageAccountName: safeStorageName
    appInsightsConnectionString: appInsights.outputs.connectionString
    openAiEndpoint: openAi.outputs.endpoint
    openAiChatDeployment: openAi.outputs.chatDeploymentName
    openAiEmbeddingDeployment: openAi.outputs.embeddingDeploymentName
    classMaterialsStorageAccount: safeStorageName
    keyVaultUri: keyVault.outputs.keyVaultUri
    pineconeApiKey: pineconeApiKey
    pineconeIndexName: pineconeIndexName
    classMaterialsContainerName: classMaterialsContainerName
    storageAccountId: storage.outputs.accountId
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

// ─── Outputs ────────────────────────────────────────────────────
output AZURE_OPENAI_ENDPOINT string = openAi.outputs.endpoint
output AZURE_OPENAI_CHAT_DEPLOYMENT string = openAi.outputs.chatDeploymentName
output AZURE_OPENAI_EMBEDDING_DEPLOYMENT string = openAi.outputs.embeddingDeploymentName
output AZURE_STORAGE_ACCOUNT_NAME string = storage.outputs.accountName
output AZURE_STORAGE_CONTAINER_MATERIALS string = storage.outputs.classMaterialsContainerName
output AZURE_KEY_VAULT_URI string = keyVault.outputs.keyVaultUri
output AZURE_FUNCTION_APP_URI string = functions.outputs.functionAppUri
output APPLICATIONINSIGHTS_CONNECTION_STRING string = appInsights.outputs.connectionString
output AZURE_STATIC_WEB_APP_URI string = staticWebApp.outputs.staticWebAppUri
output AZURE_RESOURCE_GROUP string = resourceGroup().name
