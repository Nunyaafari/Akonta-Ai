#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const toIso = (timestampMs) => new Date(timestampMs).toISOString();

const requireCommand = (command) => {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
  } catch {
    throw new Error(`Required command is missing: ${command}`);
  }
};

const walkDirectory = async (dirPath) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return walkDirectory(fullPath);
    }
    return [fullPath];
  }));
  return files.flat();
};

const isBackupFile = (filePath) => {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith('.dump')
    || normalized.endsWith('.sql')
    || normalized.endsWith('.sql.gz');
};

const listLocalBackups = async (backupDir) => {
  const files = await walkDirectory(backupDir);
  const backups = await Promise.all(
    files
      .filter(isBackupFile)
      .map(async (filePath) => {
        const stat = await fs.stat(filePath);
        return {
          id: filePath,
          path: filePath,
          updatedAtMs: stat.mtimeMs
        };
      })
  );
  return backups.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
};

const listS3Backups = (bucket, prefix) => {
  requireCommand('aws');
  const args = [
    's3api',
    'list-objects-v2',
    '--bucket',
    bucket,
    '--prefix',
    prefix,
    '--output',
    'json'
  ];
  const raw = execFileSync('aws', args, { encoding: 'utf8' });
  const parsed = JSON.parse(raw);
  const contents = Array.isArray(parsed.Contents) ? parsed.Contents : [];
  const backups = contents
    .filter((entry) => typeof entry?.Key === 'string' && isBackupFile(entry.Key))
    .map((entry) => ({
      id: entry.Key,
      path: `s3://${bucket}/${entry.Key}`,
      updatedAtMs: new Date(entry.LastModified).getTime()
    }))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return backups;
};

const runRestoreSmokeCheck = ({ backupPath, databaseUrl }) => {
  requireCommand('psql');
  requireCommand('pg_restore');
  requireCommand('pg_isready');

  const url = new URL(databaseUrl);
  const sourceDbName = url.pathname.replace(/^\//, '');
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const restoreDbName = `${(sourceDbName || 'akonta').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32)}_restore_${Date.now()}`;
  const restoreUrl = new URL(url.toString());
  restoreUrl.pathname = `/${restoreDbName}`;

  execFileSync(
    'psql',
    [
      adminUrl.toString(),
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DROP DATABASE IF EXISTS "${restoreDbName}";`
    ],
    { stdio: 'pipe' }
  );
  execFileSync(
    'psql',
    [
      adminUrl.toString(),
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `CREATE DATABASE "${restoreDbName}";`
    ],
    { stdio: 'pipe' }
  );

  try {
    if (backupPath.endsWith('.dump')) {
      execFileSync(
        'pg_restore',
        [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-privileges',
          '--dbname',
          restoreUrl.toString(),
          backupPath
        ],
        { stdio: 'pipe' }
      );
    } else if (backupPath.endsWith('.sql.gz')) {
      execFileSync(
        'sh',
        ['-c', `gunzip -c "${backupPath}" | psql "${restoreUrl.toString()}" -v ON_ERROR_STOP=1`],
        { stdio: 'pipe' }
      );
    } else {
      execFileSync(
        'psql',
        [restoreUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-f', backupPath],
        { stdio: 'pipe' }
      );
    }

    const probe = execFileSync(
      'psql',
      [restoreUrl.toString(), '-tAc', 'SELECT 1;'],
      { encoding: 'utf8' }
    ).trim();
    if (probe !== '1') {
      throw new Error('Restore smoke check query did not return 1.');
    }
  } finally {
    execFileSync(
      'psql',
      [
        adminUrl.toString(),
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${restoreDbName}' AND pid <> pg_backend_pid();`
      ],
      { stdio: 'pipe' }
    );
    execFileSync(
      'psql',
      [
        adminUrl.toString(),
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `DROP DATABASE IF EXISTS "${restoreDbName}";`
      ],
      { stdio: 'pipe' }
    );
  }
};

const run = async () => {
  const startedAt = Date.now();
  const mode = (process.env.BACKUP_MODE ?? 'local').trim().toLowerCase();
  const retentionDays = Number(process.env.RETENTION_DAYS ?? 30);
  const minBackupsWithinRetention = Number(process.env.MIN_BACKUPS_WITHIN_RETENTION ?? 30);
  const maxBackupAgeHours = Number(process.env.MAX_BACKUP_AGE_HOURS ?? 30);
  const enforceRetentionPrune = parseBool(process.env.ENFORCE_RETENTION_PRUNE, true);
  const verifyRestore = parseBool(process.env.VERIFY_RESTORE, false);
  const databaseUrl = process.env.DATABASE_URL ?? '';

  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error('RETENTION_DAYS must be a positive number.');
  }
  if (!Number.isFinite(minBackupsWithinRetention) || minBackupsWithinRetention <= 0) {
    throw new Error('MIN_BACKUPS_WITHIN_RETENTION must be a positive number.');
  }
  if (!Number.isFinite(maxBackupAgeHours) || maxBackupAgeHours <= 0) {
    throw new Error('MAX_BACKUP_AGE_HOURS must be a positive number.');
  }

  let backups = [];
  if (mode === 'local') {
    const backupDir = process.env.BACKUP_DIR ?? '';
    if (!backupDir) {
      throw new Error('BACKUP_DIR is required when BACKUP_MODE=local.');
    }
    backups = await listLocalBackups(backupDir);
  } else if (mode === 's3') {
    const bucket = process.env.BACKUP_S3_BUCKET ?? '';
    const prefix = process.env.BACKUP_S3_PREFIX ?? '';
    if (!bucket) {
      throw new Error('BACKUP_S3_BUCKET is required when BACKUP_MODE=s3.');
    }
    backups = listS3Backups(bucket, prefix);
  } else {
    throw new Error(`Unsupported BACKUP_MODE: ${mode}`);
  }

  if (backups.length === 0) {
    throw new Error('No backup files were found for retention verification.');
  }

  const nowMs = Date.now();
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const maxAgeMs = maxBackupAgeHours * 60 * 60 * 1000;

  const newest = backups[0];
  const newestAgeMs = nowMs - newest.updatedAtMs;
  const withinRetention = backups.filter((item) => nowMs - item.updatedAtMs <= retentionMs);
  const olderThanRetention = backups.filter((item) => nowMs - item.updatedAtMs > retentionMs);

  const checks = [
    {
      id: 'latest_backup_freshness',
      passed: newestAgeMs <= maxAgeMs,
      message: `Latest backup age: ${(newestAgeMs / (60 * 60 * 1000)).toFixed(2)}h (max ${maxBackupAgeHours}h).`
    },
    {
      id: 'backup_count_within_retention',
      passed: withinRetention.length >= minBackupsWithinRetention,
      message: `Backups within ${retentionDays} days: ${withinRetention.length} (min ${minBackupsWithinRetention}).`
    },
    {
      id: 'retention_prune',
      passed: !enforceRetentionPrune || olderThanRetention.length === 0,
      message: `Backups older than ${retentionDays} days: ${olderThanRetention.length}.`
    }
  ];

  let restoreCheck = {
    attempted: false,
    passed: false,
    message: 'Skipped.'
  };

  if (verifyRestore) {
    if (mode !== 'local') {
      throw new Error('VERIFY_RESTORE is only supported with BACKUP_MODE=local.');
    }
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required when VERIFY_RESTORE=true.');
    }
    restoreCheck.attempted = true;
    runRestoreSmokeCheck({
      backupPath: newest.path,
      databaseUrl
    });
    restoreCheck = {
      attempted: true,
      passed: true,
      message: `Restore smoke check passed using ${newest.path}.`
    };
  }

  const passed = checks.every((check) => check.passed) && (!restoreCheck.attempted || restoreCheck.passed);
  const report = {
    mode,
    startedAt: toIso(startedAt),
    completedAt: toIso(Date.now()),
    retentionDays,
    minBackupsWithinRetention,
    maxBackupAgeHours,
    enforceRetentionPrune,
    totalBackupsFound: backups.length,
    newestBackup: {
      path: newest.path,
      updatedAt: toIso(newest.updatedAtMs),
      ageHours: Number((newestAgeMs / (60 * 60 * 1000)).toFixed(2))
    },
    withinRetentionCount: withinRetention.length,
    olderThanRetentionCount: olderThanRetention.length,
    checks,
    restoreCheck,
    passed
  };

  const reportPath = process.env.REPORT_PATH
    ? path.resolve(process.env.REPORT_PATH)
    : path.resolve(process.cwd(), 'rehearsal-artifacts', `backup-retention-${Date.now()}.json`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summaryLines = [
    `Backup retention verification: ${passed ? 'PASS' : 'FAIL'}`,
    `Mode: ${mode}`,
    `Total backups: ${backups.length}`,
    `Newest backup: ${newest.path} (${toIso(newest.updatedAtMs)})`,
    `Report: ${reportPath}`
  ];

  for (const line of summaryLines) {
    console.log(line);
  }
  for (const check of checks) {
    console.log(`- ${check.id}: ${check.passed ? 'PASS' : 'FAIL'} (${check.message})`);
  }
  if (restoreCheck.attempted) {
    console.log(`- restore_smoke_check: ${restoreCheck.passed ? 'PASS' : 'FAIL'} (${restoreCheck.message})`);
  }

  if (!passed) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(`Backup retention verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
