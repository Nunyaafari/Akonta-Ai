# Akonta AI Production Readiness Checklist

Use this as a release gate. Every item must be marked **Pass** with evidence before production launch.

## 0) Ownership Matrix
| Area | Owner | Backup | Status |
|---|---|---|---|
| Backend security/auth | Backend engineer | Tech lead | Pass |
| Frontend auth/workspace UX | Frontend engineer | Product engineer | In progress |
| Infrastructure/DevOps | DevOps engineer | Backend engineer | Pending |
| Data migration + rollback | Backend engineer | DevOps engineer | In progress |
| QA and release signoff | QA lead | Product lead | Pending |

## 1) Security Hardening (Release Blocker)
| Check | Pass Criteria | Evidence | Owner | Status |
|---|---|---|---|---|
| Legacy header auth disabled in prod | `ALLOW_LEGACY_USER_HEADER_AUTH=false` and production startup fails if true | `backend/src/lib/auth.ts`, `backend/src/main.ts` | Backend | Pass |
| OTP dev code not exposed in prod | `AUTH_EXPOSE_DEV_OTP=false` and no `devOtpCode` field in prod responses | `backend/src/routes/auth.ts` | Backend | Pass |
| OTP abuse protection | Rate limits by phone/IP + minimum request interval + verify attempt cap | `backend/src/routes/auth.ts` | Backend | Pass |
| JWT secret hygiene | `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` set, >=32 chars, startup fails if weak/missing in prod | `backend/src/main.ts` | Backend/DevOps | Pass |

### Item 1 Verification Evidence (2026-04-25)
- `npm run build` in `backend/` passed.
- Production startup guard checks passed:
1. `NODE_ENV=production` + short JWT secrets -> process exits with `JWT_ACCESS_SECRET must be set and at least 32 chars in production.`
2. `ALLOW_LEGACY_USER_HEADER_AUTH=true` in production -> process exits with `ALLOW_LEGACY_USER_HEADER_AUTH must be false in production.`
3. `AUTH_EXPOSE_DEV_OTP=true` in production -> process exits with `AUTH_EXPOSE_DEV_OTP must be false in production.`
- Runtime auth/OTP behavior checks passed (local server on port `4016`):
1. `GET /api/workspaces` with only `x-akonta-user-id` and `ALLOW_LEGACY_USER_HEADER_AUTH=false` returns `401` + `Missing bearer token.`
2. `POST /api/auth/request-otp` with `AUTH_EXPOSE_DEV_OTP=false` returns success payload without `devOtpCode`.
3. Immediate repeat `POST /api/auth/request-otp` returns `429` with `Retry-After` header.
4. `POST /api/auth/request-otp` with `AUTH_EXPOSE_DEV_OTP=true` (non-production) includes `devOtpCode`.

## 2) Identity & Workspace UX (Release Blocker)
| Check | Pass Criteria | Evidence | Owner | Status |
|---|---|---|---|---|
| OTP login journey | User can request OTP, verify, refresh token, logout in UI | E2E run + screenshots | Frontend | In progress |
| Workspace management UI | Owner can invite member, view roster, update role/status | UI walkthrough + API logs | Frontend | In progress |
| Role-aware UI gating | Cashier/Viewer cannot access owner-only controls in UI | E2E matrix | Frontend/QA | In progress |

### Item 2 Progress (2026-04-26)
- Existing-user entry points are now explicit in the frontend:
1. Landing page shows `Sign In` in header and hero CTA, separate from `Create Account`.
2. OTP auth screen now includes an explicit `Existing user` sign-in panel and a distinct `New business owner` create-account path.
- Workspace member management is available in `Settings -> Team Workspace` for owners:
1. Invite teammate by name + phone/email + role.
2. View roster with role/status.
3. Update non-owner role and active/inactive status.
- Role-gating test matrix created:
1. `QA_ROLE_GATING_E2E_MATRIX.md`
2. Next step is execution evidence (screenshots + network traces) to move from In progress to Pass.

## 3) Data Migration & Integrity (Release Blocker)
| Check | Pass Criteria | Evidence | Owner | Status |
|---|---|---|---|---|
| Staging dry-run migration | Migration completes on production-like snapshot without manual fixes | Migration log | Backend | In progress |
| Business mapping integrity | Every user has active business + owner membership; no orphan tx rows | SQL validation report | Backend | Pending |
| Financial parity | Pre/post migration totals match within accepted tolerance | Reconciliation sheet | Backend/QA | Pending |
| Rollback rehearsal | Restore from snapshot tested and timed | Drill report | DevOps | Pending |

## 4) Infrastructure & Runtime
| Check | Pass Criteria | Evidence | Owner | Status |
|---|---|---|---|---|
| Containerized deployment | `docker compose`/orchestrator deployment reproducible from clean host | Deploy logs | DevOps | In progress |
| TLS + secure headers | Public endpoints served via HTTPS, HSTS and secure CORS configured | Security scan | DevOps | Pending |
| Secrets management | Secrets sourced from vault/secret manager, not repo files | Infra config | DevOps | Pending |
| DB backups | Automated daily backups + retention policy + restore tested | Backup/restore logs | DevOps | Pending |

## 5) Observability & Alerting
| Check | Pass Criteria | Evidence | Owner | Status |
|---|---|---|---|---|
| Error tracking | Runtime errors captured (e.g., Sentry) with release tags | Dashboard screenshot | Backend/Frontend | Pending |
| API monitoring | p95 latency, error rate, auth failures visible | Metrics dashboard | DevOps | Pending |
| Alerting | Alerts for 5xx spikes, DB downtime, OTP abuse, auth anomalies | Alert policy | DevOps | Pending |

## 6) Test Gate
| Check | Pass Criteria | Evidence | Owner | Status |
|---|---|---|---|---|
| Integration tests | Workspace invite, OTP, auth refresh, approval flow, chat regression all passing | CI artifact | Backend | Pass |
| E2E tests | Core user journeys pass on desktop/mobile | CI artifact | QA/Frontend | Pending |
| Security tests | Cross-workspace access denied for all sensitive routes | CI artifact | Backend/QA | Pass |

### Item 3 CI Evidence (2026-04-26)
- GitHub Actions workflow run: `Backend Integration`
1. Run ID: `24954068727`
2. Commit: `68b86fabcf915a047cff7397d08075d2fed36908`
3. Event: `push` on `main`
4. Result: `completed / success`
5. URL: `https://github.com/Nunyaafari/Akonta-Ai/actions/runs/24954068727`

### Item 3 Progress (2026-04-25)
- Added CI workflow for backend integration/security suites:
1. `.github/workflows/backend-integration.yml`
2. Uses PostgreSQL service, applies Prisma migrations, starts backend, and runs CI test scripts.
- Added automated security regression script:
1. `backend/scripts/integration-security-rbac.ts`
2. Covers unauthenticated access denial, cashier/viewer role restrictions, cross-business isolation, refresh/logout token lifecycle, and OTP replay throttling.
- Updated backend npm scripts:
1. `test:security`
2. `test:ci` (runs `test:integration` + `test:security`)
- Local verification results:
1. `npm run test:integration` passed.
2. `npm run test:security` passed.
3. `npm run build` passed in `backend/`.

## 7) Release Execution
| Check | Pass Criteria | Evidence | Owner | Status |
|---|---|---|---|---|
| Maintenance window plan | Communication plan prepared and approved | Release plan doc | Product/DevOps | Pending |
| Post-deploy smoke tests | Auth, invite, transaction create/edit, summary, webhook checks pass | Smoke checklist | QA/Backend | Pending |
| Go/no-go approval | Explicit approval from engineering, QA, product | Signoff log | Tech lead | Pending |

---

## Immediate Next Actions
1. Finish role-aware frontend gating matrix validation (cashier/viewer restrictions) with screenshots/evidence.
2. Run end-to-end OTP/workspace/member lifecycle tests on desktop + mobile viewport and attach artifacts.
3. Perform staging migration rehearsal and publish validation report before production cutover.
