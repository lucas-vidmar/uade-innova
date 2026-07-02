# Blind Hunter Review — Story 1.2 (Role-Based Dashboard Routing)

You receive ONLY this diff. No spec, no project context.

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
     }
 }
 
```

Review the diff adversarially. Look for:
- Logic errors or edge cases
- Security concerns
- Performance issues
- Potential regressions
- Code quality problems
- Any unexpected behavior

Output findings as a Markdown list. Each finding: severity (High/Med/Low), one-line title, description, and evidence from the diff.
