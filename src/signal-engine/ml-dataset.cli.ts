#!/usr/bin/env bun
import path from 'node:path';
import { buildMlDataset, MlDatasetConfig, persistMlDataset } from './ml-dataset.js';

function parseArgs(argv: string[]): Partial<MlDatasetConfig> {
  const out: Partial<MlDatasetConfig> = {
    ticker: 'AAPL',
    startDate: '2024-01-01',
    endDate: '2026-01-31',
    apiDelayMs: 250,
    fundamentalRefreshDays: 7,
    valuationRefreshDays: 7,
    sentimentRefreshDays: 3,
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
  }
  return out;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const report = await buildMlDataset(config);
  const saved = await persistMlDataset(report);
  console.log('ML dataset build completed');
  console.log(`Ticker: ${report.config.ticker}`);
  console.log(`Window: ${report.config.startDate} -> ${report.config.endDate}`);
  console.log(`Rows: ${report.summary.rows}`);
  console.log(`Labeled 1d rows: ${report.summary.labeled1dRows}`);
  console.log(`Labeled 5d rows: ${report.summary.labeled5dRows}`);
  console.log(`Fallback rows: ${report.summary.fallbackRows}`);
  console.log(`Quality-guard rows: ${report.summary.qualityGuardRows}`);
  console.log(`API calls used: ${report.apiUsage.totalCalls}`);
  console.log(`API usage report: ${path.relative(process.cwd(), report.apiUsage.usageReportPath)}`);
  console.log(`Dataset CSV: ${path.relative(process.cwd(), saved.csvPath)}`);
  console.log(`Dataset JSON: ${path.relative(process.cwd(), saved.jsonPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ML dataset build failed: ${message}`);
  process.exit(1);
});
