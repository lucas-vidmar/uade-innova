/**
 * src/index.js — Entry point for Node.js V4 Functions.
 * Static imports keep startup compatible with older host builds.
 */
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
import './functions/get-roles.js';
import './functions/save-profile.js';
import './functions/vector-health.js';
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
// Transcription correction with glossary (Story 2.186)
import './functions/glossary/get-glossary/index.js';
import './functions/glossary/update-glossary/index.js';
import './functions/corrections-transcription/get-suggestions/index.js';
import './functions/corrections-transcription/apply-correction/index.js';
import './functions/corrections-transcription/reject-suggestion/index.js';
import './functions/compliance-api.js';
import './functions/subject-weights-api.js';
import './functions/vector-backup.js';
import './functions/vector-backup-scheduler.js';
import './functions/backup-approval-api.js';
import './functions/storage-lifecycle.js';
import './functions/sat-analytics.js';
import './functions/vector-health-monitor.js';
import './functions/vector-health-snapshotter.js';
import './functions/vector-health-snapshots-api.js';
import './functions/director-kpi-export.js';
