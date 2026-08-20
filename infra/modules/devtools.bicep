/*
  devtools.bicep — Azure AI Services (AIServices-kind) for Dev Tooling (opencode)
  Deploys a SEPARATE AIServices resource dedicated to developer tooling (opencode),
  distinct from the platform's aiservices-dashboard. This lets budgets be tracked
  independently by resource in Azure Cost Management.

  Deploys: deepseek-v4-flash (Serverless MaaS / GlobalStandard)
*/

@description('Azure region for the dev-tooling AIServices resource.')
param location string = 'eastus2'

@description('Name of the AIServices resource (e.g. "aiservices-devtools").')
param name string

@description('SKU for the AIServices resource.')
param skuName string = 'S0'

@description('Tags to apply to the resource.')
param tags object = {}

@description('Flash deployment name (must match opencode model id).')
param flashDeploymentName string = 'deepseek-v4-flash'

@description('Flash model name in the catalog.')
param flashModelName string = 'DeepSeek-V4-Flash-0731'

@description('Flash model version.')
param flashModelVersion string = '2026-07-31'

@description('Flash deployment SKU (GlobalStandard for serverless MaaS).')
param flashSkuName string = 'GlobalStandard'

@description('Flash deployment capacity (in thousands of TPM).')
param flashCapacity int = 500

// ─── AIServices Account (kind AIServices) ────────────────────────
resource aiServicesAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: union(tags, { purpose: 'dev-tooling' })
  kind: 'AIServices'
  sku: {
    name: skuName
  }
  properties: {
    customSubDomainName: name
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false // API key auth (opencode uses api-key header)
  }
}

// ─── DeepSeek V4 Flash Deployment (Serverless MaaS) ─────────────
resource flashDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: aiServicesAccount
  name: flashDeploymentName
  properties: {
    model: {
      format: 'DeepSeek'
      name: flashModelName
      version: flashModelVersion
    }
    raiPolicyName: 'Microsoft.Default'
  }
  sku: {
    name: flashSkuName
    capacity: flashCapacity
  }
}

// ─── Outputs ────────────────────────────────────────────────────
@description('The dev-tooling AIServices endpoint URL.')
output endpoint string = aiServicesAccount.properties.endpoint

@description('The name of the dev-tooling AIServices resource.')
output name string = aiServicesAccount.name

@description('The resource ID of the dev-tooling AIServices resource.')
output accountId string = aiServicesAccount.id

@description('Primary API key of the dev-tooling AIServices account.')
output primaryKey string = aiServicesAccount.listKeys().key1

@description('Flash deployment name.')
output flashDeploymentName string = flashDeploymentName
