/*
  plan.bicep — Shared Linux App Service Plan
  Used by both the App Service (frontend) and Function App (backend).
  Deploying once and sharing avoids the need for quota on a second plan.
*/

@description('Azure region for the plan.')
param location string

@description('Name of the App Service Plan.')
param name string

@description('SKU for the plan.')
param skuName string = 'B1'

@description('Tags.')
param tags object = {}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName == 'F1' ? 'Free' : skuName == 'B1' ? 'Basic' : 'Standard'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

@description('The resource ID of the App Service Plan.')
output serverFarmId string = appServicePlan.id

@description('The name of the App Service Plan.')
output name string = appServicePlan.name
