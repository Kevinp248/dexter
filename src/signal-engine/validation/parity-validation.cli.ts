#!/usr/bin/env bun
import path from 'node:path';
import {
  buildParityValidationReport,
  persistParityValidationReport,
} from './parity-validation.js';
import { ParityValidationConfig } from './parity-models.js';

type CliArgs = Partial<ParityValidationConfig> & { json: boolean };

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    tickers: ['AAPL', 'MSFT'],
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    watchlistSliceSize: 25,
    apiDelayMs: 0,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--tickers' || arg === '-t') && argv[i + 1]) {
      out.tickers = argv[i + 1]
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
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
    if (arg === '--slice-size' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) out.watchlistSliceSize = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--portfolio-value' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) out.portfolioValue = value;
      i += 1;
      continue;
    }
    if (arg === '--api-delay-ms' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) out.apiDelayMs = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === '--json') out.json = true;
  }

  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildParityValidationReport(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const persisted = await persistParityValidationReport(report);
  console.log('Parity validation run completed');
  console.log(`Tickers: ${report.config.tickers.join(', ')}`);
  console.log(`Window: ${report.config.startDate} -> ${report.config.endDate}`);
  console.log(`Rows: ${report.summary.rows}`);
  console.log(`As-of dates: ${report.summary.asOfDates}`);
  console.log(`Rows with fallback: ${report.summary.rowsWithFallback}`);
  console.log(
    `Rows with non-available earnings provenance: ${report.summary.rowsWithUnavailableEarningsProvenance}`,
  );
  console.log(
    `Rows with non-available regime provenance: ${report.summary.rowsWithUnavailableRegimeProvenance}`,
  );
  console.log(`Warnings: ${report.warnings.length}`);
  if (report.warnings.length > 0) {
    for (const warning of report.warnings.slice(0, 5)) {
      console.log(`  - ${warning}`);
    }
  }
  console.log(`JSON: ${path.relative(process.cwd(), persisted.jsonPath)}`);
  console.log(`CSV: ${path.relative(process.cwd(), persisted.csvPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Parity validation failed: ${message}`);
  process.exit(1);
});
