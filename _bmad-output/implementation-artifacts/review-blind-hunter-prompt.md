# Blind Hunter Review

You receive ONLY the diff below. No spec, no context, no project access.

```diff
diff --git a/infra/main.bicep b/infra/main.bicep
index 5e2b15d..b2f6a01 100644
--- a/infra/main.bicep
+++ b/infra/main.bicep
@@ -153,6 +153,14 @@ module keyVault './modules/keyvault.bicep' = {
   }
 }
 
+// ─── Storage Connection String in Key Vault ────────────────────
+resource storageConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
+  name: '${keyVaultName}/AZURE-STORAGE-CONNECTION-STRING'
+  properties: {
+    value: 'DefaultEndpointsProtocol=https;AccountName=${storage.outputs.accountName};AccountKey=${listKeys(storage.outputs.accountId, '2023-01-01').keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
+  }
+}
+
 // ─── Module: Azure Functions (Consumption Plan — sin VM quota) ────
 // Plan Y1/Dynamic: pago por ejecución, escala a 0, sin reserva de VM.
 module functions './modules/functions.bicep' = {
@@ -179,6 +187,16 @@ module functions './modules/functions.bicep' = {
     enrollmentsTableName: storage.outputs.enrollmentsTableName
     storageAccountId: storage.outputs.accountId
     ingestionQueueName: storage.outputs.ingestionQueueName
+    userConsentTableName: storage.outputs.userConsentTableName
+    correctionsTableName: storage.outputs.correctionsTableName
+    correctionsPendingTableName: storage.outputs.correctionsPendingTableName
+    conversationsTableName: storage.outputs.conversationsTableName
+    conversationRatingsTableName: storage.outputs.conversationRatingsTableName
+    notificationPreferencesTableName: storage.outputs.notificationPreferencesTableName
+    userEventsTableName: storage.outputs.userEventsTableName
+    glossaryFilesContainerName: storage.outputs.glossaryFilesContainerName
+    summariesContainerName: storage.outputs.summariesContainerName
+    notificationQueueName: storage.outputs.notificationQueueName
     allowedCorsOrigin: expectedCorsOrigin
     tags: tags
   }
diff --git a/infra/modules/functions.bicep b/infra/modules/functions.bicep
index f25e9ac..fadb397 100644
--- a/infra/modules/functions.bicep
+++ b/infra/modules/functions.bicep
@@ -75,6 +75,36 @@ param classesTableName string = 'classes'
 @description('Table name for enrollment entities.')
 param enrollmentsTableName string = 'Enrollments'
 
+@description('Table name for user consent records.')
+param userConsentTableName string = 'UserConsent'
+
+@description('Table name for verified answer corrections.')
+param correctionsTableName string = 'Corrections'
+
+@description('Table name for pending correction index.')
+param correctionsPendingTableName string = 'CorrectionsPending'
+
+@description('Table name for saved conversation threads.')
+param conversationsTableName string = 'Conversations'
+
+@description('Table name for conversation ratings.')
+param conversationRatingsTableName string = 'ConversationRatings'
+
+@description('Table name for notification preferences.')
+param notificationPreferencesTableName string = 'NotificationPreferences'
+
+@description('Table name for user activity events.')
+param userEventsTableName string = 'UserEvents'
+
+@description('Name of the glossary-files blob container.')
+param glossaryFilesContainerName string = 'glossary-files'
+
+@description('Name of the summaries blob container.')
+param summariesContainerName string = 'summaries'
+
+@description('Name of the notification dispatch queue.')
+param notificationQueueName string = 'notification-queue'
+
 // ─── Consumption Plan (Y1 — sin VM quota, serverless real) ───────
 resource consumptionPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
   name: '${functionAppName}-plan'
@@ -222,6 +252,48 @@ resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
           name: 'AZURE_STORAGE_QUEUE_INGESTION'
           value: ingestionQueueName
         }
+        {
+          name: 'AZURE_STORAGE_QUEUE_NOTIFICATION'
+          value: notificationQueueName
+        }
+        // Table names for Epics 3-7
+        {
+          name: 'AZURE_TABLE_USER_CONSENT'
+          value: userConsentTableName
+        }
+        {
+          name: 'AZURE_TABLE_CORRECTIONS'
+          value: correctionsTableName
+        }
+        {
+          name: 'AZURE_TABLE_CORRECTIONS_PENDING'
+          value: correctionsPendingTableName
+        }
+        {
+          name: 'AZURE_TABLE_CONVERSATIONS'
+          value: conversationsTableName
+        }
+        {
+          name: 'AZURE_TABLE_CONVERSATION_RATINGS'
+          value: conversationRatingsTableName
+        }
+        {
+          name: 'AZURE_TABLE_NOTIFICATION_PREFERENCES'
+          value: notificationPreferencesTableName
+        }
+        {
+          name: 'AZURE_TABLE_USER_EVENTS'
+          value: userEventsTableName
+        }
+        // Blob container names
+        {
+          name: 'AZURE_STORAGE_CONTAINER_GLOSSARY'
+          value: glossaryFilesContainerName
+        }
+        {
+          name: 'AZURE_STORAGE_CONTAINER_SUMMARIES'
+          value: summariesContainerName
+        }
       ]
     }
   }
diff --git a/infra/modules/storage.bicep b/infra/modules/storage.bicep
index 2a91906..b3dd4d2 100644
--- a/infra/modules/storage.bicep
+++ b/infra/modules/storage.bicep
@@ -61,6 +61,30 @@ resource classMaterialsContainer 'Microsoft.Storage/storageAccounts/blobServices
   }
 }
 
+// ─── Container: glossary-files (subject-specific technical glossaries) ───
+resource glossaryFilesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
+  parent: blobService
+  name: 'glossary-files'
+  properties: {
+    publicAccess: 'None'
+    metadata: {
+      purpose: 'Subject-specific technical glossary JSON files for transcription correction'
+    }
+  }
+}
+
+// ─── Container: summaries (AI-generated class summaries) ───
+resource summariesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
+  parent: blobService
+  name: 'summaries'
+  properties: {
+    publicAccess: 'None'
+    metadata: {
+      purpose: 'AI-generated and teacher-validated class summaries'
+    }
+  }
+}
+
 // ─── Container: processed (chunk JSON + embeddings metadata) ───
 resource processedContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
   parent: blobService
@@ -178,6 +202,17 @@ resource ingestionQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@
   }
 }
 
+// ─── Queue: notification-queue (async notification dispatch) ────
+resource notificationQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-01-01' = {
+  parent: queueService
+  name: 'notification-queue'
+  properties: {
+    metadata: {
+      purpose: 'Async notification dispatch for reminders, alerts, and updates'
+    }
+  }
+}
+
 // ─── Table: Enrollments (subject-to-user enrollment tracking) ───
 resource enrollmentsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
   parent: tableService
@@ -190,6 +225,42 @@ resource userConsentTable 'Microsoft.Storage/storageAccounts/tableServices/table
   name: 'UserConsent'
 }
 
+// ─── Table: Corrections (teacher-verified answer corrections) ──
+resource correctionsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'Corrections'
+}
+
+// ─── Table: CorrectionsPending (pending correction index) ──────
+resource correctionsPendingTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'CorrectionsPending'
+}
+
+// ─── Table: Conversations (saved student chat threads) ─────────
+resource conversationsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'Conversations'
+}
+
+// ─── Table: ConversationRatings (thumbs up/down per message) ───
+resource conversationRatingsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'ConversationRatings'
+}
+
+// ─── Table: NotificationPreferences (per-user notification settings) ─
+resource notificationPreferencesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'NotificationPreferences'
+}
+
+// ─── Table: UserEvents (user activity & intervention events) ────
+resource userEventsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
+  parent: tableService
+  name: 'UserEvents'
+}
+
 // ─── Outputs ───────────────────────────────────────────────────
 @description('The name of the Storage Account.')
 output accountName string = storageAccount.name
@@ -206,6 +277,12 @@ output classMaterialsContainerName string = classMaterialsContainer.name
 @description('The name of the processed container.')
 output processedContainerName string = processedContainer.name
 
+@description('The name of the glossary-files container.')
+output glossaryFilesContainerName string = glossaryFilesContainer.name
+
+@description('The name of the summaries container.')
+output summariesContainerName string = summariesContainer.name
+
 @description('The name of the materials table.')
 output materialsTableName string = materialsTable.name
 
@@ -215,5 +292,29 @@ output classesTableName string = classesTable.name
 @description('The name of the Enrollments table.')
 output enrollmentsTableName string = enrollmentsTable.name
 
+@description('The name of the UserConsent table.')
+output userConsentTableName string = userConsentTable.name
+
+@description('The name of the Corrections table.')
+output correctionsTableName string = correctionsTable.name
+
+@description('The name of the CorrectionsPending table.')
+output correctionsPendingTableName string = correctionsPendingTable.name
+
+@description('The name of the Conversations table.')
+output conversationsTableName string = conversationsTable.name
+
+@description('The name of the ConversationRatings table.')
+output conversationRatingsTableName string = conversationRatingsTable.name
+
+@description('The name of the NotificationPreferences table.')
+output notificationPreferencesTableName string = notificationPreferencesTable.name
+
+@description('The name of the UserEvents table.')
+output userEventsTableName string = userEventsTable.name
+
 @description('The name of the ingestion tasks queue.')
 output ingestionQueueName string = ingestionQueue.name
+
+@description('The name of the notification queue.')
+output notificationQueueName string = notificationQueue.name
```

Review adversarially. Focus on security flaws, anti-patterns, and hidden risks in Bicep infrastructure code.
