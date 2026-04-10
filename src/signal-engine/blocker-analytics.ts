import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { TrialBacktestReport } from './backtest-trial.js';

export interface BlockerCount {
  blocker: string;
  count: number;
  pctOfHoldDays: number;
}

export interface MonthlyBlockerSummary {
  month: string;
  tradingDays: number;
  holdDays: number;
  noSignalDays: number;
  topBlockers: BlockerCount[];
}

export interface BlockerAnalyticsReport {
  ticker: string;
  profile: string;
  startDate: string;
  endDate: string;
  files: string[];
  monthly: MonthlyBlockerSummary[];
  overall: {
    tradingDays: number;
    holdDays: number;
    noSignalDays: number;
    topBlockers: BlockerCount[];
  };
}

export interface BlockerAnalyticsOptions {
  ticker: string;
  profile: string;
  startDate: string;
  endDate: string;
  maxTop: number;
  backtestsDir: string;
}

type CliArgs = BlockerAnalyticsOptions & { json: boolean };

const DEFAULTS: CliArgs = {
  ticker: 'AAPL',
  profile: 'adaptive',
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  maxTop: 5,
  backtestsDir: path.join(process.cwd(), '.dexter', 'signal-engine', 'backtests'),
  json: false,
};

function toMonthKey(date: string): string {
  return date.slice(0, 7);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function dateToEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
}

function blockerStats(
  counts: Map<string, number>,
  holdDays: number,
  maxTop: number,
): BlockerCount[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTop)
    .map(([blocker, count]) => ({
      blocker,
      count,
      pctOfHoldDays: holdDays > 0 ? round2((count / holdDays) * 100) : 0,
    }));
}

function normalizeBlocker(blocker: string): string {
  if (blocker.startsWith('NO_SIGNAL: expected edge after costs')) {
    return 'NO_SIGNAL: expected edge after costs below minimum';
  }
  if (blocker.startsWith('NO_SIGNAL_DATA_GAP:')) {
    return 'NO_SIGNAL_DATA_GAP: critical input missing';
  }
  return blocker;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--ticker' || arg === '-t') && argv[i + 1]) {
      out.ticker = argv[i + 1].trim().toUpperCase();
      i += 1;
      continue;
    }
    if ((arg === '--profile' || arg === '-p') && argv[i + 1]) {
      out.profile = argv[i + 1].trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--start' && argv[i + 1]) {
      out.startDate = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--end' && argv[i + 1]) {
      out.endDate = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--max-top' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) out.maxTop = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--dir' && argv[i + 1]) {
      out.backtestsDir = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--json') out.json = true;
  }
  return out;
}

function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

async function loadReports(options: BlockerAnalyticsOptions): Promise<Array<{ file: string; report: TrialBacktestReport }>> {
  const files = await readdir(options.backtestsDir);
  const pattern =
    /^trial-backtest-(?<ticker>[A-Z.\-]+)-(?<profile>[a-z_]+)-(?<start>\d{4}-\d{2}-\d{2})-(?<end>\d{4}-\d{2}-\d{2})\.json$/;
  const selected: Array<{ file: string; report: TrialBacktestReport }> = [];

  for (const file of files) {
    const match = file.match(pattern);
    if (!match?.groups) continue;
    if (match.groups.ticker !== options.ticker) continue;
    if (match.groups.profile !== options.profile) continue;
    if (
      !rangesOverlap(
        match.groups.start,
        match.groups.end,
        options.startDate,
        options.endDate,
      )
    ) {
      continue;
    }
    const fullPath = path.join(options.backtestsDir, file);
    const raw = await readFile(fullPath, 'utf8');
    selected.push({
      file,
      report: JSON.parse(raw) as TrialBacktestReport,
    });
  }

  selected.sort((a, b) => a.report.config.startDate.localeCompare(b.report.config.startDate));
  return selected;
}

export function summarizeBlockers(
  reports: TrialBacktestReport[],
  maxTop: number,
): Pick<BlockerAnalyticsReport, 'monthly' | 'overall'> {
  const byDate = new Map<
    string,
    { row: TrialBacktestReport['dailyRecords'][number]; spanDays: number; generatedAt: string }
  >();
  for (const report of reports) {
    const spanDays =
      dateToEpochDay(report.config.endDate) - dateToEpochDay(report.config.startDate);
    for (const row of report.dailyRecords) {
      if (!row.isTradingDay) continue;
      const current = byDate.get(row.date);
      if (!current) {
        byDate.set(row.date, { row, spanDays, generatedAt: report.generatedAt });
        continue;
      }
      if (spanDays < current.spanDays) {
        byDate.set(row.date, { row, spanDays, generatedAt: report.generatedAt });
        continue;
      }
      if (spanDays === current.spanDays && report.generatedAt > current.generatedAt) {
        byDate.set(row.date, { row, spanDays, generatedAt: report.generatedAt });
      }
    }
  }

  const uniqueRows = Array.from(byDate.values())
    .map((item) => item.row)
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthlyCounts = new Map<string, Map<string, number>>();
  const monthlyTrading = new Map<string, number>();
  const monthlyHold = new Map<string, number>();
  const monthlyNoSignal = new Map<string, number>();
  const overallCounts = new Map<string, number>();
  let overallTrading = 0;
  let overallHold = 0;
  let overallNoSignal = 0;

  for (const row of uniqueRows) {
    const month = toMonthKey(row.date);
    monthlyTrading.set(month, (monthlyTrading.get(month) ?? 0) + 1);
    overallTrading += 1;

    if (row.signalAction !== 'HOLD') continue;
    const blocker = normalizeBlocker(row.primaryBlocker || 'Unknown blocker');
    monthlyHold.set(month, (monthlyHold.get(month) ?? 0) + 1);
    overallHold += 1;

    if (blocker.startsWith('NO_SIGNAL:') || blocker.startsWith('NO_SIGNAL_DATA_GAP:')) {
      monthlyNoSignal.set(month, (monthlyNoSignal.get(month) ?? 0) + 1);
      overallNoSignal += 1;
    }

    const monthMap = monthlyCounts.get(month) ?? new Map<string, number>();
    monthMap.set(blocker, (monthMap.get(blocker) ?? 0) + 1);
    monthlyCounts.set(month, monthMap);

    overallCounts.set(blocker, (overallCounts.get(blocker) ?? 0) + 1);
  }

  const monthly: MonthlyBlockerSummary[] = Array.from(monthlyTrading.keys())
    .sort()
    .map((month) => {
      const holdDays = monthlyHold.get(month) ?? 0;
      return {
        month,
        tradingDays: monthlyTrading.get(month) ?? 0,
        holdDays,
        noSignalDays: monthlyNoSignal.get(month) ?? 0,
        topBlockers: blockerStats(monthlyCounts.get(month) ?? new Map<string, number>(), holdDays, maxTop),
      };
    });

  return {
    monthly,
    overall: {
      tradingDays: overallTrading,
      holdDays: overallHold,
      noSignalDays: overallNoSignal,
      topBlockers: blockerStats(overallCounts, overallHold, maxTop),
    },
  };
}

export async function runBlockerAnalyticsCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const loaded = await loadReports(args);
  if (loaded.length === 0) {
    throw new Error(
      `No matching backtest reports found for ticker=${args.ticker}, profile=${args.profile}, window=${args.startDate}..${args.endDate}.`,
    );
  }

  const summarized = summarizeBlockers(
    loaded.map((item) => item.report),
    args.maxTop,
  );
  const report: BlockerAnalyticsReport = {
    ticker: args.ticker,
    profile: args.profile,
    startDate: args.startDate,
    endDate: args.endDate,
    files: loaded.map((item) => item.file),
    monthly: summarized.monthly,
    overall: summarized.overall,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('HOLD blocker analytics');
  console.log(`Ticker/Profile: ${report.ticker} / ${report.profile}`);
  console.log(`Window: ${report.startDate} -> ${report.endDate}`);
  console.log(`Files: ${report.files.length}`);
  for (const month of report.monthly) {
    console.log(
      `${month.month}: trading=${month.tradingDays}, hold=${month.holdDays}, no_signal=${month.noSignalDays}`,
    );
    for (const blocker of month.topBlockers) {
      console.log(
        `  - ${blocker.blocker}: ${blocker.count} (${blocker.pctOfHoldDays}% of HOLD days)`,
      );
    }
  }
  console.log(
    `Overall: trading=${report.overall.tradingDays}, hold=${report.overall.holdDays}, no_signal=${report.overall.noSignalDays}`,
  );
  for (const blocker of report.overall.topBlockers) {
    console.log(
      `  - ${blocker.blocker}: ${blocker.count} (${blocker.pctOfHoldDays}% of HOLD days)`,
    );
  }
}
