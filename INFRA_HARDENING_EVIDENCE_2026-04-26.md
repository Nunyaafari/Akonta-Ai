# Infra Hardening Evidence (2026-04-26)

Execution environment: local Docker runtime with production compose profile.

## Commands Executed

1. `docker compose --env-file .tmp/.env.production.local -f docker-compose.production.yml up -d --build`
2. `docker compose --env-file .tmp/.env.production.local -f docker-compose.production.yml ps`
3. `curl -kI http://127.0.0.1/`
4. `curl -kI https://127.0.0.1/`
5. `curl -k https://127.0.0.1/healthz`
6. `curl -k https://127.0.0.1/api/health`
7. `curl -k -X OPTIONS https://127.0.0.1/api/health -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: GET'`
8. `curl -k -X OPTIONS https://127.0.0.1/api/health -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET'`
9. `curl -k https://127.0.0.1/api/users` (without API key)
10. `curl -k https://127.0.0.1/api/users -H 'x-akonta-api-key: ...'` (with API key from secret file)
11. `npm run ops:verify-backup-retention` (with 30 local backup files)
12. Restore drill:
   - create restore DB
   - `pg_restore` dump into restore DB (inside DB container)
   - smoke query (`tables=20`)
   - drop restore DB

## Key Results

1. Stack booted with healthy `db`, `backend`, `frontend`.
2. HTTP endpoint redirects to HTTPS (`301`).
3. HTTPS response includes required hardened headers:
   - `strict-transport-security`
   - `x-content-type-options`
   - `x-frame-options`
   - `referrer-policy`
   - `permissions-policy`
   - `content-security-policy`
4. Secrets-file wiring validated by behavior:
   - `/api/users` without key -> `401`
   - `/api/users` with mounted secret key -> `200`
5. Backup retention verifier returned `PASS`.
6. Restore drill completed successfully with smoke query result `tables=20`.

## Raw Artifacts

Local raw artifacts were captured under:

1. `.tmp/infra-evidence/compose-ps.txt`
2. `.tmp/infra-evidence/http-redirect-headers.txt`
3. `.tmp/infra-evidence/https-headers.txt`
4. `.tmp/infra-evidence/api-health.json`
5. `.tmp/infra-evidence/cors-allowed.txt`
6. `.tmp/infra-evidence/cors-denied.txt`
7. `.tmp/infra-evidence/users-no-key.status`
8. `.tmp/infra-evidence/users-with-key.status`
9. `.tmp/infra-evidence/backup-retention-output.txt`
10. `.tmp/infra-evidence/backup-retention-report.json`
11. `.tmp/infra-evidence/restore-smoke.txt`
