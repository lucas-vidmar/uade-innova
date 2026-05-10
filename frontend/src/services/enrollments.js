import { api } from './api.js';

const ENROLLMENTS_CACHE_KEY = 'uade.enrollments';
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCachedEnrollments() {
  try {
    const raw = sessionStorage.getItem(ENROLLMENTS_CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      sessionStorage.removeItem(ENROLLMENTS_CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    sessionStorage.removeItem(ENROLLMENTS_CACHE_KEY);
    return null;
  }
}

function setCachedEnrollments(enrollments) {
  sessionStorage.setItem(ENROLLMENTS_CACHE_KEY, JSON.stringify({
    data: enrollments,
    timestamp: Date.now(),
  }));
}

export const enrollments = {
  async fetchMyEnrollments(userId) {
    const cached = getCachedEnrollments();
    if (cached) return cached;

    try {
      const data = await api.getEnrollments(userId);
      const enrollmentsList = Array.isArray(data) ? data : (data?.data || []);
      setCachedEnrollments(enrollmentsList);
      return enrollmentsList;
    } catch (err) {
      console.error('[Enrollments] fetchMyEnrollments failed:', err);
      return [];
    }
  },

  async checkEnrollment(userId, subjectId) {
    try {
      const data = await api.checkEnrollment(userId, subjectId);
      return data?.data || data || { enrolled: false, role: null, status: null };
    } catch (err) {
      console.error('[Enrollments] checkEnrollment failed:', err);
      return { enrolled: false, role: null, status: null };
    }
  },

  getCachedEnrollments() {
    const cached = getCachedEnrollments();
    return cached || [];
  },

  getEnrolledSubjectIds() {
    const cached = getCachedEnrollments();
    if (!cached) return [];
    return cached
      .filter(e => e.status === 'active')
      .map(e => e.subjectId);
  },

  isEnrolled(subjectId) {
    const cached = getCachedEnrollments();
    if (!cached) return null;
    const enrollment = cached.find(e => e.subjectId === subjectId);
    if (!enrollment) return false;
    return enrollment.status === 'active';
  },

  getEnrollmentRole(subjectId) {
    const cached = getCachedEnrollments();
    if (!cached) return null;
    const enrollment = cached.find(e => e.subjectId === subjectId);
    return enrollment?.role || null;
  },

  clearCache() {
    sessionStorage.removeItem(ENROLLMENTS_CACHE_KEY);
  },
};
