---
title: 'CI/CD Pipeline — Staging & Production with Testing'
type: 'feature'
created: '2026-06-14'
status: 'completed'
baseline_commit: '08aa5c56a673068fa93a4c0fedcb77a1fd489275'
context:
  - '.github/workflows/azure-dev.yml'
  - 'azure.yaml'
  - 'frontend/playwright.config.js'
  - 'frontend/package.json'
  - 'backend/package.json'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Currently all code pushes directly to production with no staging environment, no automated tests in CI, and no secret validation. This creates risk of deploying broken code or leaking secrets.

**Approach:** Implement a CI/CD pipeline with GitHub Actions: push to `staging` deploys to the staging environment (with tests + secret checks), then the agent creates a PR from `staging` to `main`. A human reviews and approves the PR; on merge, production deploys. Add secret validation, automated test runs, and Playwright E2E verification against the staging URL before PR creation.

## Boundaries & Constraints

**Always:**
- No secrets or connection strings in code -- use GitHub Secrets for all sensitive values
- Both `staging` and `production` Azure environments must use `azd` for infrastructure
- `azd deploy` must be used for all deployments (not raw Azure CLI)
- Playwright tests must use `@playwright/test` with existing config

**Ask First:**
- Provisioning a full production environment doubles Azure resource costs. Confirm budget allows it, or accept a lighter staging approach (same Azure environment, separate SWA staging slot).
- Which Playwright tests should gate the production promotion (all 28, or a subset)?

**Never:**
- Don't modify existing Playwright test files or backend test files
- Don't add new test frameworks (keep Node built-in for backend, Playwright for frontend)
- Don't modify `azure.yaml` or the Bicep infrastructure modules
- Don't commit GitHub secrets to the repository

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Push to `staging`, all tests pass | Deploy to staging, Playwright verifies staging URL, agent creates PR to `main` | N/A |
| TESTS_FAIL | Push to `staging`, tests fail | Pipeline fails, no deployment, GitHub check reports failure | Show test output in workflow log |
| SECRETS_MISSING | Push to `staging`, required secrets absent | Pipeline fails before any Azure operation | List which secrets are missing |
| PLAYWRIGHT_FAIL | Staging deploy succeeds, Playwright tests against staging URL fail | Pipeline fails, staging left deployed for debugging | Log failing test names + screenshots to workflow artifacts |
| PR_MERGED_TO_MAIN | Human approves and merges PR from `staging` to `main` | Production deploy triggers automatically | Block merge if human rejects |

</frozen-after-approval>

## Code Map

- `.github/workflows/deploy-staging.yml` -- New: push-to-staging workflow (test, secrets check, azd deploy staging, playwright verify, create PR staging->main)
- `.github/workflows/deploy-production.yml` -- New: on-push-to-main workflow (azd deploy prod after PR merge, smoke test)
- `frontend/package.json` -- Add postinstall script for Playwright browsers

## Tasks & Acceptance

**Execution:**
- [ ] `.github/workflows/deploy-staging.yml` -- Create staging pipeline: trigger on push to `staging` branch, test, secrets check, azd deploy, Playwright verify, create PR staging->main
- [ ] `.github/workflows/deploy-production.yml` -- Create production pipeline: trigger on push to `main` (after human merges PR), azd deploy prod, smoke test
- [ ] `frontend/package.json` -- Add `"postinstall": "npx playwright install --with-deps chromium"` for CI browser download
- [ ] Remove old `.github/workflows/azure-dev.yml` (replaced by new workflows)

**Acceptance Criteria:**
- Given a push to `staging`, when the pipeline runs, then backend tests execute, secrets are validated, staging is deployed, Playwright tests run against the staging URL, and a PR from `staging` to `main` is created
- Given a human merges the PR from `staging` to `main`, when the production pipeline runs on `main`, then production deploys automatically
- Given missing GitHub secrets, when the pipeline starts, then it fails fast with clear error listing missing secrets
- Given Playwright test failures on staging, when the pipeline completes, then the PR to `main` is NOT created and artifacts contain screenshots

## Spec Change Log

*(empty)*

## Design Notes

**Environment strategy:**
- `uade-dev` (staging) -- already provisioned, receives all `staging` branch pushes
- Production uses the same Azure environment but deploys only after human-approved PR merge to `main`
- SWA staging slots provide zero-cost preview for each deployment

**Secret validation approach:**
A dedicated step validates all required Azure secrets exist in `secrets` context before any deployment step runs. Required secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_ENV_NAME`, `AZURE_LOCATION`.

**Playwright in CI:**
The existing Playwright config targets `http://localhost:3000` for dev-server testing. For staging verification, the workflow overrides the Playwright base URL to the deployed staging Functions URL after azd deployment.

**CI/CD flow:**
1. Dev pushes code to `staging` branch
2. GitHub Actions: backend tests, playwright install, frontend build, playwright tests, azd deploy staging
3. GitHub Actions: playwright tests against deployed staging URL
4. If all pass: GitHub Actions creates PR `staging` -> `main` with summary
5. Human reviews PR, approves, merges
6. Push to `main` triggers production deploy

## Verification

**Commands:**
- `cd backend && npm test` -- expected: all 30 tests pass
- `cd frontend && npx playwright install --with-deps chromium && npm run test:e2e` -- expected: all 28 E2E tests pass
- `cat .github/workflows/deploy-staging.yml` -- expected: valid YAML with test, secrets-check, deploy, and verify jobs

**Manual checks:**
- GitHub Actions runs successfully on push to `staging`
- PR is created from `staging` to `main` after staging verification
- Production deployment triggers on PR merge to `main`
