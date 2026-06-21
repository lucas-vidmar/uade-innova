/* ============================================================
   API Service — domain module re-export hub
   Each domain concern lives in its own *.api.js module.
   Import { api } from './api.js' still works as before.
   ============================================================ */

import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, CORRELATION_HEADER,
    nextCorrelationId, withCorrelationHeaders, readLocalJson, writeLocalJson
} from './core.js';
import {
    getSubjects, saveSubject, deleteSubject
} from './subjects.api.js';
import {
    getClasses, saveClasses, saveClass, deleteClass,
    getClassSummary, saveClassSummary, getClassAudioUrl,
    getClassMap, saveClassMap, getClassTimeline, saveClassTimeline
} from './classes.api.js';
import {
    ragQuery, ragQueryStream, globalSearch,
    getChatHistory, clearChatHistory, sendChatFeedback,
    sendChatRating, getSatAnalytics, reportChatIssue,
    saveConversation, listConversations, getConversation, deleteConversation
} from './rag.api.js';
import {
    getMaterialStatus, getMaterialStatusBatch, _getMaterialStatusBatchGet, ingestMaterial,
    deleteMaterial, reprocessMaterial, updateMaterial,
    getMaterialText, updateMaterialText, getMaterialDownloadUrl
} from './materials.api.js';
import {
    getNotifications, markNotificationRead, markNotificationsRead,
    subscribeNotificationStream
} from './notifications.api.js';
import {
    getDeadlines, saveDeadline, getDeadlineReminders
} from './deadlines.api.js';
import {
    getTasks, getEarlyAlerts, getAttendanceStats,
    getTeacherAnalytics, getTeacherAlerts,
    getEnrollments, checkEnrollment,
    getInterventions, updateIntervention, computeInterventions,
    getRiskThresholds, updateRiskThresholds
} from './sga.api.js';
import {
    getProfile, saveProfile, getTerms, getConsent, saveConsent,
    getReminderPreferences, saveReminderPreferences
} from './profile.api.js';
import {
    getDirectorStats, getDirectorKpiExport, getDirectorPowerBiMetrics,
    getAdminUsers, getVectorHealth, getArchiveUsage,
    getRetentionPolicy, getRetentionExport,
    getSubjectWeights, saveSubjectWeights
} from './admin.api.js';
import {
    getTeacherAiFeedbackAlerts, getCorrectionsPending,
    verifyAnswer, updateCorrectionStatus, getCorrection,
    getGlossary, updateGlossary,
    getTranscriptionSuggestions, applyTranscriptionCorrection,
    rejectTranscriptionSuggestion
} from './corrections.api.js';

export const api = {
    USE_MOCK, BASE_URL, CORRELATION_HEADER,
    nextCorrelationId, withCorrelationHeaders,
    apiFetch, fetchWithTimeout,
    readLocalJson, writeLocalJson,

    getSubjects, saveSubject, deleteSubject,

    getClasses, saveClasses, saveClass, deleteClass,
    getClassSummary, saveClassSummary, getClassAudioUrl,
    getClassMap, saveClassMap, getClassTimeline, saveClassTimeline,

    ragQuery, ragQueryStream, globalSearch,
    getChatHistory, clearChatHistory, sendChatFeedback,
    sendChatRating, getSatAnalytics, reportChatIssue,
    saveConversation, listConversations, getConversation, deleteConversation,

    getMaterialStatus, getMaterialStatusBatch, _getMaterialStatusBatchGet, ingestMaterial,
    deleteMaterial, reprocessMaterial, updateMaterial,
    getMaterialText, updateMaterialText, getMaterialDownloadUrl,

    getNotifications, markNotificationRead, markNotificationsRead,
    subscribeNotificationStream,

    getDeadlines, saveDeadline, getDeadlineReminders,

    getTasks, getEarlyAlerts, getAttendanceStats,
    getTeacherAnalytics, getTeacherAlerts,
    getEnrollments, checkEnrollment,
    getInterventions, updateIntervention, computeInterventions,
    getRiskThresholds, updateRiskThresholds,

    getProfile, saveProfile, getTerms, getConsent, saveConsent,
    getReminderPreferences, saveReminderPreferences,

    getDirectorStats, getDirectorKpiExport, getDirectorPowerBiMetrics,
    getAdminUsers, getVectorHealth, getArchiveUsage,
    getRetentionPolicy, getRetentionExport,
    getSubjectWeights, saveSubjectWeights,

    getTeacherAiFeedbackAlerts, getCorrectionsPending,
    verifyAnswer, updateCorrectionStatus, getCorrection,
    getGlossary, updateGlossary,
    getTranscriptionSuggestions, applyTranscriptionCorrection,
    rejectTranscriptionSuggestion,
};
