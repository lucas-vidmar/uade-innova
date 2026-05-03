/*
  workbook.bicep — Azure Workbook: Cost-per-Interaction Dashboard
  Director View: Real-time Hybrid AI (DeepSeek + GPT-4o-mini) cost tracking.

  Pricing (Ref):
    DeepSeek V4: Input $0.14/1M, Output $0.28/1M
    GPT-4o-mini: Input $0.15/1M, Output $0.60/1M
*/

@description('Azure region for resources.')
param location string

@description('Name of the workbook.')
param workbookName string

@description('Display name shown in the Azure Portal.')
param workbookDisplayName string = 'Cost-per-Interaction Dashboard'

@description('Resource ID of the Application Insights instance.')
param appInsightsId string

@description('Tags to apply to resources.')
param tags object = {}

// ─── Workbook serialized content ──────────────────────────────────
var workbookContent = {
  version: 'Notebook/1.0'
  items: [
    // ── Header ──
    {
      type: 1
      content: {
        json: '## 💰 Cost-per-Interaction Dashboard\nReal-time Hybrid AI (DeepSeek/GPT) cost tracking. Pricing (Avg): **$0.15/1M input tokens** · **$0.40/1M output tokens**'
      }
      name: 'header'
    }
    // ── Time Range Picker ──
    {
      type: 9
      content: {
        version: 'KqlParameterItem/1.0'
        parameters: [
          {
            id: 'timeRange'
            version: 'KqlParameterItem/1.0'
            name: 'TimeRange'
            type: 4
            isRequired: true
            value: {
              durationMs: 604800000
            }
            typeSettings: {
              selectableValues: [
                { durationMs: 3600000 }
                { durationMs: 86400000 }
                { durationMs: 604800000 }
                { durationMs: 2592000000 }
              ]
            }
          }
        ]
        style: 'pills'
        queryType: 0
        resourceType: 'microsoft.insights/components'
      }
      name: 'timePicker'
    }
    // ── KPI Tiles: Total Cost + Avg Cost + Interaction Count ──
    {
      type: 3
      content: {
        version: 'KqlItem/1.0'
        query: '''
traces
| where timestamp {TimeRange}
| where message startswith "[A/B Test]"
| extend props = customDimensions
| extend promptTokens    = toint(props["promptTokens"])
| extend completionTokens = toint(props["completionTokens"])
| summarize
    TotalInteractions   = count(),
    TotalPromptTokens   = sum(promptTokens),
    TotalCompletionTokens = sum(completionTokens)
| extend
    TotalInputCost  = round(TotalPromptTokens    * 0.00000015, 4),
    TotalOutputCost = round(TotalCompletionTokens * 0.0000006, 4)
| extend TotalCost = round(TotalInputCost + TotalOutputCost, 4)
| extend AvgCostPerInteraction = round(TotalCost / max_of(TotalInteractions, 1), 6)
| project TotalInteractions, TotalPromptTokens, TotalCompletionTokens, TotalInputCost, TotalOutputCost, TotalCost, AvgCostPerInteraction
'''
        size: 4
        title: 'Cost Summary (Period)'
        timeContextFromParameter: 'TimeRange'
        queryType: 0
        resourceType: 'microsoft.insights/components'
        visualization: 'tiles'
        tileSettings: {
          titleContent: {
            columnMatch: 'TotalCost'
            formatter: 12
            formatOptions: {
              palette: 'greenRed'
            }
          }
          leftContent: {
            columnMatch: 'TotalCost'
            formatter: 12
          }
          showBorder: true
        }
      }
      name: 'kpiTiles'
    }
    // ── Daily Cost Line Chart ──
    {
      type: 3
      content: {
        version: 'KqlItem/1.0'
        query: '''
traces
| where timestamp {TimeRange}
| where message startswith "[A/B Test]"
| extend props = customDimensions
| extend promptTokens     = toint(props["promptTokens"])
| extend completionTokens = toint(props["completionTokens"])
| summarize
    DailyInputCost  = round(sum(promptTokens)     * 0.00000015, 4),
    DailyOutputCost = round(sum(completionTokens)  * 0.0000006,  4),
    Interactions    = count()
    by Day = startofday(timestamp)
| extend DailyTotalCost = round(DailyInputCost + DailyOutputCost, 4)
| project Day, DailyTotalCost, DailyInputCost, DailyOutputCost, Interactions
| order by Day asc
'''
        size: 0
        title: 'Daily Cost Trend ($USD)'
        timeContextFromParameter: 'TimeRange'
        queryType: 0
        resourceType: 'microsoft.insights/components'
        visualization: 'linechart'
        chartSettings: {
          yAxis: 'DailyTotalCost'
          xAxis: 'Day'
        }
      }
      name: 'dailyCostChart'
    }
    // ── Cost by Prompt Version (A/B breakdown) ──
    {
      type: 3
      content: {
        version: 'KqlItem/1.0'
        query: '''
traces
| where timestamp {TimeRange}
| where message startswith "[A/B Test]"
| extend props = customDimensions
| extend promptTokens     = toint(props["promptTokens"])
| extend completionTokens = toint(props["completionTokens"])
| extend promptVersion    = tostring(props["promptVersion"])
| summarize
    Interactions        = count(),
    TotalPromptTokens   = sum(promptTokens),
    TotalCompletionTokens = sum(completionTokens)
    by PromptVersion = promptVersion
| extend
    InputCost  = round(TotalPromptTokens     * 0.00000015, 6),
    OutputCost = round(TotalCompletionTokens  * 0.0000006,  6)
| extend TotalCost = round(InputCost + OutputCost, 6)
| extend AvgCost   = round(TotalCost / max_of(Interactions, 1), 8)
| project PromptVersion, Interactions, TotalPromptTokens, TotalCompletionTokens, InputCost, OutputCost, TotalCost, AvgCost
| order by TotalCost desc
'''
        size: 1
        title: 'Cost by Prompt Version (A/B Testing)'
        timeContextFromParameter: 'TimeRange'
        queryType: 0
        resourceType: 'microsoft.insights/components'
        visualization: 'table'
        gridSettings: {
          formatters: [
            {
              columnMatch: 'TotalCost'
              formatter: 8
              formatOptions: { palette: 'yellowOrangeRed' }
            }
            {
              columnMatch: 'AvgCost'
              formatter: 8
              formatOptions: { palette: 'blue' }
            }
          ]
        }
      }
      name: 'abCostTable'
    }
  ]
  fallbackResourceIds: [appInsightsId]
  '$schema': 'https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json'
}

// ─── Workbook Resource ────────────────────────────────────────────
resource workbook 'Microsoft.Insights/workbooks@2022-04-01' = {
  name: workbookName
  location: location
  tags: union(tags, { purpose: 'cost-per-interaction-finops' })
  kind: 'shared'
  properties: {
    displayName: workbookDisplayName
    serializedData: string(workbookContent)
    version: '1.0'
    sourceId: appInsightsId
    category: 'workbook'
  }
}

// ─── Outputs ──────────────────────────────────────────────────────
@description('The resource ID of the Azure Workbook.')
output workbookId string = workbook.id

@description('The display name of the deployed workbook.')
output workbookDisplayName string = workbook.properties.displayName
