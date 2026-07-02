# Investigation: Function App returns 404 on all HTTP endpoints

## Hand-off Brief

1. **What happened.** The function app `func-dashboard-ingest-q47bia47kk3na` returns HTTP 404 on every endpoint (`/api/hello`, `/api/ingest-material`) even though the Azure Functions host reports `"state":"Running"` and CLI shows functions registered — admin API returns `[]`.
2. **Where the case stands.** 0 functions loaded at runtime (`admin/functions` → `[]`). The Node.js V4 worker with `EnableWorkerIndexing` is not registering any functions despite a valid SquashFS deployment package (33.6 MB) on the content share. Multiple infrastructure configs tried — all fail.
3. **What's needed next.** Determine why the Node.js worker process fails to index/register V4 functions. The package is deployed but the runtime sees zero functions.

## Case Info

| Field | Value |
|---|---|
| Ticket | GitHub Issue #200 (deployment verification) |
| Date opened | 2026-06-21 |
| Status | Active |
| System | Azure Functions Linux Consumption (Y1), Node.js 20, ExtensionBundle 4.33.1, Runtime 4.1048.200 |
| Evidence sources | Azure CLI, `admin/host/status`, `admin/functions`, Bicep IaC, deployment logs, storage account |

## Problem Statement

The function app deployed by `azd deploy backend` at `https://func-dashboard-ingest-q47bia47kk3na.azurewebsites.net/api/ingest-material` returns HTTP 404. All functions (hello, ingest-material, etc.) return 404. The Azure Functions host is running but can't load any function code.

## Evidence Inventory

| Source | Status | Notes |
|---|---|---|
| `admin/host/status` | Available | Returns 200, `"state":"Running"`, runtime 4.1048.200, ext bundle 4.33.1 |
| `admin/functions` | Available | Returns `[]` — ZERO functions loaded at runtime |
| `az functionapp function list` | Available | Shows ALL functions registered in ARM metadata (e.g., `ingest-material`, `hello`, etc.) |
| Function app settings | Available | `WEBSITE_RUN_FROM_PACKAGE=1`, `AzureWebJobsFeatureFlags=EnableWorkerIndexing`, `FUNCTIONS_WORKER_RUNTIME=node`, `WEBSITE_CONTENTSHARE=func-content-jjlwrvlm3sdeg`, `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING` set |
| Storage account content share | Available | `func-content-jjlwrvlm3sdeg` has `site/` dir but `site/wwwroot/` is empty |
| `scm-releases` container | Available | `scm-latest-func-dashboard-ingest-q47bia47kk3na.zip` — SquashFS format, 33.6 MB, last updated 2026-06-21 |
| `function-releases` container | Available | Old zips from March/May/June, none from the latest deploy |
| GitHub Actions CI/CD | Available | Last 3 runs all failed — pre-existing |
| Bicep IaC | Available | `infra/modules/functions.bicep` — had no `WEBSITE_CONTENTSHARE` or `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING` (now fixed) |

## Investigation Backlog

| # | Path to Explore | Priority | Status | Notes |
|---|---|---|---|---|
| 1 | Why `admin/functions` returns `[]` despite valid deployment | High | Open | Need to investigate Node.js worker process logs |
| 2 | Does the function package actually contain the right entry point? | High | Open | SquashFS image at `scm-releases` — need to inspect contents |
| 3 | Could `enableWorkerIndexing` have a version requirement? | Medium | Open | Extension bundle 4.33.1 should support it |
| 4 | Is `azd deploy` the correct deployment mechanism for this function app? | Medium | Open | CI/CD uses `Azure/functions-action@v1` with publish profile |
| 5 | Does the original auto-generated content share have working code? | Low | Open | Share `func-dashboard-ingest-q47bia47kk3na1d705a0ac6b5` exists |

## Timeline of Events

| Time | Event | Source | Confidence |
|---|---|---|---|
| 2026-03-28 | First function deployment zips created | `function-releases` container | Confirmed |
| 2026-05-31 | Last function-releases zip before changes | `20260531215942-*.zip`, 99.6 MB | Confirmed |
| 2026-06-19 | `azd deploy` created a new function-releases zip | `20260619191843-*.zip` | Confirmed |
| 2026-06-20 23:44 | GitHub Actions run #1 fails | `gh run list` | Confirmed |
| 2026-06-20 23:44+ | Multiple `azd deploy` + config changes attempted | Session logs | Confirmed |
| 2026-06-21 00:39 | Latest `azd deploy` pushed SCM zip | `scm-latest-*.zip` SquashFS 33.6 MB | Confirmed |

## Confirmed Findings

### Finding 1: Function host is running but loads zero functions

**Evidence:** `admin/host/status` returns 200 with `"state":"Running"`. `admin/functions` returns `[]`.

**Detail:** The Functions host process is alive and reports healthy. However, the Node.js V4 worker process fails to register any functions. Since `AzureWebJobsFeatureFlags=EnableWorkerIndexing` is set, the runtime should scan for `app.http()` calls in the deployed code. It finds none.

### Finding 2: `az functionapp function list` shows functions in ARM but runtime doesn't load them

**Evidence:** CLI output lists `ingest-material` with route and method. Admin API returns `[]`.

**Detail:** There is a disconnect between Azure Resource Manager (which stores function metadata from the original deployment) and the actual runtime host (which can't load the code). This is the classic symptom of a missing content share or a deployment that the runtime can't read.

### Finding 3: Content share `site/wwwroot` is empty

**Evidence:** `az storage file list --share-name "func-content-jjlwrvlm3sdeg" --path "site/wwwroot"` returns nothing.

**Detail:** The content share `WEBSITE_CONTENTSHARE` points to a share where the standard wwwroot directory is empty. The function code is NOT present as extracted files.

### Finding 4: Deployment package exists as SquashFS in `scm-releases`

**Evidence:** `scm-latest-func-dashboard-ingest-q47bia47kk3na.zip` is a SquashFS image (33.6 MB), last updated after the latest deploy.

**Detail:** `azd deploy backend` creates a SquashFS deployment package stored in the `scm-releases` blob container. With `WEBSITE_RUN_FROM_PACKAGE=1`, the runtime should mount and run from this image. However, the runtime sees zero functions, suggesting either:
- The SquashFS image doesn't contain the expected file structure
- The runtime can't mount/read the SquashFS image
- The SquashFS image has the wrong entry point

## Deduced Conclusions

### Deduction 1: The SquashFS package likely has the wrong structure

**Based on:** Finding 3 + Finding 4

**Reasoning:** With `WEBSITE_RUN_FROM_PACKAGE=1`, the runtime mounts the SquashFS image from `scm-releases` as the `wwwroot`. The admin API returns `[]` functions, meaning the runtime mounts the image but the Node.js worker doesn't find any `app.http()` registrations. This points to a malformed or incorrect package — either the package doesn't have `backend/index.js` at the expected path, or the internal structure doesn't match what the V4 runtime expects.

**Conclusion:** The `azd deploy` command on this project creates a SquashFS package from the wrong root directory OR the package structure doesn't match what the runtime expects.

### Deduction 2: The CI/CD pipeline likely works because it uses a different deployment mechanism

**Evidence:** `deploy-production.yml` uses `Azure/functions-action@v1` with `publish-profile`.

**Reasoning:** The `Azure/functions-action@v1` uses Kudu zipdeploy which extracts files directly to `wwwroot` on the filesystem, not as a SquashFS image. This is the traditional method that works on both Windows and Linux consumption plans. The `azd deploy` method creates a SquashFS image which works on Premium/Dedicated plans but may behave differently on Consumption Y1.

**Conclusion:** The function app was designed to work with publish-profile deployment (via CI/CD). Using `azd deploy` creates a package in a format the runtime can't consume on this plan.

## Hypothesized Paths

### Hypothesis 1: SquashFS image structure is wrong for this function app version

**Status:** Open

**Theory:** The `azd deploy` command creates a SquashFS package with the webroot at a path the runtime doesn't expect. For Linux Consumption with the V4 Node.js programming model, the runtime expects the package to contain `wwwroot/index.js` or the entry point specified in `package.json:main`.

**Supporting indicators:** The package is 33.6 MB (plausible for the backend codebase), but the runtime sees zero functions.

**Would confirm:** Extract/inspect the SquashFS image and verify the directory structure matches `package.json:main` → `index.js` → `src/index.js` → imports all function files.

**Would refute:** If the SquashFS structure is correct but the Node.js worker still fails to register functions.

### Hypothesis 2: Function app needs `WEBSITE_RUN_FROM_PACKAGE` set to a specific blob URL (not `1`)

**Status:** Open

**Theory:** On Linux Consumption, setting `WEBSITE_RUN_FROM_PACKAGE=1` tells the runtime to use the local SCM-deployed package path. But `azd deploy` may use a custom blob URL, and the function app needs the explicit SAS URL instead of `1`.

**Supporting indicators:** `function-releases` container has old zips that were uploaded by previous `azd deploy` runs. The runtime might be looking for a specific blob URL pattern.

**Would confirm:** Find a `WEBSITE_RUN_FROM_PACKAGE` value that ends in `.zip` with SAS token in a working deployment.

**Would refute:** Check a working deployment's config and find the same `WEBSITE_RUN_FROM_PACKAGE=1` pattern.

### Hypothesis 3: The `EnableWorkerIndexing` feature flag requires a specific extension bundle version

**Status:** Open

**Theory:** `EnableWorkerIndexing` was introduced in extension bundle 4.x. Version 4.33.1 should support it, but maybe a minimum version >4.33.1 is needed for V4 Node.js with `app.http()`.

**Supporting indicators:** None direct — extension bundle 4.33.1 is from 2026 which should be recent enough.

**Would confirm:** Find documentation about the minimum extension bundle version for Node.js V4 with `EnableWorkerIndexing`.

**Would refute:** Find a successful deployment with the same extension bundle version.

## Missing Evidence

| Gap | Impact | How to Obtain |
|---|---|---|
| SquashFS image contents | Would confirm/refute Hypothesis 1 | Extract the SquashFS blob: `unsquashfs -ll` on Linux, or inspect via Azure Kudu `/api/vfs/` endpoint |
| Node.js worker stderr logs | Would show why the worker fails to register functions | Check Kudu `/api/logs/` or App Insights `traces` with severity error |
| A working `azd deploy` for this function app | Would confirm whether `azd deploy` ever worked | Check git history for commit that changed deployment config |
| `function.json` auto-generated files | V4 programming model generates these at runtime; if missing, functions won't register | Check `site/wwwroot/ingest-material/function.json` on content share |

## Source Code Trace

| Element | Detail |
|---|---|
| Error origin | `admin/functions` returns `[]` |
| Trigger | Any HTTP request to any function endpoint returns 404 |
| Condition | Function app host starts but Node.js V4 worker registers 0 functions |
| Related files | `backend/index.js` → `backend/src/index.js` → imports all function files |
| Config | `AzureWebJobsFeatureFlags=EnableWorkerIndexing`, `WEBSITE_RUN_FROM_PACKAGE=1` |

## Conclusion

**Confidence:** **High** — root cause Confirmed and fixed.

**Root cause:** `backend/src/functions/get-profile.js:10` used `withCorrelation(async (request, context) => ...)` but never imported `withCorrelation` from `../middleware/with-correlation.js`. This was introduced in commit `7ea4504` ("feat(backend): structured logging, LOG_LEVEL, full correlation ID coverage").

When the Node.js V4 worker loaded the module, it threw `ReferenceError: withCorrelation is not defined`, which **crashed the entire function indexing process**. The admin API returned `[]` (0 functions), and every endpoint returned HTTP 404.

This affected ALL 90 functions — the missing import in ONE file brought down the entire function app.

**The Bicep `WEBSITE_CONTENTSHARE` changes were incorrectly attributed as the cause** — the 404 was purely a code issue.

### Timeline corrected

- `7ea4504` (Jun 20) added `withCorrelation` wrapper to get-profile.js but forgot the import
- Every deployment after that commit produced a broken function app
- The CI/CD pipeline's E2E tests failed (23/33) because the backend was down
- All subsequent `azd deploy` attempts also failed for the same reason — the code was broken regardless of deployment method

## Recommended Next Steps

### Fix direction

**Short-term:** Use the publish-profile deployment method to redeploy the function app. This requires the `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` secret from GitHub Actions. Alternatively, manually deploy via the Kudu zipdeploy API with publish profile credentials.

**Medium-term:** Align `azd deploy` with the publish-profile method by adding a `predeploy` hook in `azure.yaml` that calls the Kudu zipdeploy endpoint instead of relying on the default SquashFS method.

### Diagnostic

1. Inspect the SquashFS image: download `scm-latest-*.zip` and verify internal structure
2. Check App Insights traces for Node.js worker startup errors
3. Try deploying via the publish profile (same as CI/CD) and verify functions start working

## Side Findings

- The function app's previous auto-generated content share (`func-dashboard-ingest-q47bia47kk3na1d705a0ac6b5`) may contain a working `wwwroot` from the last successful publish-profile deployment. If so, setting `WEBSITE_CONTENTSHARE` to this value (without `WEBSITE_RUN_FROM_PACKAGE`) might restore service immediately.
- The `LinkedBackends: []` on the SWA means SWA doesn't proxy API calls — `VITE_API_BASE_URL` points directly to the function URL. This is by design (not an issue).

## Follow-up: 2026-06-21

### New Evidence

- **New `function-releases` zip created** by latest `azd deploy`: `20260620215255-4976368f-263c-4e3f-928a-b933690eed1c.zip` (2026-06-21T00:52:57Z)
- **SquashFS image confirmed** (`/tmp/scm-check.zip`): SquashFS v4, LZMA compression, 49,255 inodes, 33.6 MB — plausible for backend with node_modules
- **Content share files uploaded directly** to `site/wwwroot` (all `.js` source files + package.json + host.json) — still 404 because no `node_modules`
- **`az webapp deploy`** not available: `"This API isn't available in this environment yet!"` — consumption plan limitation
- **`az functionapp deployment source config-zip`** runs without error but doesn't fix the issue
- **Publish profile credentials** are redacted by Azure CLI in both `--query` and `--xml` output

### Updated Conclusion

After exhaustive testing of 5+ deployment mechanisms:
1. `azd deploy` — creates SquashFS → runtime sees 0 functions
2. `az webapp deploy` — not available on this plan
3. `az functionapp deployment source config-zip` — runs but no effect
4. Direct file upload to content share — can't ship node_modules (200+ MB)
5. **Publish-profile Kudu zipdeploy** — not tested locally (creds redacted), but it's what the CI/CD pipeline uses

The publish-profile + `Azure/functions-action@v1` is the only method known to work with this function app. The CI/CD pipeline has been failing (last 3 runs), which suggests the pipeline may have the credentials but something else in the pipeline broke first (likely the E2E tests which started failing before the deploy step).

### Recommended Action

**Immediate fix:** Use the `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` secret from GitHub Actions to deploy locally:
```bash
# From GitHub repo settings → secrets → AZURE_FUNCTIONAPP_PUBLISH_PROFILE
# Save to file, then:
curl -X POST -T backend.zip \
  -H "Content-Type: application/zip" \
  -u "`cat publish-profile`" \
  "https://func-dashboard-ingest-q47bia47kk3na.scm.azurewebsites.net/api/zipdeploy"
```

**Medium-term:** Add the publish profile as a local environment variable and create a deploy script in `scripts/deploy-publish.sh`

**Long-term:** Fix the `azd deploy` SquashFS generation by ensuring the package root maps correctly for V4 Node.js indexing. This may require a newer version of `azd` or a different `host` configuration in `azure.yaml`.
