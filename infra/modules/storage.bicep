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

// ─── Container: glossary-files (subject-specific technical glossaries) ───
resource glossaryFilesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'glossary-files'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'Subject-specific technical glossary JSON files for transcription correction'
    }
  }
}

// ─── Container: summaries (AI-generated class summaries) ───
resource summariesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'summaries'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'AI-generated and teacher-validated class summaries'
    }
  }
}

// ─── Container: compliance (retention policy config) ──────────
resource complianceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'compliance'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'Retention policy configuration and compliance evidence exports'
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

// ─── Container: monitor-state (vector health monitor state) ─────
resource monitorStateContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'monitor-state'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'Vector health monitor dedup and baseline state'
    }
  }
}

// ─── Container: vector-snapshots (periodic vector health snapshots) ─────
resource vectorSnapshotsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'vector-snapshots'
  properties: {
    publicAccess: 'None'
    metadata: {
      purpose: 'Periodic vector health snapshots for trend analysis'
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
        {
          enabled: true
          name: 'DeleteVectorSnapshotsAfter2Years'
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
                'vector-snapshots/'
              ]
            }
          }
        }
        {
          enabled: true
          name: 'MoveChatLogsToCoolAfter30d'
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: 30
                }
              }
            }
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'chat-logs/'
                'vector-backups/'
              ]
            }
          }
        }
        {
          enabled: true
          name: 'DeleteChatLogsAfter90d'
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 90
                }
              }
            }
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'chat-logs/'
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

// ─── Table: materials (domain state store) ─────────────────────
resource materialsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'materials'
}

// ─── Table: classes (domain state store) ───────────────────────
resource classesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'classes'
}

// ─── Queue Service ──────────────────────────────────────────────
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

// ─── Queue: ingestion-tasks (async processing pipeline) ─────────
resource ingestionQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-01-01' = {
  parent: queueService
  name: 'ingestion-tasks'
  properties: {
    metadata: {
      purpose: 'Async ingestion processing tasks for Queue-triggered functions'
    }
  }
}

// ─── Queue: notification-queue (async notification dispatch) ────
resource notificationQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-01-01' = {
  parent: queueService
  name: 'notification-queue'
  properties: {
    metadata: {
      purpose: 'Async notification dispatch for reminders, alerts, and updates'
    }
  }
}

// ─── Table: Enrollments (subject-to-user enrollment tracking) ───
resource enrollmentsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Enrollments'
}

// ─── Table: UserConsent (AI content consent records) ──────────
resource userConsentTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'UserConsent'
}

// ─── Table: Corrections (teacher-verified answer corrections) ──
resource correctionsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Corrections'
}

// ─── Table: CorrectionsPending (pending correction index) ──────
resource correctionsPendingTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'CorrectionsPending'
}

// ─── Table: Conversations (saved student chat threads) ─────────
resource conversationsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Conversations'
}

// ─── Table: ConversationRatings (thumbs up/down per message) ───
resource conversationRatingsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'ConversationRatings'
}

// ─── Table: NotificationPreferences (per-user notification settings) ─
resource notificationPreferencesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'NotificationPreferences'
}

// ─── Table: UserEvents (user activity & intervention events) ────
resource userEventsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'UserEvents'
}

// ─── Table: Interventions (risk assessment records & workflow state) ─
resource interventionsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'Interventions'
}

// ─── Table: RiskThresholds (per-subject risk config) ──────────
resource riskThresholdsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: tableService
  name: 'RiskThresholds'
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

@description('The name of the glossary-files container.')
output glossaryFilesContainerName string = glossaryFilesContainer.name

@description('The name of the summaries container.')
output summariesContainerName string = summariesContainer.name

@description('The name of the compliance container.')
output complianceContainerName string = complianceContainer.name

@description('The name of the materials table.')
output materialsTableName string = materialsTable.name

@description('The name of the classes table.')
output classesTableName string = classesTable.name

@description('The name of the Enrollments table.')
output enrollmentsTableName string = enrollmentsTable.name

@description('The name of the UserConsent table.')
output userConsentTableName string = userConsentTable.name

@description('The name of the Corrections table.')
output correctionsTableName string = correctionsTable.name

@description('The name of the CorrectionsPending table.')
output correctionsPendingTableName string = correctionsPendingTable.name

@description('The name of the Conversations table.')
output conversationsTableName string = conversationsTable.name

@description('The name of the ConversationRatings table.')
output conversationRatingsTableName string = conversationRatingsTable.name

@description('The name of the NotificationPreferences table.')
output notificationPreferencesTableName string = notificationPreferencesTable.name

@description('The name of the UserEvents table.')
output userEventsTableName string = userEventsTable.name

@description('The name of the Interventions table.')
output interventionsTableName string = interventionsTable.name

@description('The name of the RiskThresholds table.')
output riskThresholdsTableName string = riskThresholdsTable.name

@description('The name of the vector-snapshots container.')
output vectorSnapshotsContainerName string = vectorSnapshotsContainer.name

@description('The name of the ingestion tasks queue.')
output ingestionQueueName string = ingestionQueue.name

@description('The name of the notification queue.')
output notificationQueueName string = notificationQueue.name
