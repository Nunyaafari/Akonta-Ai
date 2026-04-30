#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required."
  exit 1
fi

for cmd in node docker npx diff awk; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
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
if (!databaseUrl) process.exit(1);
const parsed = new URL(databaseUrl);
const sourceDb = parsed.pathname.replace(/^\//, '');
const safeBase = (sourceDb || 'akonta').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
const workDb = `${safeBase}_reh_work`;
const rollbackDb = `${safeBase}_reh_rollback`;
const host = parsed.hostname || 'localhost';
const port = parsed.port || '5432';
const user = decodeURIComponent(parsed.username || 'postgres');
const password = decodeURIComponent(parsed.password || '');
console.log(`SOURCE_DB_NAME=${JSON.stringify(sourceDb)}`);
console.log(`WORK_DB_NAME=${JSON.stringify(workDb)}`);
console.log(`ROLLBACK_DB_NAME=${JSON.stringify(rollbackDb)}`);
console.log(`DB_HOST=${JSON.stringify(host)}`);
console.log(`DB_PORT=${JSON.stringify(port)}`);
console.log(`DB_USER=${JSON.stringify(user)}`);
console.log(`DB_PASSWORD=${JSON.stringify(password)}`);
NODE
)"

DB_CONTAINER="${DOCKER_DB_CONTAINER:-$(docker compose ps -q db | head -n 1)}"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "Unable to resolve db container id. Start docker compose first."
  exit 1
fi
DOCKER_PG_HOST="${DOCKER_PG_HOST:-127.0.0.1}"
DOCKER_PG_PORT="${DOCKER_PG_PORT:-5432}"

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

db_exec() {
  local db_name="$1"
  shift
  docker exec -i -e PGPASSWORD="${DB_PASSWORD}" "${DB_CONTAINER}" "$@" -h "${DOCKER_PG_HOST}" -p "${DOCKER_PG_PORT}" -U "${DB_USER}" -d "${db_name}"
}

db_psql_file() {
  local db_name="$1"
  local sql_file="$2"
  local output_file="$3"
  cat "${sql_file}" | db_exec "${db_name}" psql -v ON_ERROR_STOP=1 > "${output_file}"
}

reset_database() {
  local target_name="$1"
  log "Resetting database ${target_name}"
  db_exec postgres psql -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${target_name}' AND pid <> pg_backend_pid();" >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1
  db_exec postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${target_name}\";" >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1
  db_exec postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${target_name}\";" >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1
}

capture_baseline_metrics() {
  local db_name="$1"
  local output_file="$2"
  db_psql_file "${db_name}" "${SQL_DIR}/rehearsal_baseline_metrics.sql" "${output_file}"
}

capture_invariants() {
  local db_name="$1"
  local output_file="$2"
  db_psql_file "${db_name}" "${SQL_DIR}/rehearsal_invariants.sql" "${output_file}"
}

log "Starting Docker-based staging migration rehearsal"
log "Artifacts: ${ARTIFACT_ROOT}"
log "DB container: ${DB_CONTAINER}"
log "Source database: ${SOURCE_DB_NAME}"
log "Work database: ${WORK_DB_NAME}"
log "Rollback database: ${ROLLBACK_DB_NAME}"

log "Step 1/8: Taking source snapshot backup"
db_exec "${SOURCE_DB_NAME}" pg_dump -Fc > "${SOURCE_SNAPSHOT_DUMP}"

log "Step 2/8: Capturing baseline source metrics"
capture_baseline_metrics "${SOURCE_DB_NAME}" "${SOURCE_METRICS}"

log "Step 3/8: Restoring source snapshot into work database"
reset_database "${WORK_DB_NAME}"
cat "${SOURCE_SNAPSHOT_DUMP}" | db_exec "${WORK_DB_NAME}" pg_restore --clean --if-exists --no-owner --no-privileges

log "Step 4/8: Applying migrations on work database"
(
  cd "${BACKEND_DIR}"
  DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${WORK_DB_NAME}" npx prisma migrate deploy
) >> "${ARTIFACT_ROOT}/rehearsal.log" 2>&1

log "Step 5/8: Running post-migration metrics + invariant checks"
capture_baseline_metrics "${WORK_DB_NAME}" "${WORK_METRICS}"
capture_invariants "${WORK_DB_NAME}" "${WORK_INVARIANTS}"

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
db_exec "${WORK_DB_NAME}" pg_dump -Fc > "${WORK_POST_MIGRATION_DUMP}"

log "Step 7/8: Rollback drill (restore source snapshot into rollback database)"
reset_database "${ROLLBACK_DB_NAME}"
cat "${SOURCE_SNAPSHOT_DUMP}" | db_exec "${ROLLBACK_DB_NAME}" pg_restore --clean --if-exists --no-owner --no-privileges

log "Step 8/8: Validating rollback parity"
capture_baseline_metrics "${ROLLBACK_DB_NAME}" "${ROLLBACK_METRICS}"
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
- Mode: Docker-native

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
