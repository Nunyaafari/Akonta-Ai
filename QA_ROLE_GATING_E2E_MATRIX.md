# Frontend Role-Gating E2E Matrix

Execution date: 2026-04-26  
Scope: Validate that UI controls and behavior match workspace role permissions.

## Preconditions
- Backend running with latest multi-user/RBAC build.
- Frontend running with OTP auth flow.
- Seed users available:
1. Owner user
2. Cashier user (invited to owner workspace)
3. Viewer user (invited to owner workspace)
- Workspace has at least one transaction created by owner and one by cashier.

## Test Matrix
| Case ID | Role | Screen | Action | Expected UI Behavior | Expected API Behavior | Status |
|---|---|---|---|---|---|---|
| RG-01 | Owner | Settings -> Team Workspace | Open page | Invite form visible + role/status controls visible | `GET /api/workspaces/members` = 200 | Pending |
| RG-02 | Owner | Settings -> Team Workspace | Invite cashier/viewer | Success notice shown and member appears in list | `POST /api/workspaces/members/invite` = 201 | Pending |
| RG-03 | Owner | Settings -> Team Workspace | Change member role | Save role button works and notice shown | `PATCH /api/workspaces/members/:id` = 200 | Pending |
| RG-04 | Owner | Settings -> Team Workspace | Activate/deactivate member | Status toggle works and notice shown | `PATCH /api/workspaces/members/:id` = 200 | Pending |
| RG-05 | Cashier | Settings -> Team Workspace | Open page | Invite/edit controls hidden; warning message shown | `GET /api/workspaces/members` = 200 | Pending |
| RG-06 | Cashier | Settings -> Team Workspace | Attempt invite (via dev tools/direct call) | No UI action path | `POST /api/workspaces/members/invite` = 403 | Pending |
| RG-07 | Viewer | Settings -> Team Workspace | Open page | Invite/edit controls hidden; warning message shown | `GET /api/workspaces/members` = 200 | Pending |
| RG-08 | Viewer | Chat / data entry | Attempt to create transaction | UI should prevent or surface error cleanly | `POST /api/transactions` = 403 | Pending |
| RG-09 | Cashier | History | View transactions | Sees only own transactions in list context | `GET /api/transactions` excludes owner rows | Pending |
| RG-10 | Owner | History | View transactions | Sees full workspace transactions | `GET /api/transactions` includes owner + cashier rows | Pending |

## Suggested Execution Flow
1. Login as owner via OTP and execute RG-01 to RG-04.
2. Login as cashier via OTP and execute RG-05, RG-06, RG-09.
3. Login as viewer via OTP and execute RG-07, RG-08.
4. Re-login as owner and execute RG-10.

## Evidence to Attach
- Screenshot set per role (`owner`, `cashier`, `viewer`) from Team Workspace section.
- One network trace/export showing expected 403s for cashier invite and viewer transaction create.
- One short recording/gif proving owner invite and role update success path.

## Automation Coverage Reference
- Backend automated RBAC/security checks already in:
1. `backend/scripts/integration-security-rbac.ts`
2. `npm run test:security`
3. GitHub Actions workflow `Backend Integration`
- Frontend smoke automation now in:
1. `e2e/workspace-auth-smoke.spec.ts`
2. `npm run test:e2e:ci`
3. GitHub Actions workflow `Frontend E2E Smoke`
