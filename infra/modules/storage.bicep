/*
  storage.bicep — Azure Blob Storage Account
  Containers: class-materials (raw uploads), processed (chunks JSON)
*/

@description('Azure region for the Storage Account.')
param location string

@description('Name of the Storage Account (3-24 chars, lowercase alphanumeric).')
param name string

@description('Tags to apply to the resource.')
param tags object = {}

// ─── Storage Account ────────────────────────────────────────────
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false  // Zero-trust: no public blob access
    allowSharedKeyAccess: true    // Needed for local dev; MI used in production
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    encryption: {
      services: {
        blob: { enabled: true }
        file: { enabled: true }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

// ─── Blob Service ───────────────────────────────────────────────
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

// ─── Container: class-materials (raw teacher uploads) ──────────
resource classMaterialsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'class-materials'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'Raw class material files uploaded by teachers'
    }
  }
}

// ─── Container: processed (chunk JSON + embeddings metadata) ───
resource processedContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'processed'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'Processed chunk JSON and pipeline state files'
    }
  }
}

// ─── Lifecycle Management Policy (2-Year Retention) ─────────────
resource blobLifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          enabled: true
          name: 'DeleteArchiveAfter2Years'
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 730
                }
              }
            }
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'class-materials/'
                'processed/'
              ]
            }
          }
        }
        {
          enabled: true
          name: 'ArchiveOldSemesterMaterials'
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                tierToArchive: {
                  daysAfterModificationGreaterThan: 180
                }
              }
            }
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'class-materials/semester-'
                'processed/semester-'
              ]
            }
          }
        }
      ]
    }
  }
}

// ─── Table Service ──────────────────────────────────────────────
resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

// ─── Table: UserProfiles ───────────────────────────────────────
resource userProfilesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'UserProfiles'
}

// ─── Table: SessionMetrics ─────────────────────────────────────
resource sessionMetricsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'SessionMetrics'
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The name of the Storage Account.')
output accountName string = storageAccount.name

@description('The resource ID of the Storage Account.')
output accountId string = storageAccount.id

@description('The primary blob endpoint URL.')
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob

@description('The name of the class-materials container.')
output classMaterialsContainerName string = classMaterialsContainer.name

@description('The name of the processed container.')
output processedContainerName string = processedContainer.name
