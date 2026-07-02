# Edge Case Hunter Review — spec-9-197-key-vault-secrets-for-graph-api

Review this diff with read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard`.

```
diff --git a/infra/main.bicep b/infra/main.bicep
index b2f6a01..04ce4f7 100644
--- a/infra/main.bicep
+++ b/infra/main.bicep
@@ -75,6 +75,17 @@ param budgetAmount int = 100
 @description('Lista de correos para notificaciones de presupuesto.')
 param notificationEmail string = ''
 
+@secure()
+@description('Client ID of the Entra ID app registration for Microsoft Graph API (Teams notifications).')
+param graphApiClientId string
+
+@secure()
+@description('Client secret of the Entra ID app registration for Microsoft Graph API.')
+param graphApiClientSecret string
+
+@description('Tenant ID for Microsoft Graph API. Defaults to the subscription\'s tenant ID.')
+param graphApiTenantId string = subscription().tenantId
+
 // ─── Variables & naming ──────────────────────────────────────────
 var abbrs = loadJsonContent('./abbreviations.json')
 var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
@@ -150,6 +161,9 @@ module keyVault './modules/keyvault.bicep' = {
     location: location
     name: keyVaultName
     tags: tags
+    graphApiClientId: graphApiClientId
+    graphApiClientSecret: graphApiClientSecret
+    graphApiTenantId: graphApiTenantId
   }
 }
 
diff --git a/infra/modules/functions.bicep b/infra/modules/functions.bicep
index fadb397..8ddbbd5 100644
--- a/infra/modules/functions.bicep
+++ b/infra/modules/functions.bicep
@@ -247,6 +247,19 @@ resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
           name: 'FRONT_DOOR_ID'
           value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/FRONT-DOOR-ID/)'
         }
+        // Graph API (Teams notifications)
+        {
+          name: 'GRAPH_API_CLIENT_ID'
+          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-CLIENT-ID/)'
+        }
+        {
+          name: 'GRAPH_API_CLIENT_SECRET'
+          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-CLIENT-SECRET/)'
+        }
+        {
+          name: 'GRAPH_API_TENANT_ID'
+          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/GRAPH-API-TENANT-ID/)'
+        }
         // Storage Queue for async processing
         {
           name: 'AZURE_STORAGE_QUEUE_INGESTION'
diff --git a/infra/modules/keyvault.bicep b/infra/modules/keyvault.bicep
index 735757b..990446f 100644
--- a/infra/modules/keyvault.bicep
+++ b/infra/modules/keyvault.bicep
@@ -19,6 +19,17 @@ param tags object = {}
 @description('Secret value for SWA_ROLES_SECRET — used to validate Static Web App role tokens. Auto-generated on each deployment. Override to set a specific value.')
 param swaRolesSecret string = newGuid()
 
+@secure()
+@description('Client ID of the Entra ID app registration for Microsoft Graph API (Teams notifications).')
+param graphApiClientId string
+
+@secure()
+@description('Client secret of the Entra ID app registration for Microsoft Graph API.')
+param graphApiClientSecret string
+
+@description('Tenant ID for Microsoft Graph API. Defaults to the subscription\'s tenant ID.')
+param graphApiTenantId string = subscription().tenantId
+
 // ─── Key Vault ───────────────────────────────────────────────────
 resource keyVault 'Microsoft.KeyVault/vaults@2023-01-01' = {
   name: name
@@ -71,6 +82,33 @@ resource swaRolesSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' =
   }
 }
 
+// ─── GRAPH-API-CLIENT-ID ──────────────────────────────────────
+resource graphApiClientIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
+  parent: keyVault
+  name: 'GRAPH-API-CLIENT-ID'
+  properties: {
+    value: graphApiClientId
+  }
+}
+
+// ─── GRAPH-API-CLIENT-SECRET ──────────────────────────────────
+resource graphApiClientSecretSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
+  parent: keyVault
+  name: 'GRAPH-API-CLIENT-SECRET'
+  properties: {
+    value: graphApiClientSecret
+  }
+}
+
+// ─── GRAPH-API-TENANT-ID ──────────────────────────────────────
+resource graphApiTenantIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
+  parent: keyVault
+  name: 'GRAPH-API-TENANT-ID'
+  properties: {
+    value: graphApiTenantId
+  }
+}
+
 // ─── AZURE_STORAGE_ACCESS_KEY (populated at deploy-time by functions.bicep) ──
 // The secret resource is created in functions.bicep where listKeys() resolves.
```

Walk every branching path and boundary condition. Check:
1. What happens when graphApiClientId or graphApiClientSecret is empty string?
2. What happens when the Key Vault already exists and secrets are added?
3. Is there any idempotency concern with re-deployment?
4. Are there naming conflicts with existing secrets or params?
5. What happens when the Functions app already has the old config without these settings?
6. Do the Key Vault references in functions.bicep correctly form the URI?
