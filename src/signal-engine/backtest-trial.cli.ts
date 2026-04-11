#!/usr/bin/env bun
import path from 'node:path';
import {
  getApiUsageSnapshot,
  resetApiUsageCounters,
  writeApiUsageReport,
} from '../tools/finance/api.js';
import {
  persistTrialBacktestReport,
  runTrialBacktest,
  TrialBacktestConfig,
} from './backtest-trial.js';

function applyPreset(
  out: Partial<TrialBacktestConfig>,
  preset: string,
): Partial<TrialBacktestConfig> {
  const key = preset.trim().toLowerCase();
  if (key === 'adaptive-safe') {
    return {
      ...out,
      signalProfile: 'adaptive_safe',
      adaptiveBuyScoreFloor: -0.14,
      adaptiveAddScoreImprovementMin: 0.01,
      adaptiveMinExpectedEdgeAfterCostsBps: 20,
      tacticalDipEnabled: true,
      tacticalZScoreMax: -0.9,
      tacticalMinEdgeAfterCostsBps: 8,
      exitStopLossPct: 2.5,
      exitTakeProfitPct: 4.5,
      exitMaxHoldTradingDays: 7,
    };
  }
  if (key === 'adaptive-explore') {
    return {
      ...out,
      signalProfile: 'adaptive',
      adaptiveBuyScoreFloor: -0.18,
      adaptiveAddScoreImprovementMin: 0.005,
      adaptiveMinExpectedEdgeAfterCostsBps: 12,
      tacticalDipEnabled: true,
      tacticalZScoreMax: -0.7,
      tacticalMinEdgeAfterCostsBps: 6,
      exitStopLossPct: 2.0,
      exitTakeProfitPct: 4.0,
      exitMaxHoldTradingDays: 6,
    };
  }
  if (key === 'swing-alpha') {
    return {
      ...out,
      signalProfile: 'swing_alpha',
      mode: 'long_short',
      tacticalDipEnabled: true,
      tacticalMinEdgeAfterCostsBps: 6,
    };
  }
  if (key === 'macd-parity') {
    return {
      ...out,
      signalProfile: 'macd_parity',
      mode: 'long_short',
      adaptiveMinExpectedEdgeAfterCostsBps: 0,
    };
  }
  return out;
}

function parseArgs(argv: string[]): Partial<TrialBacktestConfig> {
  const out: Partial<TrialBacktestConfig> = {
    ticker: 'AAPL',
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    initialCapitalUsd: 10_000,
    mode: 'long_only',
    execution: 'next_open',
    apiDelayMs: 250,
    signalProfile: 'adaptive_safe',
    dataRouting: {
      priceProvider: 'cache_yahoo_paid_fallback',
      fundamentalsProvider: 'paid_cached',
    },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--preset' && argv[i + 1]) {
      Object.assign(out, applyPreset(out, argv[i + 1]));
      i += 1;
      continue;
    }
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
    if (arg === '--offline-replay') {
      process.env.FINANCIAL_DATASETS_OFFLINE_REPLAY = '1';
      continue;
    }
    if (arg === '--max-api-calls' && argv[i + 1]) {
      process.env.FINANCIAL_DATASETS_MAX_CALLS_PER_RUN = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--mode' && argv[i + 1]) {
      const value = argv[i + 1].trim().toLowerCase();
      if (value === 'long_only' || value === 'long_short') out.mode = value;
      i += 1;
      continue;
    }
    if ((arg === '--profile' || arg === '--signal-profile') && argv[i + 1]) {
      const value = argv[i + 1].trim().toLowerCase();
      if (
        value === 'baseline' ||
        value === 'research' ||
        value === 'adaptive' ||
        value === 'adaptive_safe' ||
        value === 'swing_alpha' ||
        value === 'macd_parity' ||
        value === 'ml_sidecar'
      ) {
        out.signalProfile = value;
      }
      i += 1;
      continue;
    }
    if (arg === '--price-provider' && argv[i + 1]) {
      const value = argv[i + 1].trim().toLowerCase();
      if (value === 'paid_api' || value === 'cache_yahoo_paid_fallback') {
        out.dataRouting = {
          ...(out.dataRouting ?? {
            priceProvider: 'cache_yahoo_paid_fallback',
            fundamentalsProvider: 'paid_cached',
          }),
          priceProvider: value,
          fundamentalsProvider: 'paid_cached',
        };
      }
      i += 1;
      continue;
    }
    if (arg === '--adaptive-buy-quantile' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value < 1) out.adaptiveBuyQuantile = value;
      i += 1;
      continue;
    }
    if (arg === '--adaptive-entry-buffer' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 0.2) out.adaptiveEntryBuffer = value;
      i += 1;
      continue;
    }
    if (arg === '--adaptive-committee-buy-relief' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 0.3) out.adaptiveCommitteeBuyRelief = value;
      i += 1;
      continue;
    }
    if (arg === '--adaptive-buy-score-floor' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= -1 && value <= 1) out.adaptiveBuyScoreFloor = value;
      i += 1;
      continue;
    }
    if (arg === '--adaptive-add-score-improvement-min' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 1) out.adaptiveAddScoreImprovementMin = value;
      i += 1;
      continue;
    }
    if (arg === '--tactical-dip-enabled' && argv[i + 1]) {
      const value = argv[i + 1].trim().toLowerCase();
      out.tacticalDipEnabled = value === '1' || value === 'true' || value === 'yes';
      i += 1;
      continue;
    }
    if (arg === '--tactical-rsi-max' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) out.tacticalRsiMax = value;
      i += 1;
      continue;
    }
    if (arg === '--tactical-zscore-max' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value < 0) out.tacticalZScoreMax = value;
      i += 1;
      continue;
    }
    if (arg === '--tactical-trend-score-min' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= -1 && value <= 1) out.tacticalTrendScoreMin = value;
      i += 1;
      continue;
    }
    if (arg === '--tactical-min-risk-score' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 1) out.tacticalMinRiskScore = value;
      i += 1;
      continue;
    }
    if (arg === '--tactical-max-aggregate-score' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= -1 && value <= 1) out.tacticalMaxAggregateScore = value;
      i += 1;
      continue;
    }
    if (arg === '--tactical-min-edge-bps' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 500) out.tacticalMinEdgeAfterCostsBps = value;
      i += 1;
      continue;
    }
    if (arg === '--exit-stop-loss-pct' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value <= 50) out.exitStopLossPct = value;
      i += 1;
      continue;
    }
    if (arg === '--exit-take-profit-pct' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) out.exitTakeProfitPct = value;
      i += 1;
      continue;
    }
    if (arg === '--exit-max-hold-days' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 1 && value <= 60) out.exitMaxHoldTradingDays = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--adaptive-min-edge-bps' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 500) out.adaptiveMinExpectedEdgeAfterCostsBps = value;
      i += 1;
      continue;
    }
    if (arg === '--ml-predictions' && argv[i + 1]) {
      out.mlPredictionsCsvPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--ml-buy-prob' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value < 1) out.mlBuyProbabilityThreshold = value;
      i += 1;
      continue;
    }
    if (arg === '--ml-sell-prob' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value < 1) out.mlSellProbabilityThreshold = value;
      i += 1;
      continue;
    }
    if (arg === '--ml-min-risk' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0 && value <= 1) out.mlMinRiskScore = value;
      i += 1;
      continue;
    }
    if (arg === '--ml-position-scale' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0 && value <= 1) out.mlPositionScale = value;
      i += 1;
      continue;
    }
  }
  return out;
}

async function main(): Promise<void> {
  resetApiUsageCounters();
  const config = parseArgs(process.argv.slice(2));
  const report = await runTrialBacktest(config);
  const persisted = await persistTrialBacktestReport(report);
  const usageLabel = `backtest-${report.config.ticker}-${report.config.startDate}-${report.config.endDate}`;
  const usageReportPath = writeApiUsageReport(usageLabel);
  const usage = getApiUsageSnapshot();

  console.log('Trial backtest completed');
  console.log(`Ticker: ${report.config.ticker}`);
  console.log(`Window: ${report.config.startDate} -> ${report.config.endDate}`);
  console.log(`Rows: ${report.dailyRecords.length} calendar days`);
  console.log(`Profile: ${report.config.signalProfile}`);
  console.log(`Mode: ${report.config.mode}`);
  console.log(`Price provider: ${report.config.dataRouting.priceProvider}`);
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
  console.log(`Cache Hit Rate: ${report.summary.cacheHitRate}%`);
  console.log(`API calls used: ${usage.totalCalls}`);
  if (report.summary.apiCallsByEndpoint.length > 0) {
    console.log('API calls by endpoint:');
    for (const item of report.summary.apiCallsByEndpoint.slice(0, 5)) {
      console.log(`  - ${item.endpoint}: ${item.calls}`);
    }
  }
  console.log(`API usage report: ${path.relative(process.cwd(), usageReportPath)}`);
  console.log(`JSON report: ${path.relative(process.cwd(), persisted.jsonPath)}`);
  console.log(`CSV report: ${path.relative(process.cwd(), persisted.csvPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Trial backtest failed: ${message}`);
  process.exit(1);
});
