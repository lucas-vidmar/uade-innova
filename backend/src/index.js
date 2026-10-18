/**
 * src/index.js — Entry point for Node.js V4 Functions.
 * Static imports keep startup compatible with older host builds.
 */

// Enable HTTP streaming (SSE responses). Best-effort: older hosts (< v4.28)
// reject this setting; the stream then degrades to a buffered response rather
// than failing app startup. Required for the notifications SSE channel
// (Story 10.24 — without it the host never flushes the endless stream body).
import { app } from '@azure/functions';
try {
  app.setup({ enableHttpStream: true });
} catch (err) {
  console.warn(`[index] HTTP streaming disabled: ${err?.message || err}`);
}

import './functions/hello.js';
import './functions/classes-api.js';
import './functions/deadlines.js';
import './functions/class-timeline.js';
import './functions/get-tasks.js';
import './functions/admin-api.js';
import './functions/chat-api.js';
import './functions/conversations-api.js';
import './functions/enrollments-api.js';
import './functions/get-profile.js';
import './functions/auth-api.js';
import './functions/get-roles.js';
import './functions/save-profile.js';
import './functions/vector-health.js';
import './functions/vector-index-api.js';
import './functions/global-search.js';
import './functions/notifications.js';
import './functions/sga-api.js';
import './functions/interventions-api.js';
import './functions/ingest-material.js';
import './functions/process-material.js';
import './functions/rag-query.js';
import './functions/post-class-summary-dispatcher.js';
import './functions/deadline-proximity-dispatcher.js';
import './functions/consent-api.js';
import './functions/corrections/get-pending-reports/index.js';
import './functions/corrections/verify-answer/index.js';
import './functions/corrections/update-status/index.js';
// Transcription correction with glossary (Story 2.186)
import './functions/glossary/get-glossary/index.js';
import './functions/glossary/update-glossary/index.js';
import './functions/corrections-transcription/get-suggestions/index.js';
import './functions/corrections-transcription/apply-correction/index.js';
import './functions/corrections-transcription/reject-suggestion/index.js';
import './functions/compliance-api.js';
import './functions/subject-weights-api.js';
import './functions/admin-config-api.js';
import './functions/vector-backup.js';
import './functions/vector-backup-scheduler.js';
import './functions/backup-approval-api.js';
import './functions/storage-lifecycle.js';
import './functions/analytics.js';
import './functions/sat-analytics.js';
import './functions/vector-health-monitor.js';
import './functions/vector-health-snapshotter.js';
import './functions/vector-health-snapshots-api.js';
import './functions/director-kpi-export.js';
import './functions/archive-usage.js';
import './functions/grade-dispute.js';
import './functions/grade-dispute-resolve.js';
import './functions/reminder-preferences.js';
import './functions/audio-api.js';
import './functions/material-download.js';
import './functions/prompts-api.js';
import './functions/cors-preflight.js';
import './functions/class-views-api.js';
import './functions/quiz-api.js';
import './functions/access-review-api.js';
