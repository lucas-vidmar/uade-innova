/* ============================================================
   API Service — domain module re-export hub
   Each domain concern lives in its own *.api.js module.
   Import { api } from './api.js' still works as before.
   ============================================================ */

import {
    BASE_URL, apiFetch, fetchWithTimeout, CORRELATION_HEADER,
    nextCorrelationId, withCorrelationHeaders, readLocalJson, writeLocalJson
} from './core.js';
import {
    getSubjects, saveSubject, deleteSubject
} from './subjects.api.js';
import {
    getClasses, saveClasses, saveClass, deleteClass,
    getClassSummary, saveClassSummary, getClassAudioUrl,
    getClassMap, saveClassMap, getClassTimeline, saveClassTimeline,
    generateClassAssets
} from './classes.api.js';
import {
    ragQuery, ragQueryStream, globalSearch,
    getChatHistory, clearChatHistory, sendChatFeedback,
    sendChatRating, getSatAnalytics, reportChatIssue,
    reportMissingInfo,
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
    getDeadlines, saveDeadline, deleteDeadline, getDeadlineReminders
} from './deadlines.api.js';
import {
    getTasks, getEarlyAlerts, getAttendanceStats,
    getTeacherAnalytics, getTeacherAlerts,
    getEnrollments, checkEnrollment,
    createEnrollment, deleteEnrollment,
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
    verifyAnswer, updateCorrectionStatus, reviewCorrection, getCorrection,
    getCorrectionChatContext,
    getGlossary, updateGlossary,
    getTranscriptionSuggestions, applyTranscriptionCorrection,
    rejectTranscriptionSuggestion,
    getStudentReports,
    submitGradeDispute
} from './corrections.api.js';
import {
    getPromptTypes, getPromptVersions, getActivePrompt,
    createPromptVersion, updatePromptVersion,
    activatePromptVersion, deletePromptVersion
} from './prompts.api.js';

export const api = {
    BASE_URL, CORRELATION_HEADER,
    nextCorrelationId, withCorrelationHeaders,
    apiFetch, fetchWithTimeout,
    readLocalJson, writeLocalJson,

    getSubjects, saveSubject, deleteSubject,

    getClasses, saveClasses, saveClass, deleteClass,
    getClassSummary, saveClassSummary, getClassAudioUrl,
    getClassMap, saveClassMap, getClassTimeline, saveClassTimeline,
    generateClassAssets,

    ragQuery, ragQueryStream, globalSearch,
    getChatHistory, clearChatHistory, sendChatFeedback,
    sendChatRating, getSatAnalytics, reportChatIssue, reportMissingInfo,
    saveConversation, listConversations, getConversation, deleteConversation,

    getMaterialStatus, getMaterialStatusBatch, _getMaterialStatusBatchGet, ingestMaterial,
    deleteMaterial, reprocessMaterial, updateMaterial,
    getMaterialText, updateMaterialText, getMaterialDownloadUrl,

    getNotifications, markNotificationRead, markNotificationsRead,
    subscribeNotificationStream,

    getDeadlines, saveDeadline, deleteDeadline, getDeadlineReminders,

    getTasks, getEarlyAlerts, getAttendanceStats,
    getTeacherAnalytics, getTeacherAlerts,
    getEnrollments, checkEnrollment,
    createEnrollment, deleteEnrollment,
    getInterventions, updateIntervention, computeInterventions,
    getRiskThresholds, updateRiskThresholds,

    getProfile, saveProfile, getTerms, getConsent, saveConsent,
    getReminderPreferences, saveReminderPreferences,

    getDirectorStats, getDirectorKpiExport, getDirectorPowerBiMetrics,
    getAdminUsers, getVectorHealth, getArchiveUsage,
    getRetentionPolicy, getRetentionExport,
    getSubjectWeights, saveSubjectWeights,

    getTeacherAiFeedbackAlerts, getCorrectionsPending,
    verifyAnswer, updateCorrectionStatus, reviewCorrection, getCorrection,
    getCorrectionChatContext,
    getGlossary, updateGlossary,
    getTranscriptionSuggestions, applyTranscriptionCorrection,
    rejectTranscriptionSuggestion,
    getStudentReports, submitGradeDispute,

    getPromptTypes, getPromptVersions, getActivePrompt,
    createPromptVersion, updatePromptVersion,
    activatePromptVersion, deletePromptVersion,
};
