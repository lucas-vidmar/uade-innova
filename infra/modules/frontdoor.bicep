/*
  frontdoor.bicep — Azure Front Door & WAF
  Provides global routing and OWASP Top 10 protection.
*/

@description('Name of the Front Door profile.')
param profileName string

@description('Hostname of the Static Web App (Frontend).')
param frontendHostName string

@description('Hostname of the Function App (Backend).')
param backendHostName string

@description('Tags for the resources.')
param tags object = {}

var endpointName = 'fd-${uniqueString(resourceGroup().id, profileName)}'

// ─── Front Door Profile ──────────────────────────────────────────
resource profile 'Microsoft.Cdn/profiles@2023-05-01' = {
  name: profileName
  location: 'global'
  tags: tags
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

// ─── Front Door Endpoint ─────────────────────────────────────────
resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2023-05-01' = {
  parent: profile
  name: endpointName
  location: 'global'
  properties: {
    enabledState: 'Enabled'
  }
}

// ─── Origin Group & Origin: Frontend (SWA) ───────────────────────
resource frontendOriginGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: profile
  name: 'frontend-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    healthProbeSettings: {
      probePath: '/'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
  }
}

resource frontendOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2023-05-01' = {
  parent: frontendOriginGroup
  name: 'frontend-origin'
  properties: {
    hostName: frontendHostName
    httpPort: 80
    httpsPort: 443
    originHostHeader: frontendHostName
    priority: 1
    weight: 1000
    enforceCertificateNameCheck: true
  }
}

// ─── Origin Group & Origin: Backend (Function) ───────────────────
resource backendOriginGroup 'Microsoft.Cdn/profiles/originGroups@2023-05-01' = {
  parent: profile
  name: 'backend-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
    }
    healthProbeSettings: {
      probePath: '/api/health'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
  }
}

resource backendOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2023-05-01' = {
  parent: backendOriginGroup
  name: 'backend-origin'
  properties: {
    hostName: backendHostName
    httpPort: 80
    httpsPort: 443
    originHostHeader: backendHostName
    priority: 1
    weight: 1000
    enforceCertificateNameCheck: true
  }
}

// ─── Routing: Backend (/api/*) ───────────────────────────────────
resource backendRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: endpoint
  name: 'route-api'
  dependsOn: [
    backendOrigin
  ]
  properties: {
    originGroup: {
      id: backendOriginGroup.id
    }
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/api/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
  }
}

// ─── Routing: Frontend (/*) ──────────────────────────────────────
resource frontendRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2023-05-01' = {
  parent: endpoint
  name: 'route-ui'
  dependsOn: [
    frontendOrigin
  ]
  properties: {
    originGroup: {
      id: frontendOriginGroup.id
    }
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
  }
}

// ─── Web Application Firewall (WAF) Policy ───────────────────────
resource wafPolicy 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2022-05-01' = {
  name: '${replace(profileName, '-', '')}waf'
  location: 'global'
  tags: tags
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: 'Prevention' // Blocks malicious requests (SQLi/XSS)
      requestBodyCheck: 'Enabled'
    }
    managedRules: {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
        }
      ]
    }
  }
}

// ─── Security Policy (Bind WAF to Endpoint) ──────────────────────
resource securityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2023-05-01' = {
  parent: profile
  name: 'waf-binding'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: {
        id: wafPolicy.id
      }
      associations: [
        {
          domains: [
            {
              id: endpoint.id
            }
          ]
          patternsToMatch: [
            '/*'
          ]
        }
      ]
    }
  }
}

// ─── Outputs ───────────────────────────────────────────────────
@description('The host name of the Front Door endpoint.')
output frontDoorHostName string = endpoint.properties.hostName

@description('The URI of the Front Door endpoint.')
output frontDoorUri string = 'https://${endpoint.properties.hostName}'
