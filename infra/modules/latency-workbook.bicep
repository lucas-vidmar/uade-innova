/*
  latency-workbook.bicep — Azure Workbook: Vector vs LLM Latency Percentiles
  Operations View: Side-by-side P50/P95/P99 charts for vector-search and RAG latency.
*/

@description('Azure region for resources.')
param location string

@description('Name of the workbook (GUID-based).')
param workbookName string

@description('Display name shown in the Azure Portal.')
param workbookDisplayName string = 'Vector vs LLM Latency Percentiles'

@description('Resource ID of the Application Insights instance.')
param appInsightsId string

@description('Tags to apply to resources.')
param tags object = {}

var workbookContent = {
  version: 'Notebook/1.0'
  items: [
    // ── Header ──
    {
      type: 1
      content: {
        json: '## Vector vs LLM Latency Percentiles\nSide-by-side comparison of vector-search (Pinecone) and end-to-end RAG latency. P50/P95/P99 percentiles over time. Includes TTFT (Time to First Token) segmentation by Subject and Prompt Version (Issue #146).'
      }
      name: 'header'
    }
    // ── Time Range Picker + Filters ──
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
          {
            id: 'subjectFilter'
            version: 'KqlParameterItem/1.0'
            name: 'SubjectId'
            type: 2
            query: '''
customEvents
| where timestamp {TimeRange}
| where name == "RAGInteraction"
| distinct tostring(customDimensions.subjectId)
| where isnotempty(tostring(customDimensions.subjectId))
| order by tostring(customDimensions.subjectId) asc
'''
            isRequired: false
            queryType: 0
            resourceType: 'microsoft.insights/components'
            value: 'all'
            typeSettings: {
              additionalResourceOptions: []
              showDefault: true
            }
            timeContextFromParameter: 'TimeRange'
            timeContext: {
              durationMs: 604800000
            }
            defaultValue: 'all'
          }
          {
            id: 'promptVersionFilter'
            version: 'KqlParameterItem/1.0'
            name: 'PromptVersion'
            type: 2
            query: '''
customEvents
| where timestamp {TimeRange}
| where name == "RAGInteraction"
| distinct tostring(customDimensions.promptVersion)
| where isnotempty(tostring(customDimensions.promptVersion))
| order by tostring(customDimensions.promptVersion) asc
'''
            isRequired: false
            queryType: 0
            resourceType: 'microsoft.insights/components'
            value: 'all'
            typeSettings: {
              additionalResourceOptions: []
              showDefault: true
            }
            timeContextFromParameter: 'TimeRange'
            timeContext: {
              durationMs: 604800000
            }
            defaultValue: 'all'
          }
        ]
        style: 'pills'
        queryType: 0
        resourceType: 'microsoft.insights/components'
      }
      name: 'parameters'
    }
    // ── Side-by-side charts ──
    {
      type: 12
      content: {
        version: 'NotebookGroup/1.0'
        groupType: 'editable'
        items: [
          // ── Vector Search Latency (Left) ──
          {
            type: 3
            content: {
              version: 'KqlItem/1.0'
              query: '''
dependencies
| where timestamp {TimeRange}
| where name == "vector.search"
| where '{SubjectId}' == 'all' or tostring(customDimensions.subjectId) == '{SubjectId}'
| summarize
    P50 = percentile(duration, 50),
    P95 = percentile(duration, 95),
    P99 = percentile(duration, 99)
    by bin(timestamp, 1h)
| order by timestamp asc
'''
              size: 1
              title: 'Vector Search Latency (ms) — P50/P95/P99'
              timeContextFromParameter: 'TimeRange'
              queryType: 0
              resourceType: 'microsoft.insights/components'
              visualization: 'linechart'
              chartSettings: {
                xAxis: 'timestamp'
                ySettings: {
                  unit: 2
                }
              }
            }
            name: 'vectorSearchLatency'
            customWidth: '50%'
          }
          // ── RAG Interaction Latency (Right) ──
          {
            type: 3
            content: {
              version: 'KqlItem/1.0'
              query: '''
customEvents
| where timestamp {TimeRange}
| where name == "RAGInteraction"
| where '{SubjectId}' == 'all' or tostring(customDimensions.subjectId) == '{SubjectId}'
| where '{PromptVersion}' == 'all' or tostring(customDimensions.promptVersion) == '{PromptVersion}'
| extend durationMs = todouble(customMeasurements.durationMs)
| where isnotempty(durationMs)
| summarize
    P50 = percentile(durationMs, 50),
    P95 = percentile(durationMs, 95),
    P99 = percentile(durationMs, 99)
    by bin(timestamp, 1h)
| order by timestamp asc
'''
              size: 1
              title: 'RAG Interaction Latency (ms) — P50/P95/P99'
              timeContextFromParameter: 'TimeRange'
              queryType: 0
              resourceType: 'microsoft.insights/components'
              visualization: 'linechart'
              chartSettings: {
                xAxis: 'timestamp'
                ySettings: {
                  unit: 2
                }
              }
            }
            name: 'ragLatency'
            customWidth: '50%'
          }
        ]
      }
      name: 'chartsGroup'
      styleSettings: {
        showBorder: false
      }
    }
    // ── TTFT by Subject ──
    {
      type: 12
      content: {
        version: 'NotebookGroup/1.0'
        groupType: 'editable'
        items: [
          {
            type: 3
            content: {
              version: 'KqlItem/1.0'
              query: '''
customEvents
| where timestamp {TimeRange}
| where name == "RAGInteraction"
| where '{SubjectId}' == 'all' or tostring(customDimensions.subjectId) == '{SubjectId}'
| where '{PromptVersion}' == 'all' or tostring(customDimensions.promptVersion) == '{PromptVersion}'
| extend ttftMs = todouble(customMeasurements.ttftMs)
| where ttftMs > 0
| summarize
    P95 = percentile(ttftMs, 95),
    SampleCount = count()
    by bin(timestamp, 1h), Subject = tostring(customDimensions.subjectId)
| where SampleCount > 2
| order by timestamp asc
'''
              size: 1
              title: 'TTFT P95 by Subject (ms) — segmented by subjectId'
              timeContextFromParameter: 'TimeRange'
              queryType: 0
              resourceType: 'microsoft.insights/components'
              visualization: 'linechart'
              chartSettings: {
                xAxis: 'timestamp'
                series: [{
                  field: 'P95'
                  splitBy: 'Subject'
                }]
                ySettings: {
                  unit: 2
                }
              }
            }
            name: 'ttftBySubjectChart'
            customWidth: '50%'
          }
          {
            type: 3
            content: {
              version: 'KqlItem/1.0'
              query: '''
customEvents
| where timestamp {TimeRange}
| where name == "RAGInteraction"
| where '{SubjectId}' == 'all' or tostring(customDimensions.subjectId) == '{SubjectId}'
| where '{PromptVersion}' == 'all' or tostring(customDimensions.promptVersion) == '{PromptVersion}'
| extend ttftMs = todouble(customMeasurements.ttftMs)
| where ttftMs > 0
| summarize
    P50 = percentile(ttftMs, 50),
    P90 = percentile(ttftMs, 90),
    P95 = percentile(ttftMs, 95),
    SampleCount = count()
    by Subject = tostring(customDimensions.subjectId)
| where SampleCount > 2
| order by Subject asc
'''
              size: 1
              title: 'TTFT Summary by Subject — P50/P90/P95'
              timeContextFromParameter: 'TimeRange'
              queryType: 0
              resourceType: 'microsoft.insights/components'
              visualization: 'table'
              gridSettings: {
                formatters: [
                  { columnMatch: 'Subject', columnType: 'string' }
                  { columnMatch: 'P50', columnType: 'number', round: 0 }
                  { columnMatch: 'P90', columnType: 'number', round: 0 }
                  { columnMatch: 'P95', columnType: 'number', round: 0 }
                  { columnMatch: 'SampleCount', columnType: 'number', round: 0 }
                ]
              }
            }
            name: 'ttftBySubjectTable'
            customWidth: '50%'
          }
        ]
      }
      name: 'ttftBySubjectGroup'
      styleSettings: {
        showBorder: true
      }
    }
    // ── TTFT by Prompt Version ──
    {
      type: 12
      content: {
        version: 'NotebookGroup/1.0'
        groupType: 'editable'
        items: [
          {
            type: 3
            content: {
              version: 'KqlItem/1.0'
              query: '''
customEvents
| where timestamp {TimeRange}
| where name == "RAGInteraction"
| where '{SubjectId}' == 'all' or tostring(customDimensions.subjectId) == '{SubjectId}'
| where '{PromptVersion}' == 'all' or tostring(customDimensions.promptVersion) == '{PromptVersion}'
| extend ttftMs = todouble(customMeasurements.ttftMs)
| where ttftMs > 0
| summarize
    P95 = percentile(ttftMs, 95),
    SampleCount = count()
    by bin(timestamp, 1h), PromptVersion = tostring(customDimensions.promptVersion)
| where SampleCount > 2
| order by timestamp asc
'''
              size: 1
              title: 'TTFT P95 by Prompt Version (ms) — segmented by promptVersion'
              timeContextFromParameter: 'TimeRange'
              queryType: 0
              resourceType: 'microsoft.insights/components'
              visualization: 'linechart'
              chartSettings: {
                xAxis: 'timestamp'
                series: [{
                  field: 'P95'
                  splitBy: 'PromptVersion'
                }]
                ySettings: {
                  unit: 2
                }
              }
            }
            name: 'ttftByVersionChart'
            customWidth: '50%'
          }
          {
            type: 3
            content: {
              version: 'KqlItem/1.0'
              query: '''
customEvents
| where timestamp {TimeRange}
| where name == "RAGInteraction"
| where '{SubjectId}' == 'all' or tostring(customDimensions.subjectId) == '{SubjectId}'
| where '{PromptVersion}' == 'all' or tostring(customDimensions.promptVersion) == '{PromptVersion}'
| extend ttftMs = todouble(customMeasurements.ttftMs)
| where ttftMs > 0
| summarize
    P50 = percentile(ttftMs, 50),
    P90 = percentile(ttftMs, 90),
    P95 = percentile(ttftMs, 95),
    SampleCount = count()
    by PromptVersion = tostring(customDimensions.promptVersion)
| where SampleCount > 2
| order by PromptVersion asc
'''
              size: 1
              title: 'TTFT Summary by Prompt Version — P50/P90/P95'
              timeContextFromParameter: 'TimeRange'
              queryType: 0
              resourceType: 'microsoft.insights/components'
              visualization: 'table'
              gridSettings: {
                formatters: [
                  { columnMatch: 'PromptVersion', columnType: 'string' }
                  { columnMatch: 'P50', columnType: 'number', round: 0 }
                  { columnMatch: 'P90', columnType: 'number', round: 0 }
                  { columnMatch: 'P95', columnType: 'number', round: 0 }
                  { columnMatch: 'SampleCount', columnType: 'number', round: 0 }
                ]
              }
            }
            name: 'ttftByVersionTable'
            customWidth: '50%'
          }
        ]
      }
      name: 'ttftByVersionGroup'
      styleSettings: {
        showBorder: true
      }
    }
    // ── KQL Reference ──
    {
      type: 1
      content: {
        json: '### KQL Queries Reference\n\n**Vector Search Latency:** Queries `dependencies` table filtered by `name == "vector.search"`. Duration is in milliseconds. Filtered by SubjectId.\n\n**RAG Interaction Latency:** Queries `customEvents` table filtered by `name == "RAGInteraction"`. Duration comes from `customMeasurements.durationMs`. Filtered by SubjectId and PromptVersion.\n\n**TTFT by Subject:** Queries `customEvents` filtered by `name == "RAGInteraction"`. TTFT from `customMeasurements.ttftMs`. Segmented by `subjectId` with P50/P90/P95 and a minimum sample count guard (>2 samples) to suppress low-volume segments.\n\n**TTFT by Prompt Version:** Same as above, segmented by `promptVersion`.\n\nAll queries use adaptive bin size based on the selected time range.'
      }
      name: 'kqlReference'
    }
  ]
  fallbackResourceIds: [appInsightsId]
  '$schema': 'https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json'
}

resource workbook 'Microsoft.Insights/workbooks@2022-04-01' = {
  name: workbookName
  location: location
  tags: union(tags, { purpose: 'latency-percentiles-observability' })
  kind: 'shared'
  properties: {
    displayName: workbookDisplayName
    serializedData: string(workbookContent)
    version: '1.0'
    sourceId: appInsightsId
    category: 'workbook'
  }
}

output workbookId string = workbook.id
output workbookDisplayName string = workbook.properties.displayName
