import { api } from './api.js';

function cacheKey(userId) {
  return `uade.enrollments.${userId || 'anonymous'}`;
}
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCachedEnrollments(userId) {
  try {
    const raw = sessionStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey(userId));
      return null;
    }
    return data;
  } catch {
    sessionStorage.removeItem(cacheKey(userId));
    return null;
  }
}

function setCachedEnrollments(userId, enrollments) {
  sessionStorage.setItem(cacheKey(userId), JSON.stringify({
    data: enrollments,
    timestamp: Date.now(),
  }));
}

function currentUserId() {
  try {
    return sessionStorage.getItem('edu_uid') || 'anonymous';
  } catch {
    return 'anonymous';
  }
}

export const enrollments = {
  async fetchMyEnrollments(userId) {
    const uid = userId || currentUserId();
    const cached = getCachedEnrollments(uid);
    if (cached) return cached;

    try {
      const data = await api.getEnrollments(uid);
      const enrollmentsList = Array.isArray(data) ? data : (data?.data || []);
      if (enrollmentsList.length > 0) {
        setCachedEnrollments(uid, enrollmentsList);
      }
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

  getCachedEnrollments(userId) {
    const uid = userId || currentUserId();
    const cached = getCachedEnrollments(uid);
    return cached || [];
  },

  getEnrolledSubjectIds(userId) {
    const uid = userId || currentUserId();
    const cached = getCachedEnrollments(uid);
    if (!cached) return [];
    return cached
      .filter(e => e.status === 'active')
      .map(e => e.subjectId);
  },

  isEnrolled(subjectId, userId) {
    const uid = userId || currentUserId();
    const cached = getCachedEnrollments(uid);
    if (!cached) return null;
    const enrollment = cached.find(e => e.subjectId === subjectId);
    if (!enrollment) return false;
    return enrollment.status === 'active';
  },

  getEnrollmentRole(subjectId, userId) {
    const uid = userId || currentUserId();
    const cached = getCachedEnrollments(uid);
    if (!cached) return null;
    const enrollment = cached.find(e => e.subjectId === subjectId);
    return enrollment?.role || null;
  },

  clearCache(userId) {
    const uid = userId || currentUserId();
    sessionStorage.removeItem(cacheKey(uid));
  },
};
