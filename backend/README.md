# Akonta AI Backend

This backend now supports multi-user business workspaces with role-based access, owner-only WhatsApp routing, audit logging, and approval workflows.

## Setup

1. Copy `.env.example` to `.env`
2. Update `DATABASE_URL`
3. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
4. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
5. Apply migrations:
   ```bash
   npm run prisma:migrate
   ```
6. Start backend:
   ```bash
   npm run dev
   ```

## Key environment variables

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` for session token signing.
- `BACKEND_API_KEY` and `ADMIN_API_KEY` for service/admin key protection.
- `TWILIO_WEBHOOK_VALIDATE_SIGNATURE`, `TWILIO_WEBHOOK_URL`, `INFOBIP_WEBHOOK_AUTH_TOKEN` for webhook hardening.

## API overview

### Auth & sessions
- `POST /api/auth/bootstrap-owner` create owner + workspace bootstrap record
- `POST /api/auth/request-otp` request phone OTP
- `POST /api/auth/verify-otp` verify OTP and issue access/refresh tokens
- `POST /api/auth/refresh` rotate session tokens
- `POST /api/auth/logout` revoke refresh session

### Workspaces
- `GET /api/workspaces` list current user workspace memberships
- `POST /api/workspaces/select` switch active workspace and rotate token claims
- `GET /api/workspaces/members` list members in current workspace
- `POST /api/workspaces/members/invite` invite/add member with role
- `PATCH /api/workspaces/members/:membershipId` update member role/status
- `GET /api/workspaces/audit-logs` list workspace audit events

### Core accounting (workspace-scoped)
- `POST /api/transactions` create transaction with attribution
- `GET /api/transactions` list transactions with filters and role-aware visibility
- `PATCH /api/transactions/:id` update transaction (historical edits create approval request)
- `DELETE /api/transactions/:id` soft delete (historical deletes create approval request)
- `PATCH /api/transactions/:id/confirm` confirm draft
- `POST /api/transactions/:id/corrections` create correction record
- `GET /api/transactions/approvals/pending` list pending approvals
- `POST /api/transactions/approvals/:approvalId/review` approve/reject request

### Reporting and planning (workspace-scoped)
- `GET /api/summaries/weekly?start=...&end=...`
- `GET /api/summaries/monthly?year=...&month=...`
- `GET /api/summaries`
- `POST /api/summaries`
- `GET /api/insights/current`
- `GET /api/insights/monthly?year=...&month=...`
- `GET /api/budgets/current`
- `GET /api/budgets?year=...&month=...`
- `POST /api/budgets`

### WhatsApp
- `POST /api/whatsapp/webhook/twilio`
- `POST /api/whatsapp/webhook/infobip`
- `POST /api/whatsapp/webhook` (generic internal route)
- `POST /api/whatsapp/send`
- `GET /api/whatsapp/providers`
- `GET /api/whatsapp/webhook/events?provider=...&limit=...`

Provider webhook routing now maps sender phone to `Business.primaryWhatsappUserId` (owner-only workflow).

## Migration

This release includes migration folder:
- `prisma/migrations/202604251230_multi_user_workspace/migration.sql`

Use the runbook in `backend/MULTI_USER_CUTOVER.md` for backup, verification, smoke checks, and rollback.
