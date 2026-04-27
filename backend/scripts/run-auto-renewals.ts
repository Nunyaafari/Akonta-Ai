import { runDueAutoRenewals } from '../src/services/subscriptions.js';

const parseFlag = (name: string): string | null => {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!direct) return null;
  const [, value] = direct.split('=', 2);
  return value ?? null;
};

const parseBoolean = (value: string | null, fallback = false): boolean => {
  if (value === null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseNumber = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const run = async () => {
  const dryRun = parseBoolean(parseFlag('dry-run'), false);
  const lookaheadDays = Math.max(0, Math.min(30, parseNumber(parseFlag('lookahead-days'), 0)));
  const maxBusinesses = Math.max(1, Math.min(1000, parseNumber(parseFlag('max-businesses'), 100)));
  const graceDays = Math.max(1, Math.min(30, parseNumber(parseFlag('grace-days'), 5)));

  const result = await runDueAutoRenewals({
    dryRun,
    lookaheadDays,
    maxBusinesses,
    graceDays
  });

  console.log(JSON.stringify(result, null, 2));
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
