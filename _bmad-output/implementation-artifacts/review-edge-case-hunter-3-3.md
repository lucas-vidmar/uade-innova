# Edge Case Hunter Review — Story 3.3 Report Incorrect RAG Response

You have read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard/` and the diff below. Walk every branching path and boundary condition.

## Diff
```diff
git diff b93ac9bef66c3010d7633bfe95d0c704c92c5b6a -- frontend/src/components/ChatWidget.js
```

## Context
- The full file is: `frontend/src/components/ChatWidget.js`
- Key changes:
  1. Button text changed from `⚠️ Report Issue` to `Reportar respuesta incorrecta`
  2. Inline report handler replaced with `bindReportIssueEvents(container)` call
  3. New `showReportModal()` function creates a modal with question/answer context + required textarea (min 10 chars)
  4. `bindReportIssueEvents()` now finds the message + previous user question to show in modal

## Edge cases to check
- What happens if `messages.indexOf(msg)` returns -1 (message not in array)?
- What happens if the message at msgIndex-1 is not a user message (e.g., welcome message, error message)?
- What happens if the report modal receives empty question or answer strings?
- What happens if a message was loaded from saved conversations (IDs may differ)?
- What happens if the textarea contains only whitespace (trimmed to empty)?
- Can the modal be submitted via Ctrl+Enter or other keyboard shortcuts?
- Are there any memory leak risks with the overlay cleanup?
- What happens if the API call fails after the user typed a long issueDetail?
- Do inline event handlers on dynamically created buttons in the streaming handler work correctly?
