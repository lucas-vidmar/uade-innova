/*
  keyvault.bicep — Azure Key Vault
  Stores the Pinecone API Key as a secret.
  Access controlled via RBAC (Key Vault Secrets User role).
*/

@description('Azure region for the Key Vault.')
param location string

@description('Name of the Key Vault (3-24 chars, globally unique).')
param name string

@description('Azure AD Tenant ID.')
param tenantId string = subscription().tenantId

@description('Direct Pinecone API Key (Plan B fallback).')
@secure()
param pineconeApiKey string = ''

@description('Tags to apply to the resource.')
param tags object = {}

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
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// ─── Placeholder secret: pinecone-api-key ──────────────────────
// Value must be set manually or via CI/CD pipeline post-provision.
// The applications read this via Key Vault reference (@Microsoft.KeyVault(...))
resource pineconeSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'pinecone-api-key'
  properties: {
    value: !empty(pineconeApiKey) ? pineconeApiKey : 'PLACEHOLDER-SET-AFTER-PROVISION'
    attributes: {
      enabled: true
    }
    contentType: 'text/plain'
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

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the Key Vault.')
output keyVaultName string = keyVault.name

@description('The URI of the Key Vault.')
output keyVaultUri string = keyVault.properties.vaultUri

@description('The resource ID of the Key Vault.')
output keyVaultId string = keyVault.id
