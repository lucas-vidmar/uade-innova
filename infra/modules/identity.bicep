/*
  identity.bicep — RBAC Role Assignments
  Grants Managed Identities least-privilege access to Azure resources.
  No resources created here — only roleAssignment objects.
*/

@description('Principal ID of the Azure Functions Managed Identity.')
param functionAppPrincipalId string

@description('Resource ID of the Azure OpenAI account.')
param openAiAccountId string

@description('Resource ID of the Storage Account.')
param storageAccountId string

@description('Resource ID of the Key Vault.')
param keyVaultId string

// ─── Role Definition IDs (Azure built-in) ──────────────────────
// Cognitive Services OpenAI User
var cognitiveServicesOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
// Storage Blob Data Contributor
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
// Key Vault Secrets User
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

// ─── Function App: Cognitive Services OpenAI User ──────────────
resource funcOpenAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAiAccountId, functionAppPrincipalId, cognitiveServicesOpenAiUserRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAiUserRoleId
    )
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Allows Function App to call Azure OpenAI via Managed Identity'
  }
}

// ─── Function App: Storage Blob Data Contributor ───────────────
resource funcStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountId, functionAppPrincipalId, storageBlobDataContributorRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      storageBlobDataContributorRoleId
    )
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Allows Function App to read/write class materials in Blob Storage'
  }
}

// ─── Function App: Key Vault Secrets User ──────────────────────
resource funcKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultId, functionAppPrincipalId, keyVaultSecretsUserRoleId)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Allows Function App to read Pinecone API Key from Key Vault'
  }
}

