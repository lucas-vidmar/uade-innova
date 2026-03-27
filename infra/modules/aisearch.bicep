/*
  aisearch.bicep — Azure AI Search
  Servicio vectorial nativo en Azure para RAG.
*/

@description('Azure region for Azure AI Search.')
param location string

@description('Name of the Azure AI Search service.')
param name string

@description('SKU for Azure AI Search.')
param skuName string = 'basic'

@description('Primary vector index name used by backend.')
param indexName string = 'dashboard-edu-pilot'

@description('Tags to apply to the resource.')
param tags object = {}

resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  properties: {
    replicaCount: 1
    partitionCount: 1
    publicNetworkAccess: 'enabled'
    hostingMode: 'default'
    semanticSearch: 'free'
  }
}

@description('The resource ID of the Azure AI Search service.')
output id string = searchService.id

@description('The name of the Azure AI Search service.')
output serviceName string = searchService.name

@description('The endpoint URL of the Azure AI Search service.')
output endpoint string = 'https://${searchService.name}.search.windows.net'

@description('The default vector index name to use in backend settings.')
output defaultIndexName string = indexName
