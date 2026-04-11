#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runTrialBacktest } from './backtest-trial.js';
import { resetApiUsageCounters, writeApiUsageReport } from '../tools/finance/api.js';

type WindowDef = { label: string; start: string; end: string };

const WINDOWS: WindowDef[] = [
  { label: '2026-01', start: '2026-01-01', end: '2026-01-31' },
  { label: '2026-02', start: '2026-02-01', end: '2026-02-28' },
  { label: '2026-03', start: '2026-03-01', end: '2026-03-31' },
];

const TICKERS = ['AAPL', 'MSFT'];
const PROFILES = ['adaptive_safe', 'swing_alpha'] as const;
const MODES = ['long_only', 'long_short'] as const;

type MatrixRow = {
  ticker: string;
  month: string;
  profile: (typeof PROFILES)[number];
  mode: (typeof MODES)[number];
  returnPct: number;
  maxDrawdownPct: number;
  trades: number;
  turnoverPct: number;
  fallbackRatePct: number;
  benchmarkReturnPct: number | null;
  benchmarkSpreadPct: number | null;
  dataQuality: string;
};

function toCsv(rows: MatrixRow[]): string {
  const headers = [
    'ticker',
    'month',
    'profile',
    'mode',
    'returnPct',
    'maxDrawdownPct',
    'trades',
    'turnoverPct',
    'fallbackRatePct',
    'benchmarkReturnPct',
    'benchmarkSpreadPct',
    'dataQuality',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.ticker,
        row.month,
        row.profile,
        row.mode,
        row.returnPct,
        row.maxDrawdownPct,
        row.trades,
        row.turnoverPct,
        row.fallbackRatePct,
        row.benchmarkReturnPct ?? '',
        row.benchmarkSpreadPct ?? '',
        row.dataQuality,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const rows: MatrixRow[] = [];
  resetApiUsageCounters();

  for (const ticker of TICKERS) {
    for (const month of WINDOWS) {
      for (const profile of PROFILES) {
        for (const mode of MODES) {
          const report = await runTrialBacktest({
            ticker,
            startDate: month.start,
            endDate: month.end,
            signalProfile: profile,
            mode,
            dataRouting: {
              priceProvider: 'cache_yahoo_paid_fallback',
              fundamentalsProvider: 'paid_cached',
            },
          });
          rows.push({
            ticker,
            month: month.label,
            profile,
            mode,
            returnPct: report.summary.totalReturnPct,
            maxDrawdownPct: report.summary.maxDrawdownPct,
            trades: report.summary.trades,
            turnoverPct: report.summary.turnoverPct,
            fallbackRatePct: report.summary.fallbackRatePct,
            benchmarkReturnPct: report.summary.benchmarkReturnPct,
            benchmarkSpreadPct:
              report.summary.benchmarkReturnPct === null
                ? null
                : Number(
                    (report.summary.totalReturnPct - report.summary.benchmarkReturnPct).toFixed(4),
                  ),
            dataQuality: report.summary.dataQualityStatus,
          });
        }
      }
    }
  }

  const outDir = path.join(process.cwd(), '.dexter', 'signal-engine', 'reports');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `cross-ticker-harness-${stamp}.json`);
  const csvPath = path.join(outDir, `cross-ticker-harness-${stamp}.csv`);
  await writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2), 'utf8');
  await writeFile(csvPath, toCsv(rows), 'utf8');
  const usagePath = writeApiUsageReport(`cross-ticker-harness-${stamp}`);

  console.log('Cross-ticker harness complete');
  console.log(`Rows: ${rows.length}`);
  console.log(`JSON: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`CSV: ${path.relative(process.cwd(), csvPath)}`);
  console.log(`API usage: ${path.relative(process.cwd(), usagePath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Cross-ticker harness failed: ${message}`);
  process.exit(1);
});

