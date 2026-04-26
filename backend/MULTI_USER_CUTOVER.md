# Multi-User Cutover Runbook

## 1) Pre-cutover
- Announce maintenance window.
- Take full DB snapshot backup.
- Verify restore works on staging from latest backup.
- Build and deploy candidate artifacts to staging.
- Run smoke tests on staging.

## 2) Apply
- Put app in maintenance mode.
- Apply DB migration: `202604251230_multi_user_workspace`.
- Deploy backend and frontend together.
- Run post-deploy smoke checks before reopening traffic.

## 3) Post-deploy smoke checks
- OTP auth flow: request, verify, refresh, logout.
- Workspace endpoints: list, member invite/update.
- Transactions: create, same-day edit/delete, historical edit request.
- Approval flow: approve/reject pending historical request.
- Summaries/insights/budgets load for active workspace.
- WhatsApp inbound routes owner phone to correct workspace.

## 4) Data integrity checks
- Every user has an active business (`User.activeBusinessId`).
- Every active business has owner membership.
- Existing transactions have `businessId` + `createdByUserId` populated.
- No cross-business leakage in transaction/summaries queries.

## 5) Rollback
- If smoke or integrity fails, keep maintenance mode on.
- Roll back app deployment.
- Restore DB from pre-cutover snapshot.
- Re-run integrity checks on restored DB.
- Publish incident summary and patch in staging before retry.
