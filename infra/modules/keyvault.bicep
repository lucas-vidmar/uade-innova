/*
  keyvault.bicep — Azure Key Vault
  Access controlled via RBAC (Key Vault Secrets User role).
*/

@description('Azure region for the Key Vault.')
param location string

@description('Name of the Key Vault (3-24 chars, globally unique).')
param name string

@description('Azure AD Tenant ID.')
param tenantId string = subscription().tenantId

@description('Tags to apply to the resource.')
param tags object = {}

@secure()
@description('Secret value for SWA_ROLES_SECRET — used to validate Static Web App role tokens. Auto-generated on each deployment. Override to set a specific value.')
param swaRolesSecret string = newGuid()

@secure()
@description('Client ID of the Entra ID app registration for Microsoft Graph API (Teams notifications).')
param graphApiClientId string

@secure()
@description('Client secret of the Entra ID app registration for Microsoft Graph API.')
param graphApiClientSecret string

@description('Tenant ID for Microsoft Graph API. Defaults to the subscription\'s tenant ID.')
param graphApiTenantId string = subscription().tenantId

@secure()
@description('API key for Pinecone vector database. Must be a valid Pinecone API key for the configured index.')
param pineconeApiKey string

@description('Entra ID tenant ID used for OIDC token validation on Functions (#218). Placeholder until UADE provisions the app registration.')
param entraTenantId string = 'PLACEHOLDER'

@description('Entra ID client ID (audience) used for OIDC token validation on Functions (#218). Placeholder until UADE provisions the app registration.')
param entraClientId string = 'PLACEHOLDER'

// ─── Key Vault ───────────────────────────────────────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    // RBAC authorization model (preferred over Access Policies)
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enabledForDeployment: false
    enabledForTemplateDeployment: false
    enabledForDiskEncryption: false
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
  }
}

// ─── Grant deploying user Key Vault Administrator role ─────────
// NOTA: Requiere permiso 'Microsoft.Authorization/roleAssignments/write'.
// UADE debe otorgar manualmente el rol Key Vault Administrator al usuario
// o conceder el permiso necesario en el RG.
//
// var keyVaultAdministratorRoleId = '00482a5a-887f-4fb3-b363-3b7fe8e74483'
// resource deployerAdminRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(principalId)) {
//   name: guid(keyVault.id, principalId, keyVaultAdministratorRoleId)
//   scope: keyVault
//   properties: {
//     roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultAdministratorRoleId)
//     principalId: principalId
//     principalType: 'User'
//     description: 'Allows the deploying developer to manage Key Vault secrets'
//   }
// }

// ─── SWA_ROLES_SECRET ──────────────────────────────────────────
resource swaRolesSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'SWA-ROLES-SECRET'
  properties: {
    value: swaRolesSecret
  }
}

// ─── GRAPH-API-CLIENT-ID ──────────────────────────────────────
resource graphApiClientIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GRAPH-API-CLIENT-ID'
  properties: {
    value: graphApiClientId
  }
}

// ─── GRAPH-API-CLIENT-SECRET ──────────────────────────────────
resource graphApiClientSecretSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GRAPH-API-CLIENT-SECRET'
  properties: {
    value: graphApiClientSecret
  }
}

// ─── GRAPH-API-TENANT-ID ──────────────────────────────────────
resource graphApiTenantIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GRAPH-API-TENANT-ID'
  properties: {
    value: graphApiTenantId
  }
}

// ─── PINECONE-API-KEY ─────────────────────────────────────────
resource pineconeApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'PINECONE-API-KEY'
  properties: {
    value: pineconeApiKey
  }
}

// ─── ENTRA-TENANT-ID ──────────────────────────────────────────
resource entraTenantIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ENTRA-TENANT-ID'
  properties: {
    value: entraTenantId
  }
}

// ─── ENTRA-CLIENT-ID ──────────────────────────────────────────
resource entraClientIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ENTRA-CLIENT-ID'
  properties: {
    value: entraClientId
  }
}

// ─── AZURE_STORAGE_ACCESS_KEY (populated at deploy-time by functions.bicep) ──
// The secret resource is created in functions.bicep where listKeys() resolves.

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the Key Vault.')
output keyVaultName string = keyVault.name

@description('The URI of the Key Vault.')
output keyVaultUri string = keyVault.properties.vaultUri

@description('The resource ID of the Key Vault.')
output keyVaultId string = keyVault.id

@description('The name of the SWA_ROLES_SECRET secret.')
output swaRolesSecretName string = swaRolesSecretResource.name
