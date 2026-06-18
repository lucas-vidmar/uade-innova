# Graph API Credentials Setup

## Prerequisite: Entra ID App Registration

The Key Vault stores 3 secrets for Microsoft Graph API access (used by Teams notifications). These require an Entra ID app registration with:

- `TeamsActivity.Send` (Application permission) — send activity feed notifications via Teams
- `User.Read` (Delegated permission) — read user profile

> **Note:** You need either **Application Developer** or **Application Administrator** role in Entra ID to create app registrations. Contributor role in Azure is insufficient.

### Creating the App Registration

**Option A: Azure Portal**
1. Go to Azure Portal → Microsoft Entra ID → App registrations → New registration
2. Name: `uade-dashboard-teams-notifications`
3. Supported account types: "Accounts in this organizational directory only"
4. No redirect URI needed (daemon/service app)
5. Register → copy the Application (Client) ID
6. Go to "API permissions" → Add a permission → Microsoft Graph → Application permissions → Add `TeamsActivity.Send`
7. Also add Delegated permission → `User.Read`
8. Click "Grant admin consent" (needs admin privileges)
9. Go to "Certificates & secrets" → New client secret → Copy the value immediately

**Option B: Azure CLI (if you have permissions)**
```bash
# Create app registration
APP_ID=$(az ad app create \
  --display-name "uade-dashboard-teams-notifications" \
  --sign-in-audience "AzureADMyOrg" \
  --query "appId" -o tsv)

echo "Client ID: $APP_ID"
echo "Tenant ID: $(az account show --query tenantId -o tsv)"

# Add API permissions
GRAPH_API="00000003-0000-0000-c000-000000000000"
TEAMS_SEND_ID="c5d5f0e9-8c4a-4c0e-9b1a-7a9a9a9a9a9a" # TeamsActivity.Send
USER_READ_ID="e1fe6dd8-ba31-4d61-89e7-88639da4683d"  # User.Read

az ad app permission add --id $APP_ID \
  --api $GRAPH_API \
  --api-permissions "$TEAMS_SEND_ID=Role" "$USER_READ_ID=Scope"

# Grant admin consent
az ad app permission admin-consent --id $APP_ID

# Create client secret
az ad app credential reset --id $APP_ID --years 1
```

## Updating Key Vault Secrets

Current deployment uses placeholder values. Replace them with real credentials:

```bash
# From Azure Cloud Shell (required — Key Vault firewall blocks external IPs)
az keyvault secret set \
  --vault-name kv-edu-q47bia47kk3na \
  --name GRAPH-API-CLIENT-ID \
  --value "<your-client-id>"

az keyvault secret set \
  --vault-name kv-edu-q47bia47kk3na \
  --name GRAPH-API-CLIENT-SECRET \
  --value "<your-client-secret>"

# Tenant ID only needs updating if different from subscription tenant
az keyvault secret set \
  --vault-name kv-edu-q47bia47kk3na \
  --name GRAPH-API-TENANT-ID \
  --value "<your-tenant-id>"
```

The Functions app reads these via Key Vault references at runtime — no restart needed. Changes take effect when the Function App refreshes its Key Vault cache (hourly default, or force via `az webapp config appsettings list`).
