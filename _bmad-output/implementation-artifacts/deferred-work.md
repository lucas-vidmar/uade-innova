# Deferred Work

## Deferred from: code review of 6-1-adoption-and-cost-dashboard (2026-06-01)

- classIds empty string validation — pre-existing input validation gap, not introduced by this change [ingest-material.js:55]
- Unbounded response size growth — all session metrics returned without pagination; pre-existing architecture concern, not introduced by this change [classes-api.js:1106-1122]
- Missing subject/class dropdown filter in frontend — deferred to post-pilot; acceptable for single-subject pilot phase [Dashboard.js:504]

## Deferred from: code review of 6-1-adoption-and-cost-dashboard (2026-06-05)

- WAUS previousWeek always 0 for small date windows (days < 7) — edge case when PowerBI endpoint called with narrow window; pilot uses 30-day window [classes-api.js:82-89]
- API response format not using { success, data, meta } wrapper — pre-existing pattern violation across all endpoints [classes-api.js]
- resolveSlideTitleForChunk only matches first slide marker in multi-slide chunks — belongs to Story 2.161, not 6.1 [pipeline.js:278]

## Deferred from: code review of 2-161-slide-title-metadata-extraction-for-pptx (2026-06-13)

- Pipeline tests are unit-mocked, not integration-tested against real PPTX buffer [pipeline.test.js] — pre-existing pattern
- Multi-slide chunk test missing (guardrail #4) — addressed by future test
- No test for "key absent" vs null (guardrail #5) — addressed by future test
- decodeXmlEntities shared helper usage — verified at parser.js:398, no action
- context.log.warn may not exist — false positive, used elsewhere in codebase
- Slide number clamp on chunk text — handled by truthy check
- Hidden coupling to [Diapositiva N] marker — by design (guardrail #4)
- Pinecone metadata schema changes silently for legacy vectors — handled by `?.slideTitle` (AC #5)
- Title overflow tooltip — UX nit, cosmetic
- Zip opened twice — pre-existing, story explicitly says don't optimize
- Single-quoted attribute regex — PowerPoint always double-quotes
- Empty title map noise — minor log clarity, low value
- Logged slide-title count misleading — cosmetic
- Regex truncates multi-run titles — false positive (matchAll already iterates all <a:t>)

## Deferred from: code review of 2-187-teacher-onboarding-guide (2026-06-17)

- XSS via innerHTML — step content is currently hardcoded (safe), but if steps ever load dynamically this becomes a vector [OnboardingOverlay.js:62-76]
- No position-fallback strategy when tooltip overflows viewport — tooltip can overlap target when viewport is small [OnboardingOverlay.js:96-128]
- Missing prefers-reduced-motion support for onboarding animations — accessibility enhancement [OnboardingOverlay.js, components.css]
- scrollIntoView smooth scrolling can disorient users mid-tour — UX polish [OnboardingOverlay.js:139]
- Tooltip position class never updated on viewport resize (e.g., mobile→desktop mid-tour) — cosmetic [OnboardingOverlay.js:56-58]
- CSS variable mismatch: spec says `--surface-1`, project uses `--color-surface` — pre-existing convention, not a bug [components.css]

## Deferred from: code review of 2-5-actionable-error-handling (2026-06-17)

- Auth bypass via `!principal` in reprocess endpoint — pre-existing pattern across classes-api.js, not introduced by this story [classes-api.js:1299-1301]
- Stale closure over `selectedSubjectId` in event listeners — pre-existing pattern in MaterialManager.js, same issue affects delete handler [MaterialManager.js:513]
- FileUpload.js retry button not implemented — listed in Code Map but not in Tasks & Acceptance; deferred to future story [FileUpload.js]
- Concurrent reprocess of same material could trigger duplicate pipeline runs — rare edge case in single-user scenario, acceptable for pilot [classes-api.js]
- Blob fetch from private containers fails without SAS — the reprocess endpoint re-uploads via URL which requires public/anonymous access or SAS; use alternative re-trigger mechanism in future iteration
- Test coverage: blob re-upload failure paths not covered — pre-existing test gap pattern across all endpoints [material-status.test.js]

## Deferred from: code review of 4-3-verified-answer-boost-in-rag (2026-06-18)

- Missing type guard for `correctedAnswer` before `.trim()` — pre-existing issue; a non-string `correctedAnswer` would throw TypeError [verify-answer/index.js:205]
- No max length validation on `correctedAnswer` — pre-existing, unlike `explanation` which has `MAX_EXPLANATION_LENGTH = 5000`; long answers can exceed embedding token limits or Pinecone metadata size after state store is irreversibly updated [verify-answer/index.js]
- Empty/whitespace-only `correctedAnswer` silently stored — pre-existing; no guard against empty string up front [verify-answer/index.js:59]

## Deferred from: review of spec-165-sync-ingestion-tracking-across-tabs (2026-06-18)

- Cross-tab broadcast toasts bypass the 3s grouping buffer — receiving tab shows individual toasts instead of grouped; creates UX inconsistency between polling tab and broadcast-receiving tab [processing-notifications.js:89-92]
- No subjectId validation against current auth context in handleBroadcast — all tabs share same auth, but defensive check would prevent edge cases [processing-notifications.js:55-96]
- Non-terminal value in broadcast payload defaults to error toast — graceful fallback is acceptable, but unexpected values should be handled explicitly [processing-notifications.js:89-93]

## Deferred from: review of spec-3-169-context-selection-guardrail (2026-06-19)

- Accessibility: warning div has no `role="alert"` or `aria-live` region — screen readers won't announce dynamic appearance/disappearance [ChatWidget.js:81-86]
- No dismiss mechanism for warning — user can't permanently dismiss it for the session (intentional per spec, but worth revisiting)
- No i18n framework — hardcoded Spanish string will need extraction if app is ever localized
