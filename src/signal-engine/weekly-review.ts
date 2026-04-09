import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PaperTradeRow {
  date: string;
  ticker: string;
  action: string;
  finalAction: string;
  decision: string;
  direction: string;
  resultPct: number | null;
  overrideReason: string;
  fallbackHadFallback: boolean;
  fallbackReason: string;
  fallbackRetrySuggestion: string;
}

export interface WeeklyReviewSummary {
  windowDays: number;
  startDate: string;
  endDate: string;
  recordsInWindow: number;
  executedTrades: number;
  skippedSignals: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePct: number | null;
  averageResultPct: number | null;
  medianResultPct: number | null;
  totalResultPct: number | null;
  overrideCount: number;
  overrideRatePct: number | null;
  fallbackCount: number;
  fallbackMissingRetryCount: number;
  finalActionBreakdown: Record<string, number>;
  checklist: Array<{ item: string; status: 'pass' | 'warn'; note: string }>;
}

function parseArgs(argv: string[]): { logPath: string; days: number; json: boolean } {
  let logPath = path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'paper-trade-log.csv',
  );
  let days = 7;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--log' || arg === '-l') && argv[i + 1]) {
      logPath = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === '--days' || arg === '-d') && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        days = Math.floor(parsed);
      }
      i += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
    }
  }

  return { logPath, days, json };
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parsePercent(value: string): number | null {
  const normalized = value.replace('%', '').trim();
  if (!normalized || normalized === '-') return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function pickValue(
  row: Record<string, string>,
  aliases: string[],
  fallback = '',
): string {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined) return value;
  }
  return fallback;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round2((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return round2(sorted[mid]);
}

function buildChecklist(summary: Omit<WeeklyReviewSummary, 'checklist'>): WeeklyReviewSummary['checklist'] {
  const checks: WeeklyReviewSummary['checklist'] = [];

  checks.push({
    item: 'Closed trades sample size',
    status: summary.closedTrades >= 3 ? 'pass' : 'warn',
    note:
      summary.closedTrades >= 3
        ? `${summary.closedTrades} closed trades in window`
        : `${summary.closedTrades} closed trades; keep paper trading until sample is larger`,
  });

  checks.push({
    item: 'Fallback retry hygiene',
    status: summary.fallbackMissingRetryCount === 0 ? 'pass' : 'warn',
    note:
      summary.fallbackMissingRetryCount === 0
        ? 'All fallback rows include retry guidance'
        : `${summary.fallbackMissingRetryCount} fallback row(s) missing retry guidance`,
  });

  checks.push({
    item: 'Manual override discipline',
    status:
      summary.overrideRatePct === null || summary.overrideRatePct <= 20 ? 'pass' : 'warn',
    note:
      summary.overrideRatePct === null
        ? 'No decisions logged yet'
        : `Override rate ${summary.overrideRatePct}%`,
  });

  checks.push({
    item: 'Outcome drift',
    status:
      summary.averageResultPct === null || summary.averageResultPct >= 0 ? 'pass' : 'warn',
    note:
      summary.averageResultPct === null
        ? 'No closed trades yet'
        : `Average closed-trade result ${summary.averageResultPct}%`,
  });

  checks.push({
    item: 'Win rate floor',
    status: summary.winRatePct === null || summary.winRatePct >= 45 ? 'pass' : 'warn',
    note:
      summary.winRatePct === null
        ? 'No closed trades yet'
        : `Win rate ${summary.winRatePct}%`,
  });

  return checks;
}

export function parsePaperTradeCsv(content: string): PaperTradeRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeKey);
  const rows: PaperTradeRow[] = [];

  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const raw: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      raw[headers[i]] = cols[i] ?? '';
    }

    const date = pickValue(raw, ['date']);
    const ticker = pickValue(raw, ['ticker']).toUpperCase();
    if (!date || !ticker) continue;

    const action = pickValue(raw, ['action', 'signalaction', 'signalrawaction']);
    const finalAction = pickValue(raw, ['finalaction', 'signalfinalaction']);
    const decision = pickValue(raw, ['decision', 'yourdecision']);
    const direction = pickValue(raw, ['direction']);
    const resultPct = parsePercent(pickValue(raw, ['result', 'resultpct', 'resultpercent']));
    const overrideReason = pickValue(raw, ['reasonforoverride', 'overridereason']);
    const fallbackHadFallback = parseBoolean(
      pickValue(raw, ['fallbackhadfallback', 'hadfallback'], 'false'),
    );
    const fallbackReason = pickValue(raw, ['fallbackreason']);
    const fallbackRetrySuggestion = pickValue(raw, [
      'fallbackretrysuggestion',
      'retrysuggestion',
    ]);

    rows.push({
      date,
      ticker,
      action,
      finalAction,
      decision,
      direction,
      resultPct,
      overrideReason,
      fallbackHadFallback,
      fallbackReason,
      fallbackRetrySuggestion,
    });
  }

  return rows;
}

export function summarizeWeeklyReview(
  rows: PaperTradeRow[],
  options: { days?: number; asOf?: Date } = {},
): WeeklyReviewSummary {
  const days = options.days ?? 7;
  const asOf = options.asOf ?? new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const windowStart = new Date(asOf.getTime() - (days - 1) * msPerDay);

  const inWindow = rows.filter((row) => {
    const d = new Date(`${row.date}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d >= windowStart && d <= asOf;
  });

  const closed = inWindow.filter((row) => row.resultPct !== null).map((row) => row.resultPct as number);
  const wins = closed.filter((value) => value > 0).length;
  const losses = closed.filter((value) => value < 0).length;
  const breakeven = closed.filter((value) => value === 0).length;
  const executedTrades = inWindow.filter(
    (row) => row.decision.trim().toLowerCase() === 'trade',
  ).length;
  const skippedSignals = inWindow.filter(
    (row) => row.decision.trim().toLowerCase() === 'skip',
  ).length;
  const overrideCount = inWindow.filter((row) => row.overrideReason.trim().length > 0).length;
  const fallbackRows = inWindow.filter((row) => row.fallbackHadFallback);
  const fallbackMissingRetryCount = fallbackRows.filter(
    (row) => row.fallbackRetrySuggestion.trim().length === 0,
  ).length;

  const breakdown: Record<string, number> = {};
  for (const row of inWindow) {
    const key = (row.finalAction || 'UNKNOWN').toUpperCase();
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }

  const summaryBase: Omit<WeeklyReviewSummary, 'checklist'> = {
    windowDays: days,
    startDate: windowStart.toISOString().slice(0, 10),
    endDate: asOf.toISOString().slice(0, 10),
    recordsInWindow: inWindow.length,
    executedTrades,
    skippedSignals,
    closedTrades: closed.length,
    wins,
    losses,
    breakeven,
    winRatePct: closed.length ? round2((wins / closed.length) * 100) : null,
    averageResultPct: closed.length
      ? round2(closed.reduce((sum, value) => sum + value, 0) / closed.length)
      : null,
    medianResultPct: median(closed),
    totalResultPct: closed.length ? round2(closed.reduce((sum, value) => sum + value, 0)) : null,
    overrideCount,
    overrideRatePct: inWindow.length ? round2((overrideCount / inWindow.length) * 100) : null,
    fallbackCount: fallbackRows.length,
    fallbackMissingRetryCount,
    finalActionBreakdown: breakdown,
  };

  return {
    ...summaryBase,
    checklist: buildChecklist(summaryBase),
  };
}

export async function runWeeklyReviewCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const raw = await readFile(args.logPath, 'utf8');
  const rows = parsePaperTradeCsv(raw);
  const summary = summarizeWeeklyReview(rows, { days: args.days });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('Weekly performance review');
  console.log(`Window: ${summary.startDate} -> ${summary.endDate} (${summary.windowDays} days)`);
  console.log(`Records: ${summary.recordsInWindow}`);
  console.log(`Closed trades: ${summary.closedTrades} | Win rate: ${summary.winRatePct ?? '-'}%`);
  console.log(
    `Avg/Median result: ${summary.averageResultPct ?? '-'}% / ${summary.medianResultPct ?? '-'}%`,
  );
  console.log(`Fallback rows: ${summary.fallbackCount} | Missing retry guidance: ${summary.fallbackMissingRetryCount}`);
  console.log(`Override rate: ${summary.overrideRatePct ?? '-'}%`);
  console.log('Checklist:');
  for (const item of summary.checklist) {
    const marker = item.status === 'pass' ? '[PASS]' : '[WARN]';
    console.log(`  ${marker} ${item.item} - ${item.note}`);
  }
}
