#!/usr/bin/env bun
import path from 'node:path';
import {
  persistTrialBacktestReport,
  runTrialBacktest,
  TrialBacktestConfig,
} from './backtest-trial.js';

function parseArgs(argv: string[]): Partial<TrialBacktestConfig> {
  const out: Partial<TrialBacktestConfig> = {
    ticker: 'AAPL',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    initialCapitalUsd: 10_000,
    mode: 'long_only',
    execution: 'next_open',
    apiDelayMs: 250,
    signalProfile: 'adaptive',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--ticker' || arg === '-t') && argv[i + 1]) {
      out.ticker = argv[i + 1].trim().toUpperCase();
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
    if (arg === '--capital' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) out.initialCapitalUsd = parsed;
      i += 1;
      continue;
    }
    if (arg === '--api-delay-ms' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 0) out.apiDelayMs = parsed;
      i += 1;
      continue;
    }
    if ((arg === '--profile' || arg === '--signal-profile') && argv[i + 1]) {
      const value = argv[i + 1].trim().toLowerCase();
      if (value === 'baseline' || value === 'research' || value === 'adaptive') {
        out.signalProfile = value;
      }
      i += 1;
      continue;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const report = await runTrialBacktest(config);
  const persisted = await persistTrialBacktestReport(report);

  console.log('Trial backtest completed');
  console.log(`Ticker: ${report.config.ticker}`);
  console.log(`Window: ${report.config.startDate} -> ${report.config.endDate}`);
  console.log(`Rows: ${report.dailyRecords.length} calendar days`);
  console.log(`Profile: ${report.config.signalProfile}`);
  console.log(`Trades: ${report.summary.trades}`);
  console.log(`Net PnL: $${report.summary.netPnlUsd}`);
  console.log(`Total Return: ${report.summary.totalReturnPct}%`);
  console.log(`Max Drawdown: ${report.summary.maxDrawdownPct}%`);
  console.log(`Benchmark Return: ${report.summary.benchmarkReturnPct ?? '-'}%`);
  console.log(`Fallback Trading Days: ${report.summary.fallbackTradingDays}`);
  console.log(`Fallback Rate: ${report.summary.fallbackRatePct}%`);
  console.log(`HOLD Trading Days: ${report.summary.holdTradingDays}`);
  console.log(`NO_SIGNAL Trading Days: ${report.summary.noSignalTradingDays}`);
  console.log(`Near BUY Days: ${report.summary.nearBuyDays}`);
  console.log(`Near SELL Days: ${report.summary.nearSellDays}`);
  console.log(`Data Quality: ${report.summary.dataQualityStatus.toUpperCase()} - ${report.summary.dataQualityNote}`);
  console.log(`JSON report: ${path.relative(process.cwd(), persisted.jsonPath)}`);
  console.log(`CSV report: ${path.relative(process.cwd(), persisted.csvPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Trial backtest failed: ${message}`);
  process.exit(1);
});
