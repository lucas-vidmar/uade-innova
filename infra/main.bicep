/*
  main.bicep — Orquestador principal de infraestructura
  Dashboard Educativo Inteligente — UADE Pilot

  Provisiona todos los recursos Azure en el orden correcto.

  Uso:
    azd provision                    → deploya todo
    azd env get-values               → muestra outputs como env vars
*/

targetScope = 'subscription'

// ─── Parameters ─────────────────────────────────────────────────
@minLength(1)
@maxLength(64)
@description('Nombre del entorno azd (ej: pilot-dev, pilot-prod).')
param environmentName string

@minLength(1)
@description('Región Azure primaria para todos los recursos.')
param location string

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

@description('SKU del App Service Plan. F1 (Free) es el tier que tiene quota en la suscripción UADE.')
param appServiceSkuName string = 'F1'

@description('Object ID del usuario que ejecuta azd provision (para permisos KV).')
param principalId string = ''

// ─── Variables & naming ──────────────────────────────────────────
var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
  project: 'dashboard-educativo-uade'
  environment: environmentName
}

// Nombres de recursos
var resourceGroupName = '${abbrs.resourcesResourceGroups}dashboard-estudio-pilot'
var openAiName = '${abbrs.cognitiveServicesAccounts}dashboard-${resourceToken}'
var storageAccountName = '${abbrs.storageStorageAccounts}dashboard${resourceToken}'
var functionAppName = '${abbrs.webSitesFunctions}dashboard-ingest-${resourceToken}'
var appServiceName = '${abbrs.webSitesAppService}dashboard-${resourceToken}'
var sharedPlanName = '${abbrs.webServerFarms}dashboard-${resourceToken}'
var logAnalyticsName = '${abbrs.operationalInsightsWorkspaces}dashboard-${resourceToken}'
var appInsightsName = '${abbrs.insightsComponents}dashboard-${resourceToken}'
// KV: 3-24 alphanumeric + hyphens, start with letter, end with letter/digit
var keyVaultName = 'kv-edu-${take(resourceToken, 17)}'

// Storage account: max 24 chars, no hyphens
var safeStorageName = take(replace(storageAccountName, '-', ''), 24)

// ─── Resource Group ──────────────────────────────────────────────
resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// ─── Module: Application Insights ───────────────────────────────
module appInsights './modules/appinsights.bicep' = {
  name: 'appInsights'
  scope: rg
  params: {
    location: location
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    tags: tags
  }
}

// ─── Module: Azure OpenAI ────────────────────────────────────────
// Deployed in openAiLocation (eastus2) — has quota in UADE subscription
module openAi './modules/openai.bicep' = {
  name: 'openAi'
  scope: rg
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
  scope: rg
  params: {
    location: location
    name: safeStorageName
    tags: tags
  }
}

// ─── Module: Key Vault ────────────────────────────────────────────
module keyVault './modules/keyvault.bicep' = {
  name: 'keyVault'
  scope: rg
  params: {
    location: location
    name: keyVaultName
    principalId: principalId
    tags: tags
  }
}

// ─── Module: Shared App Service Plan ─────────────────────────────
// Single B1 Linux plan shared by App Service + Function App.
// UADE subscription has quota for 1 Basic VM — sharing avoids the limit.
module sharedPlan './modules/plan.bicep' = {
  name: 'sharedPlan'
  scope: rg
  params: {
    location: location
    name: sharedPlanName
    skuName: appServiceSkuName
    tags: tags
  }
}

// ─── Module: App Service (frontend host) ─────────────────────────
module appService './modules/appservice.bicep' = {
  name: 'appService'
  scope: rg
  params: {
    location: location
    appServiceName: appServiceName
    appInsightsConnectionString: appInsights.outputs.connectionString
    openAiEndpoint: openAi.outputs.endpoint
    openAiChatDeployment: openAi.outputs.chatDeploymentName
    openAiEmbeddingDeployment: openAi.outputs.embeddingDeploymentName
    apiBaseUrl: '/api'
    keyVaultUri: keyVault.outputs.keyVaultUri
    sharedServerFarmId: sharedPlan.outputs.serverFarmId
    tags: tags
  }
}

// ─── Module: Azure Functions (backend RAG pipeline) ───────────────
module functions './modules/functions.bicep' = {
  name: 'functions'
  scope: rg
  params: {
    location: location
    functionAppName: functionAppName
    storageAccountName: safeStorageName
    appInsightsConnectionString: appInsights.outputs.connectionString
    openAiEndpoint: openAi.outputs.endpoint
    openAiChatDeployment: openAi.outputs.chatDeploymentName
    openAiEmbeddingDeployment: openAi.outputs.embeddingDeploymentName
    classMaterialsStorageAccount: safeStorageName
    keyVaultUri: keyVault.outputs.keyVaultUri
    sharedServerFarmId: sharedPlan.outputs.serverFarmId
    tags: tags
  }
}

// ─── Module: Identity & RBAC ─────────────────────────────────────
module identity './modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    functionAppPrincipalId: functions.outputs.functionAppPrincipalId
    appServicePrincipalId: appService.outputs.appServicePrincipalId
    openAiAccountId: openAi.outputs.id
    storageAccountId: storage.outputs.accountId
    keyVaultId: keyVault.outputs.keyVaultId
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
output AZURE_APP_SERVICE_URI string = appService.outputs.appServiceUri
output AZURE_RESOURCE_GROUP string = rg.name
