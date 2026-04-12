import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PaperTradeRow, parsePaperTradeCsv } from './weekly-review.js';
import { normalizeActionForMode } from './action-normalization.js';

type ConfidenceBucket = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface QualityBucketMetrics {
  count: number;
  wins: number;
  losses: number;
  breakeven: number;
  hitRatePct: number | null;
  averageResultPct: number | null;
}

export interface SignalQualitySummary {
  windowDays: number;
  startDate: string;
  endDate: string;
  closedTrades: number;
  overallHitRatePct: number | null;
  byAction: Record<string, QualityBucketMetrics>;
  byConfidenceBucket: Record<ConfidenceBucket, QualityBucketMetrics>;
  byActionConfidenceBucket: Record<string, QualityBucketMetrics>;
  notes: string[];
}

type CliArgs = { logPath: string; days: number; json: boolean };

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function parseArgs(argv: string[]): CliArgs {
  let logPath = path.join(process.cwd(), '.dexter', 'signal-engine', 'paper-trade-log.csv');
  let days = 30;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--log' || arg === '-l') && argv[i + 1]) {
      logPath = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === '--days' || arg === '-d') && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) days = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--json') json = true;
  }

  return { logPath, days, json };
}

function confidenceBucket(confidence: number | null): ConfidenceBucket {
  if (confidence === null) return 'UNKNOWN';
  if (confidence < 40) return 'LOW';
  if (confidence < 70) return 'MEDIUM';
  return 'HIGH';
}

function initBucket(): QualityBucketMetrics {
  return {
    count: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    hitRatePct: null,
    averageResultPct: null,
  };
}

function finalizeBucket(values: number[], bucket: QualityBucketMetrics): QualityBucketMetrics {
  return {
    ...bucket,
    hitRatePct: bucket.count > 0 ? round2((bucket.wins / bucket.count) * 100) : null,
    averageResultPct:
      values.length > 0 ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
  };
}

export function summarizeSignalQuality(
  rows: PaperTradeRow[],
  options: { days?: number; asOf?: Date } = {},
): SignalQualitySummary {
  const days = options.days ?? 30;
  const asOf = options.asOf ?? new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const windowStart = new Date(asOf.getTime() - (days - 1) * msPerDay);

  const closedRows = rows.filter((row) => {
    if (row.resultPct === null) return false;
    const date = new Date(`${row.date}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return false;
    if (date < windowStart || date > asOf) return false;
    return row.decision.trim().toLowerCase() === 'trade';
  });

  const byAction: Record<string, QualityBucketMetrics> = {};
  const byActionValues: Record<string, number[]> = {};
  const byConfidenceBucket: Record<ConfidenceBucket, QualityBucketMetrics> = {
    UNKNOWN: initBucket(),
    LOW: initBucket(),
    MEDIUM: initBucket(),
    HIGH: initBucket(),
  };
  const byConfidenceValues: Record<ConfidenceBucket, number[]> = {
    UNKNOWN: [],
    LOW: [],
    MEDIUM: [],
    HIGH: [],
  };
  const byActionConfidenceBucket: Record<string, QualityBucketMetrics> = {};
  const byActionConfidenceValues: Record<string, number[]> = {};

  let wins = 0;

  for (const row of closedRows) {
    const result = row.resultPct as number;
    const inferredPosition = {
      longShares:
        row.action.trim().toUpperCase() === 'SELL' ||
        row.finalAction.trim().toUpperCase() === 'SELL'
          ? 1
          : 0,
      shortShares:
        row.action.trim().toUpperCase() === 'COVER' ||
        row.finalAction.trim().toUpperCase() === 'COVER'
          ? 1
          : 0,
    };
    const normalizedAction = normalizeActionForMode(
      row.finalAction || row.action || 'HOLD',
      'long_only',
      inferredPosition,
    );
    const action = normalizedAction.canonicalAction;
    const bucket = confidenceBucket(row.confidence);
    const actionBucketKey = `${action}:${bucket}`;

    byAction[action] = byAction[action] ?? initBucket();
    byActionValues[action] = byActionValues[action] ?? [];
    byActionConfidenceBucket[actionBucketKey] =
      byActionConfidenceBucket[actionBucketKey] ?? initBucket();
    byActionConfidenceValues[actionBucketKey] =
      byActionConfidenceValues[actionBucketKey] ?? [];

    byAction[action].count += 1;
    byConfidenceBucket[bucket].count += 1;
    byActionConfidenceBucket[actionBucketKey].count += 1;

    if (result > 0) {
      wins += 1;
      byAction[action].wins += 1;
      byConfidenceBucket[bucket].wins += 1;
      byActionConfidenceBucket[actionBucketKey].wins += 1;
    } else if (result < 0) {
      byAction[action].losses += 1;
      byConfidenceBucket[bucket].losses += 1;
      byActionConfidenceBucket[actionBucketKey].losses += 1;
    } else {
      byAction[action].breakeven += 1;
      byConfidenceBucket[bucket].breakeven += 1;
      byActionConfidenceBucket[actionBucketKey].breakeven += 1;
    }

    byActionValues[action].push(result);
    byConfidenceValues[bucket].push(result);
    byActionConfidenceValues[actionBucketKey].push(result);
  }

  for (const key of Object.keys(byAction)) {
    byAction[key] = finalizeBucket(byActionValues[key], byAction[key]);
  }
  for (const key of Object.keys(byConfidenceBucket) as ConfidenceBucket[]) {
    byConfidenceBucket[key] = finalizeBucket(
      byConfidenceValues[key],
      byConfidenceBucket[key],
    );
  }
  for (const key of Object.keys(byActionConfidenceBucket)) {
    byActionConfidenceBucket[key] = finalizeBucket(
      byActionConfidenceValues[key],
      byActionConfidenceBucket[key],
    );
  }

  const notes: string[] = [];
  if (closedRows.length < 20) {
    notes.push('Sample size is small (<20 closed trades); treat hit rates as provisional.');
  }
  if (byConfidenceBucket.UNKNOWN.count > 0) {
    notes.push('Some trades are missing confidence; add `Confidence` column to improve diagnostics.');
  }

  return {
    windowDays: days,
    startDate: windowStart.toISOString().slice(0, 10),
    endDate: asOf.toISOString().slice(0, 10),
    closedTrades: closedRows.length,
    overallHitRatePct: closedRows.length > 0 ? round2((wins / closedRows.length) * 100) : null,
    byAction,
    byConfidenceBucket,
    byActionConfidenceBucket,
    notes,
  };
}

export async function runSignalQualityCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const raw = await readFile(args.logPath, 'utf8');
  const rows = parsePaperTradeCsv(raw);
  const summary = summarizeSignalQuality(rows, { days: args.days });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('Signal quality dashboard');
  console.log(`Window: ${summary.startDate} -> ${summary.endDate} (${summary.windowDays} days)`);
  console.log(`Closed trades: ${summary.closedTrades}`);
  console.log(`Overall hit rate: ${summary.overallHitRatePct ?? '-'}%`);

  console.log('By action:');
  for (const [action, metrics] of Object.entries(summary.byAction)) {
    console.log(
      `  ${action}: count=${metrics.count}, hit=${metrics.hitRatePct ?? '-'}%, avg=${metrics.averageResultPct ?? '-'}%`,
    );
  }

  console.log('By confidence bucket:');
  for (const [bucket, metrics] of Object.entries(summary.byConfidenceBucket)) {
    console.log(
      `  ${bucket}: count=${metrics.count}, hit=${metrics.hitRatePct ?? '-'}%, avg=${metrics.averageResultPct ?? '-'}%`,
    );
  }

  if (summary.notes.length > 0) {
    console.log('Notes:');
    for (const note of summary.notes) {
      console.log(`  - ${note}`);
    }
  }
}
