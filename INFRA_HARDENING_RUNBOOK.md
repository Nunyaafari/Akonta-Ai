# Infrastructure Hardening Runbook

This runbook closes the production infra hardening gates for:

1. Container reproducibility
2. TLS + secure headers
3. Secrets manager wiring
4. Backup retention verification

## 1) Container Reproducibility

Use the production compose stack and run from a clean host checkout.

1. Copy env template:
```bash
cp .env.production.example .env.production
```
2. Ensure secret files are mounted by your platform at `SECRETS_MOUNT_PATH` (see section 3).
3. Build + start:
```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```
4. Verify all services are healthy:
```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200
```

## 2) TLS and Security Headers

Production Nginx config is in:

1. `docker/nginx/production.conf`

It includes:

1. HTTP to HTTPS redirect
2. TLS 1.2/1.3 only
3. HSTS
4. `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
5. CSP and API reverse proxy via `/api`

Post-deploy validation:

```bash
curl -Ik https://<your-domain>/
curl -Ik https://<your-domain>/healthz
```

Expected headers include:

1. `strict-transport-security`
2. `x-content-type-options`
3. `x-frame-options`
4. `referrer-policy`
5. `content-security-policy`

## 3) Secrets Manager Wiring

Backend now supports both direct env vars and `*_FILE` secret file references.

If both are set, direct env wins.

Supported file-based secrets include:

1. `JWT_ACCESS_SECRET_FILE`
2. `JWT_REFRESH_SECRET_FILE`
3. `BACKEND_API_KEY_FILE`
4. `ADMIN_API_KEY_FILE`
5. `OPENAI_API_KEY_FILE`
6. `TWILIO_AUTH_TOKEN_FILE`
7. `INFOBIP_API_KEY_FILE`
8. `INFOBIP_WEBHOOK_AUTH_TOKEN_FILE`
9. `WHATCHIMP_API_KEY_FILE`
10. `PAYSTACK_SECRET_KEY_FILE`
11. `PAYSTACK_WEBHOOK_SECRET_FILE`
12. `TELEGRAM_BOT_TOKEN_FILE`
13. `TELEGRAM_WEBHOOK_SECRET_FILE`

Production compose expects a mounted directory:

1. Host path: `SECRETS_MOUNT_PATH` (default `./docker/secrets/local`; production override example: `/var/run/akonta-secrets`)
2. Container path: `/run/secrets/akonta`

Required filenames in the mount:

1. `jwt_access_secret`
2. `jwt_refresh_secret`
3. `backend_api_key`
4. `admin_api_key`
5. `openai_api_key`
6. `twilio_auth_token`
7. `infobip_api_key`
8. `infobip_webhook_auth_token`
9. `whatchimp_api_key`
10. `paystack_secret_key`
11. `paystack_webhook_secret`
12. `telegram_bot_token`
13. `telegram_webhook_secret`

## 4) Backup Retention Verification

Verification script:

1. `backend/scripts/verify-backup-retention.mjs`

NPM alias:

```bash
cd backend
npm run ops:verify-backup-retention
```

### Local backup target example

```bash
cd backend
BACKUP_MODE=local \
BACKUP_DIR=/var/backups/postgres/akonta \
RETENTION_DAYS=30 \
MIN_BACKUPS_WITHIN_RETENTION=30 \
MAX_BACKUP_AGE_HOURS=30 \
ENFORCE_RETENTION_PRUNE=true \
VERIFY_RESTORE=true \
DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/ledgermate" \
npm run ops:verify-backup-retention
```

### S3 backup target example

```bash
cd backend
BACKUP_MODE=s3 \
BACKUP_S3_BUCKET=akonta-prod-backups \
BACKUP_S3_PREFIX=postgres/ledgermate/ \
RETENTION_DAYS=30 \
MIN_BACKUPS_WITHIN_RETENTION=30 \
MAX_BACKUP_AGE_HOURS=30 \
ENFORCE_RETENTION_PRUNE=true \
npm run ops:verify-backup-retention
```

The script writes a JSON evidence report (default under `backend/rehearsal-artifacts/`) and exits non-zero on failure.

## Troubleshooting

### Backend starts then `curl` shows `Recv failure: Connection reset by peer`

This usually means the backend process crashed after container start (most often during `prisma migrate deploy`).

1. Check backend logs:
```bash
docker compose logs --tail=200 backend
```
2. If logs show Prisma `P1000` auth errors, align DB credentials in local `.env`:
```bash
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change_me
POSTGRES_DB=ledgermate
DATABASE_URL=postgresql://postgres:change_me@db:5432/ledgermate
```
3. Restart:
```bash
docker compose up -d --build --force-recreate db backend
```
4. If the Postgres volume was initialized with a different password and this is a disposable local environment, reset volume:
```bash
docker compose down
docker volume rm akontaai_akonta_pg_data
docker compose up -d --build
```
