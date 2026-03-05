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

// ─── GPT-4o-mini Deployment ────────────────────────────────────
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
resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiAccount
  name: embeddingModelName
  dependsOn: [gptDeployment] // Sequential deployments required by Azure OpenAI
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModelName
      version: embeddingModelVersion
    }
  }
  sku: {
    name: 'Standard'
    capacity: embeddingDeploymentCapacity
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The Azure OpenAI service endpoint URL.')
output endpoint string = openAiAccount.properties.endpoint

@description('The name of the Azure OpenAI resource.')
output name string = openAiAccount.name

@description('The resource ID of the Azure OpenAI resource.')
output id string = openAiAccount.id

@description('The deployment name for the GPT chat model.')
output chatDeploymentName string = gptDeployment.name

@description('The deployment name for the embedding model.')
output embeddingDeploymentName string = embeddingDeployment.name
