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
    getClassSummary, saveClassSummary, setClassPublicationState, publishClassSummaryNow, getClassAudioUrl,
    getClassMap, saveClassMap, getClassTimeline, saveClassTimeline,
    generateClassAssets,
    getClassAudioScript, saveClassAudioScript,
    generateClassAudioScript, generateClassAudio,
    getLocalClassViews, setLocalClassView, trackClassView, getClassViews
} from './classes.api.js';
import {
    ragQuery, ragQueryStream, globalSearch,
    getChatHistory, clearChatHistory, deleteChatSession, sendChatFeedback,
    sendChatRating, getSatAnalytics, reportChatIssue,
    reportMissingInfo, reportMissingKeyword,
    saveConversation, listConversations, getConversation, deleteConversation
} from './rag.api.js';
import {
    getMaterialStatus, getMaterialStatusBatch, _getMaterialStatusBatchGet, ingestMaterial,
    deleteMaterial, reprocessMaterial, updateMaterial,
    retireMaterial, restoreMaterial,
    getMaterialText, updateMaterialText, getMaterialDownloadUrl
} from './materials.api.js';
import {
    getNotifications, markNotificationRead, markNotificationsRead,
    dispatchClassPublishNotification,
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
    getEnrollmentsBySubject,
    getInterventions, updateIntervention, computeInterventions,
    getRiskThresholds, updateRiskThresholds
} from './sga.api.js';
import {
    getProfile, saveProfile, getTerms, getConsent, saveConsent,
    getReminderPreferences, saveReminderPreferences
} from './profile.api.js';
import {
    getDirectorStats, getDirectorKpiExport, getDirectorPowerBiMetrics,
    getSafetyRate, getAdminUsers, getVectorHealth, getArchiveUsage,
    getRetentionPolicy, getRetentionExport, saveRetentionPolicy,
    getDeletionRecords, getDeletionRecord, verifyDeletionRecord,
    getSubjectWeights, saveSubjectWeights,
    getAdminConfig, saveAdminConfig, resetAdminConfig,
    createAdminUser, updateAdminUser, deleteAdminUser, resetAdminUserPassword,
    getIdentityAudit,
    getVectorIndex, quarantineVectorIndex,
    getAccessReview, getAccessReviewCsv, decideAccessReview, openAccessReview, signAccessReview
} from './admin.api.js';
import {
    login as authLogin, logout as authLogout,
    changePassword, getMe
} from './auth.api.js';
import {
    getTeacherAiFeedbackAlerts, getCorrectionsPending,
    verifyAnswer, updateCorrectionStatus, reviewCorrection, getCorrection,
    getCorrectionChatContext,
    getGlossary, getGlossaryTerm, updateGlossary,
    getTranscriptionSuggestions, applyTranscriptionCorrection, applyTranscriptionCorrections,
    rejectTranscriptionSuggestion,
    getStudentReports,
    submitGradeDispute,
    getGradeDisputes,
    resolveGradeDispute,
} from './corrections.api.js';
import {
    getPromptTypes, getPromptVersions, getActivePrompt, getAvailablePromptVersions,
    createPromptVersion, updatePromptVersion,
    activatePromptVersion, deletePromptVersion
} from './prompts.api.js';
import {
    generateQuiz, saveQuizResult, getQuizResult, getQuizAttempts,
    getQuizWeakTopics, saveQuizWeakTopics
} from './quiz.api.js';

export const api = {
    BASE_URL, CORRELATION_HEADER,
    nextCorrelationId, withCorrelationHeaders,
    apiFetch, fetchWithTimeout,
    readLocalJson, writeLocalJson,

    getSubjects, saveSubject, deleteSubject,

    getClasses, saveClasses, saveClass, deleteClass,
    getClassSummary, saveClassSummary, setClassPublicationState, publishClassSummaryNow, getClassAudioUrl,
    getClassMap, saveClassMap, getClassTimeline, saveClassTimeline,
    generateClassAssets,
    getClassAudioScript, saveClassAudioScript,
    generateClassAudioScript, generateClassAudio,
    getLocalClassViews, setLocalClassView, trackClassView, getClassViews,

    ragQuery, ragQueryStream, globalSearch,
    getChatHistory, clearChatHistory, deleteChatSession, sendChatFeedback,
    sendChatRating, getSatAnalytics, reportChatIssue, reportMissingInfo, reportMissingKeyword,
    saveConversation, listConversations, getConversation, deleteConversation,

    getMaterialStatus, getMaterialStatusBatch, _getMaterialStatusBatchGet, ingestMaterial,
    deleteMaterial, reprocessMaterial, updateMaterial,
    retireMaterial, restoreMaterial,
    getMaterialText, updateMaterialText, getMaterialDownloadUrl,

    getNotifications, markNotificationRead, markNotificationsRead,
    dispatchClassPublishNotification,
    subscribeNotificationStream,

    getDeadlines, saveDeadline, deleteDeadline, getDeadlineReminders,

    getTasks, getEarlyAlerts, getAttendanceStats,
    getTeacherAnalytics, getTeacherAlerts,
    getEnrollments, checkEnrollment,
    createEnrollment, deleteEnrollment,
    getEnrollmentsBySubject,
    getInterventions, updateIntervention, computeInterventions,
    getRiskThresholds, updateRiskThresholds,

    getProfile, saveProfile, getTerms, getConsent, saveConsent,
    getReminderPreferences, saveReminderPreferences,

    getDirectorStats, getDirectorKpiExport, getDirectorPowerBiMetrics,
    getSafetyRate, getAdminUsers, getVectorHealth, getArchiveUsage,
    getVectorIndex, quarantineVectorIndex,
    getRetentionPolicy, getRetentionExport, saveRetentionPolicy,
    getDeletionRecords, getDeletionRecord, verifyDeletionRecord,
    getSubjectWeights, saveSubjectWeights,
    getAdminConfig, saveAdminConfig, resetAdminConfig,
    createAdminUser, updateAdminUser, deleteAdminUser, resetAdminUserPassword,
    getIdentityAudit,
    getAccessReview, getAccessReviewCsv, decideAccessReview, openAccessReview, signAccessReview,

    login: authLogin,
    logout: authLogout,
    changePassword,
    getMe,

    getTeacherAiFeedbackAlerts, getCorrectionsPending,
    verifyAnswer, updateCorrectionStatus, reviewCorrection, getCorrection,
    getCorrectionChatContext,
    getGlossary, getGlossaryTerm, updateGlossary,
    getTranscriptionSuggestions, applyTranscriptionCorrection, applyTranscriptionCorrections,
    rejectTranscriptionSuggestion,
    getStudentReports, submitGradeDispute, getGradeDisputes, resolveGradeDispute,

    getPromptTypes, getPromptVersions, getActivePrompt, getAvailablePromptVersions,
    createPromptVersion, updatePromptVersion,
    activatePromptVersion, deletePromptVersion,

    generateQuiz, saveQuizResult, getQuizResult, getQuizAttempts,
    getQuizWeakTopics, saveQuizWeakTopics,
};
