/*
  budget.bicep — Configura el presupuesto (Azure Budgets) para el Resource Group.
  Alertas al 50%, 80% y 100% del presupuesto mensual.
*/

@description('Monto total del presupuesto mensual.')
param budgetAmount int = 100

@description('Lista de correos para notificaciones de presupuesto.')
param contactEmails array = []

@description('Fecha de inicio del presupuesto (formato YYYY-MM-01T00:00:00Z).')
// Usamos el primer día del mes actual por defecto
param startDate string = '${utcNow('yyyy-MM')}-01T00:00:00Z'

resource budget 'Microsoft.Consumption/budgets@2021-10-01' = {
  name: 'pilot-budget'
  properties: {
    timeGrain: 'Monthly'
    amount: budgetAmount
    category: 'Cost'
    timePeriod: {
      startDate: startDate
    }
    notifications: {
      Actual_50_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 50
        contactEmails: contactEmails
        contactRoles: [
          'Owner'
          'Contributor'
        ]
        thresholdType: 'Actual'
      }
      Actual_80_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: contactEmails
        contactRoles: [
          'Owner'
          'Contributor'
        ]
        thresholdType: 'Actual'
      }
      Actual_100_Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: contactEmails
        contactRoles: [
          'Owner'
          'Contributor'
        ]
        thresholdType: 'Actual'
      }
    }
  }
}
