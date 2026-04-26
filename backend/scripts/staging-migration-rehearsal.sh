#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required."
  exit 1
fi

for cmd in node psql pg_dump pg_restore npx diff awk; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    echo "Install PostgreSQL client tools (psql/pg_dump/pg_restore) and try again."
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SQL_DIR="${SCRIPT_DIR}/sql"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARTIFACT_ROOT="${ARTIFACT_ROOT:-${BACKEND_DIR}/rehearsal-artifacts/${TIMESTAMP}}"

mkdir -p "${ARTIFACT_ROOT}"

log() {
  local message="$1"
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$message" | tee -a "${ARTIFACT_ROOT}/rehearsal.log"
}

eval "$(node <<'NODE'
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.exit(1);
}
const source = new URL(databaseUrl);
const sourceDb = source.pathname.replace(/^\//, '');
const safeBase = (sourceDb || 'akonta').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
const workDb = `${safeBase}_reh_work`;
const rollbackDb = `${safeBase}_reh_rollback`;
const admin = new URL(source);
admin.pathname = '/postgres';
const work = new URL(source);
work.pathname = `/${workDb}`;
const rollback = new URL(source);
rollback.pathname = `/${rollbackDb}`;
console.log(`SOURCE_DB_NAME=${JSON.stringify(sourceDb)}`);
console.log(`WORK_DB_NAME=${JSON.stringify(workDb)}`);
console.log(`ROLLBACK_DB_NAME=${JSON.stringify(rollbackDb)}`);
console.log(`ADMIN_DATABASE_URL=${JSON.stringify(admin.toString())}`);
console.log(`WORK_DATABASE_URL=${JSON.stringify(work.toString())}`);
console.log(`ROLLBACK_DATABASE_URL=${JSON.stringify(rollback.toString())}`);
NODE
)"

SOURCE_SNAPSHOT_DUMP="${ARTIFACT_ROOT}/source_snapshot.dump"
WORK_POST_MIGRATION_DUMP="${ARTIFACT_ROOT}/work_post_migration.dump"
SOURCE_METRICS="${ARTIFACT_ROOT}/source_baseline_metrics.txt"
WORK_METRICS="${ARTIFACT_ROOT}/work_post_migration_metrics.txt"
ROLLBACK_METRICS="${ARTIFACT_ROOT}/rollback_metrics.txt"
WORK_INVARIANTS="${ARTIFACT_ROOT}/work_invariants.txt"
PARITY_DIFF_FILE="${ARTIFACT_ROOT}/parity_diff.txt"
ROLLBACK_DIFF_FILE="${ARTIFACT_ROOT}/rollback_diff.txt"
VIOLATIONS_FILE="${ARTIFACT_ROOT}/invariant_violations.txt"
SUMMARY_FILE="${ARTIFACT_ROOT}/SUMMARY.md"

reset_database() {
  local target_name="$1"
  log "Resetting database ${target_name}"

  psql "${ADMIN_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target_name}' AND pid <> pg_backend_pid();" \
    >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1
  psql "${ADMIN_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${target_name}\";" \
    >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1
  psql "${ADMIN_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${target_name}\";" \
    >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1
}

capture_baseline_metrics() {
  local db_url="$1"
  local output_file="$2"
  psql "${db_url}" -v ON_ERROR_STOP=1 -f "${SQL_DIR}/rehearsal_baseline_metrics.sql" > "${output_file}"
}

capture_invariants() {
  local db_url="$1"
  local output_file="$2"
  psql "${db_url}" -v ON_ERROR_STOP=1 -f "${SQL_DIR}/rehearsal_invariants.sql" > "${output_file}"
}

log "Starting staging migration rehearsal"
log "Artifacts: ${ARTIFACT_ROOT}"
log "Source database: ${SOURCE_DB_NAME}"
log "Work database: ${WORK_DB_NAME}"
log "Rollback database: ${ROLLBACK_DB_NAME}"

log "Step 1/8: Taking source snapshot backup"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "${SOURCE_SNAPSHOT_DUMP}" \
  "${DATABASE_URL}" \
  >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1

log "Step 2/8: Capturing baseline source metrics"
capture_baseline_metrics "${DATABASE_URL}" "${SOURCE_METRICS}"

log "Step 3/8: Restoring source snapshot into work database"
reset_database "${WORK_DB_NAME}"
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --dbname "${WORK_DATABASE_URL}" \
  "${SOURCE_SNAPSHOT_DUMP}" \
  >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1

log "Step 4/8: Applying migrations on work database"
(
  cd "${BACKEND_DIR}"
  DATABASE_URL="${WORK_DATABASE_URL}" npx prisma migrate deploy
) >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1

log "Step 5/8: Running post-migration metrics + invariant checks"
capture_baseline_metrics "${WORK_DATABASE_URL}" "${WORK_METRICS}"
capture_invariants "${WORK_DATABASE_URL}" "${WORK_INVARIANTS}"

if ! diff -u "${SOURCE_METRICS}" "${WORK_METRICS}" > "${PARITY_DIFF_FILE}"; then
  log "Parity mismatch detected between source and work metrics."
  cat "${PARITY_DIFF_FILE}"
  exit 1
fi
log "Parity checks passed (source metrics == post-migration work metrics)."

awk -F'|' '/^invariant_/ && $2 != "0" { print $0 }' "${WORK_INVARIANTS}" > "${VIOLATIONS_FILE}" || true
if [[ -s "${VIOLATIONS_FILE}" ]]; then
  log "Invariant violations detected."
  cat "${VIOLATIONS_FILE}"
  exit 1
fi
log "Invariant checks passed (all invariant counts are zero)."

log "Step 6/8: Taking post-migration work snapshot"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "${WORK_POST_MIGRATION_DUMP}" \
  "${WORK_DATABASE_URL}" \
  >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1

log "Step 7/8: Rollback drill (restore source snapshot into rollback database)"
reset_database "${ROLLBACK_DB_NAME}"
pg_restore \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --dbname "${ROLLBACK_DATABASE_URL}" \
  "${SOURCE_SNAPSHOT_DUMP}" \
  >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1

log "Step 8/8: Validating rollback parity"
capture_baseline_metrics "${ROLLBACK_DATABASE_URL}" "${ROLLBACK_METRICS}"
if ! diff -u "${SOURCE_METRICS}" "${ROLLBACK_METRICS}" > "${ROLLBACK_DIFF_FILE}"; then
  log "Rollback parity mismatch detected."
  cat "${ROLLBACK_DIFF_FILE}"
  exit 1
fi
log "Rollback parity checks passed."

cat > "${SUMMARY_FILE}" <<EOF
# Staging Migration Rehearsal Summary

- Timestamp (UTC): ${TIMESTAMP}
- Source DB: ${SOURCE_DB_NAME}
- Work DB: ${WORK_DB_NAME}
- Rollback DB: ${ROLLBACK_DB_NAME}
- Result: PASS

## Artifacts

1. Source snapshot: \`${SOURCE_SNAPSHOT_DUMP}\`
2. Work post-migration snapshot: \`${WORK_POST_MIGRATION_DUMP}\`
3. Source baseline metrics: \`${SOURCE_METRICS}\`
4. Work metrics: \`${WORK_METRICS}\`
5. Work invariants: \`${WORK_INVARIANTS}\`
6. Rollback metrics: \`${ROLLBACK_METRICS}\`
7. Execution log: \`${ARTIFACT_ROOT}/rehearsal.log\`
EOF

log "Staging migration rehearsal completed successfully."
log "Summary: ${SUMMARY_FILE}"
