# Acceptance Auditor Review — Story 1.2 (Role-Based Dashboard Routing)

Review this diff against the spec.

## Diff

```
diff --git a/frontend/src/components/Sidebar.js b/frontend/src/components/Sidebar.js
index 6c14dd2..ca5c482 100644
--- a/frontend/src/components/Sidebar.js
+++ b/frontend/src/components/Sidebar.js
@@ -39,10 +39,12 @@ export function renderSidebar() {
 
   const activeSubjectId = auth.getActiveSubjectId();
   const subjects = auth.getEnrolledSubjects();
-  const activeSubject = subjects.find(s => s.id === activeSubjectId) || subjects[0] || { name: 'Materia' };
-  const displaySubjectName = activeSubject.name.includes('(2026-1)')
-    ? activeSubject.name
-    : `${activeSubject.name} (2026-1)`;
+  const activeSubject = subjects.find(s => s.id === activeSubjectId) || subjects[0] || { name: 'Sin materias asignadas', id: null };
+  const displaySubjectName = subjects.length === 0
+    ? 'Sin materias asignadas'
+    : (activeSubject.name.includes('(2026-1)')
+        ? activeSubject.name
+        : `${activeSubject.name} (2026-1)`);
 
   const appEl = document.getElementById('app');
   const existingNav = document.getElementById('top-nav');
diff --git a/frontend/src/main.js b/frontend/src/main.js
index 4017eb8..1698e66 100644
--- a/frontend/src/main.js
+++ b/frontend/src/main.js
@@ -62,10 +62,20 @@ async function handleRoute() {
     buildShell();
     renderSidebar();
 
-    // Route Guard: Admin paths
-    if (matchedPath.startsWith('/admin') && auth.getRole() !== 'director') {
-        console.warn('[Router] Access Denied to admin path');
-        window.location.hash = `#/${auth.getRole()}/dashboard`;
+    // Route Guard: Role-based access control
+    const expectedRole = matchedPath.split('/')[1]; // "student", "teacher", "director", "admin"
+    const actualRole = auth.getRole();
+
+    const rolePrefixMap = {
+        student: ['student'],
+        teacher: ['teacher'],
+        director: ['director', 'admin'],
+    };
+
+    const allowedPrefixes = rolePrefixMap[actualRole] || ['student'];
+    if (!allowedPrefixes.includes(expectedRole)) {
+        console.warn(`[Router] Access Denied: ${actualRole} cannot access ${matchedPath}`);
+        window.location.hash = `#/${actualRole}/dashboard`;
         return;
     }
 
@@ -115,11 +125,27 @@ async function bootstrap() {
         renderPrivacyModal();
     }
     
-    // Default hash on first load
+    // Default hash on first load — or redirect if hash doesn't match role
     if (!window.location.hash) {
         window.location.hash = `#/${auth.getRole()}/dashboard`;
     } else {
-        handleRoute();
+        // Verify the current hash path matches the authenticated role
+        const hashPath = window.location.hash.replace(/^#/, '').split('?')[0];
+        const hashRole = hashPath.split('/')[1];
+        const actualRole = auth.getRole();
+
+        const rolePrefixMap = {
+            student: ['student'],
+            teacher: ['teacher'],
+            director: ['director', 'admin'],
+        };
+        const allowedPrefixes = rolePrefixMap[actualRole] || ['student'];
+
+        if (!allowedPrefixes.includes(hashRole)) {
+            window.location.hash = `#/${actualRole}/dashboard`;
+        } else {
+            handleRoute();
+        }
+    }
 }
 
```

## Spec: Story 1.2 — Role-Based Dashboard Routing

### Acceptance Criteria

**AC1:** Role-Based Post-Auth Redirection — Given I successfully authenticate, When `auth.initAuth()` completes, Then redirected to role-appropriate dashboard.

**AC2:** Cross-Role Route Guard — Student cannot access teacher/director routes. Teacher cannot access student/director routes. Director cannot access student/teacher routes (but CAN access admin routes).

**AC3:** Teacher Subject Filtering — Teacher dropdown only shows subjects where `Enrollments` record has `role="teacher"`. Student shows all active enrollments.

**AC4:** Unknown Route Handling — Non-existent route redirects to role dashboard, not generic 404.

**AC5:** Role Change Triggers Redirection — When role changes, user is redirected to new role's dashboard.

### Tasks/Subtasks

- Task 1: Cross-role route guards in `handleRoute()` with rolePrefixMap
- Task 2: Post-auth redirection in `bootstrap()` with hash-role verification  
- Task 3: Teacher subject filtering with "Sin materias asignadas" empty state
- Task 4: Role change redirection (via `auth:roleChanged`)
- Task 5: Manual testing verified
- Task 6: Deployed and verified in production

Check for:
- Violations of acceptance criteria
- Deviations from spec intent
- Missing implementation of specified behavior
- Contradictions between spec constraints and actual code
- AC1: Is post-auth redirection correctly implemented in bootstrap?
- AC2: Are ALL cross-role combinations handled? (student→teacher, student→director, teacher→student, teacher→director, director→student, director→teacher, director→admin allowed)
- AC3: Is teacher subject filtering actually enforced (or is it just a display string change)?
- AC4: Is the unknown route redirect preserved?
- AC5: Does role change redirect work?

Output findings as a Markdown list. Each finding: one-line title, which AC/constraint it violates, and evidence from the diff.
