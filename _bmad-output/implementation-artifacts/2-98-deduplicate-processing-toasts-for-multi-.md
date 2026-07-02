# Story 2.98: Deduplicate Processing Toasts for Multi-Material Uploads

Status: done

## Story

As a teacher,
I want processing completion toasts to be grouped when multiple materials finish around the same time,
so that my screen is not flooded with individual toast notifications and I can clearly see how many materials were processed.

## Acceptance Criteria

### AC1: Grouped Success Toast
- **Given** the teacher has uploaded 3 materials that are all processing
- **When** all 3 materials reach `ready` status within a 3-second window
- **Then** a single toast is shown with message: "3 materiales procesados correctamente" and a subtitle listing the filenames (truncated if too long)

### AC2: Grouped Error Toast
- **Given** the teacher has uploaded 3 materials that are all processing
- **When** 2 materials reach `error` status and 1 reaches `ready` status within a 3-second window
- **Then** two toasts are shown: one grouped success toast ("1 material procesado correctamente") and one grouped error toast ("2 materiales terminaron con errores")

### AC3: Mixed Terminal Statuses Within Window
- **Given** 5 materials are processing
- **When** 3 reach `ready` and 2 reach `error` within the same 3-second window
- **Then** exactly 2 toasts appear: one success group and one error group

### AC4: Window Timeout
- **Given** 2 materials are processing
- **When** the first reaches `ready` at T=0 and the second reaches `ready` at T=4 seconds
- **Then** two separate success toasts are shown (not grouped), because the second completion is outside the 3-second window

### AC5: Single Material Still Works
- **Given** 1 material is processing
- **When** it reaches `ready`
- **Then** the existing single toast behavior is preserved: "Procesamiento completado" with the filename

### AC6: Listener Events Preserved
- **Given** a subscriber is listening to `processingNotifications`
- **When** grouped toasts are triggered
- **Then** each individual `material-status-terminal` event is still emitted to listeners (the grouping only affects UI toasts, not the event stream)

### AC7: Navigation Persistence
- **Given** the teacher navigates away from the upload page while materials are processing
- **When** grouped toasts fire on another page
- **Then** the toast still appears correctly with the same grouped message format

## Tasks / Subtasks

- [x] Task 1: Implement toast deduplication buffer in `processing-notifications.js` (AC1, AC2, AC3, AC4)
  - [x] Add a `toastBuffer` array to accumulate terminal jobs
  - [x] Add a `flushTimeoutId` to control the 3-second window
  - [x] Modify `pollStatuses()` to push terminal jobs to buffer instead of showing toast immediately
  - [x] Implement `flushToastBuffer()` that groups by terminal status and calls `toast()` once per group
  - [x] Start/restart a 3-second timer on each terminal job; flush when timer expires
- [x] Task 2: Enhance `Toast.js` to support grouped toast content (AC1, AC2)
  - [x] Add optional `details` array parameter to `toast()` for listing multiple items
  - [x] Style the details list (max 3 visible items + "y N más" truncation)
  - [x] Preserve backward compatibility with existing single-message toasts
- [x] Task 3: Update existing tests and add new grouped toast tests (AC4, AC5, AC6, AC7)
  - [x] Update `processing-notifications.spec.js` to account for the 3-second flush window
  - [x] Add test: multiple materials ready within window → single toast with count
  - [x] Add test: mixed statuses within window → separate success and error toasts
  - [x] Add test: materials completing outside window → separate toasts
  - [x] Ensure all existing tests still pass

## Dev Notes

### Relevant Architecture Patterns and Constraints

- **Frontend stack:** Vanilla JS, no frameworks. All DOM manipulation is manual.
- **State persistence:** Tracked jobs are stored in `localStorage` under key `uade.processing.tracked-jobs`.
- **Polling interval:** Default 8000ms, overridable via `window.__UADE_PROCESSING_POLL_MS`.
- **Toast system:** `Toast.js` creates DOM elements directly. Toasts auto-dismiss after 4000ms.
- **API endpoints used:**
  - `GET /api/material-status?subjectId=&materialIds=` (batch status)
  - `GET /api/material-status/:materialId?subjectId=` (single status fallback)
  - `GET /api/classes?subjectId=` (fallback for status resolution)

### Source Tree Components to Touch

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/services/processing-notifications.js` | UPDATE | Core deduplication logic |
| `frontend/src/components/Toast.js` | UPDATE | Support grouped content display |
| `frontend/tests/processing-notifications.spec.js` | UPDATE | Add grouped toast test cases |

### Current State of `processing-notifications.js`

The file currently shows a toast **immediately** inside the `pollStatuses()` loop when a terminal status is detected:

```javascript
if (terminal === 'ready') {
    toast('success', 'Procesamiento completado', `"${job.filename}" ya está listo para usar.`);
    notifyListeners({...});
    continue;
}

toast('error', 'Procesamiento con error', `"${job.filename}" terminó con errores. Revisá el material e intentá nuevamente.`);
notifyListeners({...});
```

**What must change:** Instead of calling `toast()` directly in the loop, accumulate terminal jobs into a buffer. Flush the buffer after a 3-second debounce window, grouping by `terminal` status.

**What must be preserved:**
- `notifyListeners()` must still be called for **each** job individually, even when toasts are grouped.
- `trackedJobs` persistence logic must remain unchanged.
- The batch status API calls must remain unchanged.
- The fallback to `api.getClasses()` must remain unchanged.
- `stopPollingIfIdle()` must still work correctly.

### Current State of `Toast.js`

```javascript
export function toast(type = 'info', title = '', message = '', duration = 4000) {
    // Creates a single DOM element with icon, title, message, close button
}
```

**What must change:** Add an optional `details` parameter (array of strings) that renders as a bulleted/numbered list below the message. If `details` is provided and has more than 3 items, show first 3 + "y N más". If `details` is omitted, behavior is identical to today.

**What must be preserved:** All existing calls to `toast()` throughout the codebase must continue to work without modification.

### Testing Standards Summary

- **Framework:** Playwright with Chrome channel
- **Test files:** `frontend/tests/*.spec.js`
- **Mocking:** Use `page.route()` to intercept API calls
- **Timeouts:** Use `{ timeout: 7000 }` for toast assertions to account for polling + flush window
- **LocalStorage seeding:** Use `page.addInitScript()` to set `localStorage` items before navigation

### Proposed Implementation Sketch

In `processing-notifications.js`, add module-level state:

```javascript
let toastBuffer = [];
let flushTimeoutId = null;
const TOAST_FLUSH_DELAY_MS = 3000;

function flushToastBuffer() {
    if (toastBuffer.length === 0) return;

    const byStatus = { ready: [], error: [] };
    toastBuffer.forEach((job) => {
        if (byStatus[job.terminal]) byStatus[job.terminal].push(job);
    });

    Object.entries(byStatus).forEach(([status, jobs]) => {
        if (jobs.length === 0) return;
        if (jobs.length === 1) {
            // Preserve original single-toast behavior
            const job = jobs[0];
            if (status === 'ready') {
                toast('success', 'Procesamiento completado', `"${job.filename}" ya está listo para usar.`);
            } else {
                toast('error', 'Procesamiento con error', `"${job.filename}" terminó con errores. Revisá el material e intentá nuevamente.`);
            }
        } else {
            // Grouped toast
            const count = jobs.length;
            const filenames = jobs.map((j) => j.filename);
            const noun = count === 1 ? 'material' : 'materiales';
            if (status === 'ready') {
                toast('success', `${count} ${noun} procesados correctamente`, '', 5000, filenames);
            } else {
                toast('error', `${count} ${noun} terminaron con errores`, 'Revisá los materiales e intentá nuevamente.', 5000, filenames);
            }
        }
    });

    toastBuffer = [];
    flushTimeoutId = null;
}

function scheduleFlush() {
    if (flushTimeoutId) clearTimeout(flushTimeoutId);
    flushTimeoutId = setTimeout(flushToastBuffer, TOAST_FLUSH_DELAY_MS);
}
```

In the `pollStatuses()` loop, replace direct `toast()` calls with:

```javascript
if (terminal === 'ready' || terminal === 'error') {
    toastBuffer.push({ ...job, terminal });
    notifyListeners({
        type: 'material-status-terminal',
        terminal,
        materialId: job.materialId,
        subjectId: job.subjectId,
        classIds: [...job.classIds],
        filename: job.filename,
    });
    // Do NOT continue — let the loop finish so other jobs in this poll cycle are also buffered
}
```

After the `for (const job of trackedJobs)` loop, call `scheduleFlush()` if `toastBuffer.length > 0`.

In `Toast.js`, extend the signature:

```javascript
export function toast(type = 'info', title = '', message = '', duration = 4000, details = []) {
    // ... existing container logic ...
    const detailsHtml = Array.isArray(details) && details.length > 0
        ? `<ul class="toast-details">${details.slice(0, 3).map((d) => `<li>${escapeHtml(d)}</li>`).join('')}${details.length > 3 ? `<li>y ${details.length - 3} más...</li>` : ''}</ul>`
        : '';
    el.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <div class="toast-body">
            ${title ? `<div class="toast-title">${title}</div>` : ''}
            ${message ? `<div class="toast-msg">${message}</div>` : ''}
            ${detailsHtml}
        </div>
        <span class="toast-close" id="tc-${Date.now()}">✕</span>
    `;
    // ... rest unchanged ...
}
```

Add CSS for `.toast-details` in `frontend/src/styles/components.css`:

```css
.toast-details {
    margin: 4px 0 0 0;
    padding-left: 16px;
    font-size: 12px;
    color: var(--color-text-secondary);
    max-height: 60px;
    overflow-y: auto;
}
.toast-details li {
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
```

### Project Structure Notes

- All frontend source is under `frontend/src/`
- Services live in `frontend/src/services/`
- Components live in `frontend/src/components/`
- Styles live in `frontend/src/styles/`
- Tests live in `frontend/tests/`
- No React/Vue/Svelte — plain vanilla JS with module imports

### References

- [Source: frontend/src/services/processing-notifications.js] — Current polling and toast logic
- [Source: frontend/src/components/Toast.js] — Toast DOM creation
- [Source: frontend/src/styles/components.css] — Toast styling (add `.toast-details` here)
- [Source: frontend/tests/processing-notifications.spec.js] — Existing Playwright tests
- [Source: docs/architecture-review.md] — Architecture constraints (vanilla JS, Static Web Apps)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Implemented toast deduplication buffer (`toastBuffer`, `flushToastBuffer`, `scheduleFlush`) with 3-second window in `processing-notifications.js`.
- Added `bufferWasUpdated` flag to prevent `scheduleFlush()` from being called on every poll cycle (critical bug fix).
- Enhanced `Toast.js` with optional `details` array and `escapeHtml` helper; added `.toast-details` CSS in `components.css`.
- Added 3 new Playwright tests for grouped toasts (success group, mixed group, outside-window separation).
- Fixed existing tests 1-3 by seeding `uade.local.subjects` in init scripts and removing `localStorage.removeItem` that caused data loss on navigation.
- Fixed batch mock format to include `material: { status }` nested object.
- Fixed test 5 expectation: single error material preserves original `"Procesamiento con error"` behavior instead of grouped message.
- Fixed test 6 by using dedicated batch-only route counter and `not.toContainText` assertion to verify non-grouping without relying on simultaneous toast visibility.
- All 6 processing-notification tests pass.

### File List

- `frontend/src/services/processing-notifications.js`
- `frontend/src/components/Toast.js`
- `frontend/src/styles/components.css`
- `frontend/tests/processing-notifications.spec.js`

### Review Findings

- [x] [Review][Patch] XSS: escape `title` and `message` in `Toast.js` via `escapeHtml` [`Toast.js:39-40`] — **Fixed** in commit `1544d63`
- [x] [Review][Patch] `flushToastBuffer` abort leaves stale buffer/timeout [`processing-notifications.js:23-54`] — **Fixed**: buffer cleared before iteration, toast calls wrapped in try/catch
- [x] [Review][Patch] Unknown terminal values silently dropped instead of fallback to error [`processing-notifications.js:27-29`] — **Fixed**: non-ready/non-error terminals fallback to `error` bucket
- [x] [Review][Patch] Non-string/null `details` elements render ghost `<li>` bullets [`Toast.js:32`] — **Fixed**: filter null/empty before rendering
- [x] [Review][Defer] Listeners fire immediately but toast delayed up to 3s — UX gap where state change precedes notification [`processing-notifications.js:293-301`] — deferred, pre-existing architectural pattern
- [x] [Review][Defer] Sliding window groups chain arrivals within 3s of each other, not fixed window from first completion [`processing-notifications.js:56-58`] — deferred, no AC explicitly requires fixed window
