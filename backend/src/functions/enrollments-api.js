import { app } from '@azure/functions';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { getEnrollment, getEnrollmentsByUser, getEnrollmentsBySubject, upsertEnrollment, deleteEnrollment } from '../services/state-store.js';

function jsonResponse(status, payload) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function isTeacherOrDirector(principal) {
  return process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development'
    || principal?.userRoles?.some(r => ['Docente', 'Director'].includes(r));
}

function isDirector(principal) {
  return process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development'
    || principal?.userRoles?.includes('Director');
}

// ── GET /api/enrollments?userId={userId} ───────────────────────
app.http('get-enrollments', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'enrollments',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });

    const userId = request.query.get('userId');
    const subjectId = request.query.get('subjectId');

    if (subjectId && userId) {
      const enrollment = await getEnrollment(subjectId, userId);
      return jsonResponse(200, {
        success: true,
        data: enrollment
          ? { enrolled: true, role: enrollment.role, status: enrollment.status }
          : { enrolled: false, role: null, status: null },
        meta: { timestamp: new Date().toISOString() },
      });
    }

    if (subjectId) {
      const enrollments = await getEnrollmentsBySubject(subjectId);
      return jsonResponse(200, {
        success: true,
        data: enrollments,
        meta: { timestamp: new Date().toISOString() },
      });
    }

    if (!userId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId is required' } });
    }

    const enrollments = await getEnrollmentsByUser(userId);
    return jsonResponse(200, {
      success: true,
      data: enrollments,
      meta: { timestamp: new Date().toISOString() },
    });
  },
});

// ── GET /api/enrollments/check?userId={userId}&subjectId={subjectId} ─
app.http('check-enrollment', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'enrollments/check',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });

    const userId = request.query.get('userId');
    const subjectId = request.query.get('subjectId');

    if (!userId || !subjectId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_PARAMS', message: 'userId and subjectId are required' } });
    }

    const enrollment = await getEnrollment(subjectId, userId);
    return jsonResponse(200, {
      success: true,
      data: enrollment
        ? { enrolled: true, role: enrollment.role, status: enrollment.status }
        : { enrolled: false, role: null, status: null },
      meta: { timestamp: new Date().toISOString() },
    });
  },
});

// ── POST /api/enrollments (teacher/director only) ───────────────
app.http('create-enrollment', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'enrollments',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });

    const principal = parseClientPrincipal(request);
    if (!isTeacherOrDirector(principal)) {
      return jsonResponse(403, { success: false, error: { code: 'INSUFFICIENT_ROLE', message: 'Teacher or Director role required' } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } });
    }

    const { subjectId, userId, role, status } = body;
    if (!subjectId || !userId || !role) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_FIELDS', message: 'subjectId, userId, and role are required' } });
    }

    if (!['student', 'teacher'].includes(role)) {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_ROLE', message: 'role must be "student" or "teacher"' } });
    }

    try {
      const enrollment = await upsertEnrollment({
        subjectId,
        userId,
        role,
        status: status || 'active',
        enrolledAt: body.enrolledAt || new Date().toISOString(),
      });
      context.log(`[Enrollment] Created: subjectId=${subjectId}, userId=${userId}, role=${role}`);
      return jsonResponse(200, {
        success: true,
        data: enrollment,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      context.error(`[Enrollment] Error creating enrollment: ${err.message}`);
      return jsonResponse(500, { success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  },
});

// ── DELETE /api/enrollments?userId={userId}&subjectId={subjectId} (director only) ─
app.http('delete-enrollment', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'enrollments',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });

    const principal = parseClientPrincipal(request);
    if (!isDirector(principal)) {
      return jsonResponse(403, { success: false, error: { code: 'INSUFFICIENT_ROLE', message: 'Director role required' } });
    }

    const userId = request.query.get('userId');
    const subjectId = request.query.get('subjectId');

    if (!userId || !subjectId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_PARAMS', message: 'userId and subjectId are required' } });
    }

    try {
      const deleted = await deleteEnrollment(subjectId, userId);
      context.log(`[Enrollment] Deleted: subjectId=${subjectId}, userId=${userId}, result=${deleted}`);
      return jsonResponse(200, {
        success: true,
        data: { deleted },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      context.error(`[Enrollment] Error deleting enrollment: ${err.message}`);
      return jsonResponse(500, { success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  },
});
