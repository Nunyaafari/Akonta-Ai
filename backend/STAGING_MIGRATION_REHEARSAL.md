# Staging Migration Rehearsal Guide

This guide operationalizes the cutover safety sequence:

1. Backup snapshot
2. Restore to rehearsal DB
3. Apply migration(s)
4. Run integrity + parity checks
5. Execute rollback restore drill
6. Save evidence artifacts

## Prerequisites

1. `DATABASE_URL` points to the source staging database.
2. PostgreSQL client tools are installed locally:
   - `psql`
   - `pg_dump`
   - `pg_restore`
3. Backend dependencies installed (`npm ci` in `backend/`).

## Run

```bash
cd backend
DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/ledgermate_staging" \
npm run rehearsal:staging-migration
```

Optional output path override:

```bash
ARTIFACT_ROOT="/tmp/akonta-rehearsal-$(date -u +%Y%m%dT%H%M%SZ)" \
DATABASE_URL="postgresql://postgres:password@127.0.0.1:5432/ledgermate_staging" \
npm run rehearsal:staging-migration
```

## What The Script Checks

1. Baseline parity (before vs after migration):
   - User/transaction/summary/budget counts unchanged.
   - Transaction total amount unchanged.
   - Per-user transaction signature unchanged.
2. Post-migration invariants:
   - Every user has `activeBusinessId`.
   - Every business has active owner membership.
   - `primaryWhatsappUserId` set per business.
   - `businessId` and `createdByUserId` backfilled on required tables.
   - No orphan transaction-to-business references.
3. Rollback drill parity:
   - Restored rollback database matches source baseline metrics.

## Artifacts Produced

Saved under `backend/rehearsal-artifacts/<timestamp>/`:

1. `source_snapshot.dump`
2. `work_post_migration.dump`
3. `source_baseline_metrics.txt`
4. `work_post_migration_metrics.txt`
5. `work_invariants.txt`
6. `rollback_metrics.txt`
7. `rehearsal.log`
8. `SUMMARY.md`

Use `SUMMARY.md` and `rehearsal.log` as release evidence links in `PRODUCTION_READINESS_CHECKLIST.md`.
