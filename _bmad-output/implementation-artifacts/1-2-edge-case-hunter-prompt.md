# Edge Case Hunter Review — Story 1.2 (Role-Based Dashboard Routing)

You receive the diff and full project read access.

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

Walk every branching path and boundary condition. Read the relevant files in the project to understand context:

- `frontend/src/main.js` — router and bootstrap
- `frontend/src/components/Sidebar.js` — navigation shell
- `frontend/src/services/auth.js` — role and enrollment data
- `frontend/src/services/enrollments.js` — enrollment service

Consider:
- What happens when `auth.getRole()` returns undefined/null?
- What happens when `matchedPath` has unexpected format?
- What if the hash doesn't contain a role prefix (e.g., `#` or `#/`)?
- What about query parameters in the hash with slashes?
- Race conditions between bootstrap hash verification and auth initialization
- What if `rolePrefixMap[actualRole]` is undefined (unexpected role)?
- What if `enrolledSubjects` returns empty but `activeSubjectId` is non-null (stale reference)?
- What about the `displaySubjectName` when activeSubject has no `id` field?
- What about infinite redirect loops?

Output findings as a Markdown list. Each finding: severity (High/Med/Low), one-line title, condition that triggers it, and expected impact.
