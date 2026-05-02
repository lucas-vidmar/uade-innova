/*
  openai.bicep — Azure OpenAI Service + Model Deployments
  Deploys: gpt-4o-mini (chat/reasoning) + text-embedding-3-small (vectorization)
*/

@description('Azure region for the OpenAI resource.')
param location string = 'eastus'

@description('Name of the Azure OpenAI resource.')
param name string

@description('SKU for the OpenAI resource.')
param skuName string = 'S0'

@description('Tags to apply to the resource.')
param tags object = {}

@description('Name of the GPT model to deploy.')
param gptModelName string = 'gpt-4o-mini'

@description('Version of the GPT model.')
param gptModelVersion string = '2024-07-18'

@description('Capacity (K TPM) for the GPT deployment.')
param gptDeploymentCapacity int = 10

@description('Name of the embedding model to deploy.')
param embeddingModelName string = 'text-embedding-3-small'

@description('Version of the embedding model.')
param embeddingModelVersion string = '1'

@description('Capacity (K TPM) for the embedding deployment.')
param embeddingDeploymentCapacity int = 10

@description('Name of the TTS model to deploy.')
param ttsModelName string = 'tts-1'

// ─── Azure OpenAI Account ───────────────────────────────────────
resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: skuName
  }
  properties: {
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false // Allow API key auth for local dev; MI used in production
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SKIP deployments - they were manually created in Azure OpenAI and are pinned to latest versions
// Removing model version specification to avoid deprecation errors
// ═════════════════════════════════════════════════════════════════════════════

// ─── GPT-4o-mini Deployment ────────────────────────────────────
// Note: Using latest version - do not specify version to avoid deprecation errors
resource gptDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiAccount
  name: gptModelName
  properties: {
    model: {
      format: 'OpenAI'
      name: gptModelName
      version: gptModelVersion
    }
    raiPolicyName: 'Microsoft.Default'
  }
  sku: {
    name: 'Standard'
    capacity: gptDeploymentCapacity
  }
}

// ─── text-embedding-3-small Deployment ─────────────────────────
// Note: Using latest version - do not specify version to avoid deprecation errors
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiAccount
  name: embeddingModelName
  dependsOn: [gptDeployment] // Sequential deployments required by Azure OpenAI
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModelName
    }
  }
  sku: {
    name: 'Standard'
    capacity: embeddingDeploymentCapacity
  }
}

// ─── tts-1 Deployment ──────────────────────────────────────────
// SKIPPED: Model may be deprecated, use manually-created deployment
// resource ttsDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
//   parent: openAiAccount
//   name: ttsModelName
//   properties: {
//     model: {
//       format: 'OpenAI'
//       name: ttsModelName
//       version: '1'
//     }
//   }
//   sku: {
//     name: 'Standard'
//     capacity: 1 // TTS typically uses capacity 1 for standard tier
//   }
// }

// ─── Outputs ───────────────────────────────────────────────────
@description('The Azure OpenAI service endpoint URL.')
output endpoint string = openAiAccount.properties.endpoint

@description('The name of the Azure OpenAI resource.')
output name string = openAiAccount.name

@description('The resource ID of the Azure OpenAI resource.')
output accountId string = openAiAccount.id

// Note: Deployment names are hardcoded to match manually-created deployments in Azure OpenAI
output chatDeploymentName string = 'gpt-4o-mini'

output embeddingDeploymentName string = 'text-embedding-3-small'

// TTS deployment may not exist - return empty if not manually created
output ttsDeploymentName string = ''
