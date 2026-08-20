import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
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
  return principal?.userRoles?.some(r => ['Docente', 'Director', 'Admin'].includes(r));
}

function isDirector(principal) {
  return principal?.userRoles?.some(r => ['Director', 'Admin'].includes(r));
}

function isTeacher(principal) {
  return principal?.userRoles?.includes('Docente');
}

/**
 * Teacher-scope guard (Story 1.6): a teacher may only manage assignments in the
 * subjects they are themselves enrolled as teacher. Directors bypass the guard.
 * @param {Request} request
 * @param {Object} context
 * @param {string} subjectId
 * @returns {Promise<Object|string|null>} error response when denied, callerId when allowed
 */
async function assertTeacherSubjectScope(request, context, subjectId) {
  const principal = parseClientPrincipal(request);
  const callerId = context.user?.id || principal?.userId || principal?.oid || null;
  if (isDirector(principal)) return callerId;
  if (!isTeacher(principal)) {
    return { error: jsonResponse(403, { success: false, error: { code: 'INSUFFICIENT_ROLE', message: 'Teacher or Director role required' } }) };
  }
  // Fail closed: without a resolvable caller id a teacher cannot manage any subject.
  if (!callerId) {
    return { error: jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'No se pudo verificar tu identidad.' } }) };
  }
  const myEnrollments = await getEnrollmentsByUser(callerId);
  const teacherSubjects = myEnrollments
    .filter(e => e.role === 'teacher' && e.status === 'active')
    .map(e => e.subjectId);
  if (!teacherSubjects.includes(subjectId)) {
    context.log(`[Enrollment] Denied: teacher ${callerId} no asignado a materia ${subjectId}.`);
    return { error: jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Solo podés asignar alumnos y docentes en tus propias materias.' } }) };
  }
  return callerId;
}

// ── GET /api/enrollments?userId={userId} ───────────────────────
app.http('get-enrollments', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'enrollments',
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FRONTDOOR_INVALID', message: 'Forbidden' } });
    
    const principal = parseClientPrincipal(request);
    // Application id resolved from the allowlist (Story 10.24): pilot data key
    // / email. Used for self-scoped lookups so students read their own data.
    const callerId = context.user?.id || principal?.userId || principal?.oid || null;
    const roles = principal?.userRoles || [];
    const isTeacher = roles.includes('Docente');
    const isDir = roles.includes('Director') || roles.includes('Admin');

    const requestedUserId = request.query.get('userId');
    const subjectId = request.query.get('subjectId');

    if (subjectId && requestedUserId) {
      // Directors/teachers may inspect any user; a student only themselves.
      const effectiveUserId = (!isDir && !isTeacher) ? callerId : requestedUserId;
      if (!effectiveUserId) {
        return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Solo puedes ver tus propias inscripciones.' } });
      }

      const enrollment = await getEnrollment(subjectId, effectiveUserId);
      return jsonResponse(200, {
        success: true,
        data: enrollment
          ? { enrolled: true, role: enrollment.role, status: enrollment.status }
          : { enrolled: false, role: null, status: null },
        meta: { timestamp: new Date().toISOString() },
      });
    }

    if (subjectId) {
      // Permission check: Only Director/Teacher can list enrollments of a subject
      if (!isDir && !isTeacher) {
        return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Solo docentes o directores pueden ver la lista de inscriptos.' } });
      }
      // Story 1.6: a teacher may only list the roster of their own subjects;
      // Directors bypass the guard. Denied teachers get 403 (fail closed).
      if (isTeacher && !isDir) {
        const scoped = await assertTeacherSubjectScope(request, context, subjectId);
        if (scoped && scoped.error) return scoped.error;
      }

      const enrollments = await getEnrollmentsBySubject(subjectId);
      return jsonResponse(200, {
        success: true,
        data: enrollments,
        meta: { timestamp: new Date().toISOString() },
      });
    }

    if (!requestedUserId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId is required' } });
    }

    // Self lookup always resolves the caller's verified id; dir/teacher may
    // query any user's enrollments.
    const effectiveUserId = (!isDir && !isTeacher) ? callerId : requestedUserId;
    if (!effectiveUserId) {
      return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Solo puedes ver tus propias inscripciones.' } });
    }

    const enrollments = await getEnrollmentsByUser(effectiveUserId);
    return jsonResponse(200, {
      success: true,
      data: enrollments,
      meta: { timestamp: new Date().toISOString() },
    });
  })),
});

// ── GET /api/enrollments/check?userId={userId}&subjectId={subjectId} ─
app.http('check-enrollment', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'enrollments/check',
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });

    const principal = parseClientPrincipal(request);
    const callerId = context.user?.id || principal?.userId || principal?.oid || null;
    const roles = principal?.userRoles || [];
    const isTeacher = roles.includes('Docente');
    const isDir = roles.includes('Director') || roles.includes('Admin');
    const requestedUserId = request.query.get('userId');
    const subjectId = request.query.get('subjectId');

    if (!requestedUserId || !subjectId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_PARAMS', message: 'userId and subjectId are required' } });
    }

    // Permission check: Director/Teacher or the user themselves
    const effectiveUserId = (!isDir && !isTeacher) ? callerId : requestedUserId;
    if (!effectiveUserId) {
      return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Solo puedes verificar tu propia inscripción.' } });
    }

    const enrollment = await getEnrollment(subjectId, effectiveUserId);
    return jsonResponse(200, {
      success: true,
      data: enrollment
        ? { enrolled: true, role: enrollment.role, status: enrollment.status }
        : { enrolled: false, role: null, status: null },
      meta: { timestamp: new Date().toISOString() },
    });
  })),
});

// ── POST /api/enrollments (teacher/director only) ───────────────
app.http('create-enrollment', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'enrollments',
    handler: withCorrelation(withAuth(async (request, context) => {
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

    // Teachers may only manage their own subjects (Story 1.6).
    const scope = await assertTeacherSubjectScope(request, context, subjectId);
    if (scope?.error) {
      return scope.error;
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
  })),
});

// ── DELETE /api/enrollments?userId={userId}&subjectId={subjectId} (director only) ─
app.http('delete-enrollment', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'enrollments',
    handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });

    const principal = parseClientPrincipal(request);
    if (!isTeacherOrDirector(principal)) {
      return jsonResponse(403, { success: false, error: { code: 'INSUFFICIENT_ROLE', message: 'Teacher or Director role required' } });
    }

    const userId = request.query.get('userId');
    const subjectId = request.query.get('subjectId');

    if (!userId || !subjectId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_PARAMS', message: 'userId and subjectId are required' } });
    }

    // Teachers may only manage their own subjects (Story 1.6).
    const scope = await assertTeacherSubjectScope(request, context, subjectId);
    if (scope?.error) {
      return scope.error;
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
  })),
});
