/*
  identity.bicep — RBAC Role Assignments
  Grants Managed Identities least-privilege access to Azure resources.
  No resources created here — only roleAssignment objects.
*/

@description('Name of the User-Assigned Managed Identity.')
param identityName string

@description('Azure region.')
param location string

@description('Resource ID of the Azure OpenAI account.')
param openAiAccountId string

@description('Resource ID of the Storage Account.')
param storageAccountId string

@description('Resource ID of the Key Vault.')
param keyVaultId string

// Parse resource names from their fully qualified resource IDs
var openAiAccountName = last(split(openAiAccountId, '/'))
var storageAccountName = last(split(storageAccountId, '/'))
var keyVaultName = last(split(keyVaultId, '/'))

// ─── Existing Resources for Scoping ──────────────────────────────
resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
  name: openAiAccountName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: storageAccountName
}

resource keyVault 'Microsoft.KeyVault/vaults@2022-07-01' existing = {
  name: keyVaultName
}

// ─── Role Definition IDs (Azure built-in) ──────────────────────
// Cognitive Services OpenAI User
var cognitiveServicesOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
// Storage Blob Data Contributor
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
// Key Vault Secrets User
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

// ─── User-Assigned Managed Identity ────────────────────────────
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

var identityPrincipalId = managedIdentity.properties.principalId

// ─── Function App: Cognitive Services OpenAI User ──────────────
resource funcOpenAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAiAccountId, managedIdentity.id, cognitiveServicesOpenAiUserRoleId)
  scope: openAiAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAiUserRoleId
    )
    principalId: identityPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Allows Function App to call Azure OpenAI via Managed Identity'
  }
}

// ─── Function App: Storage Blob Data Contributor ───────────────
resource funcStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccountId, managedIdentity.id, storageBlobDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      storageBlobDataContributorRoleId
    )
    principalId: identityPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Allows Function App to read/write class materials in Blob Storage'
  }
}

// ─── Function App: Key Vault Secrets User ──────────────────────
resource funcKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultId, managedIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: identityPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Allows Function App to read Pinecone API Key from Key Vault'
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The resource ID of the User-Assigned Managed Identity.')
output identityId string = managedIdentity.id

@description('The principal ID of the User-Assigned Managed Identity.')
output principalId string = managedIdentity.properties.principalId

@description('The client ID of the User-Assigned Managed Identity.')
output clientId string = managedIdentity.properties.clientId

