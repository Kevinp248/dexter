#!/usr/bin/env bun
import path from 'node:path';
import {
  DEFAULT_MANIFEST_PATH,
  persistParityWalkForwardReport,
  runParityWalkForwardValidation,
} from './parity-walk-forward.js';

type CliArgs = {
  manifestPath: string;
  tickers?: string[];
  startDate: string;
  endDate: string;
  initialTrainSize: number;
  testSize: number;
  stepSize?: number;
  purgeSize?: number;
  embargoSize?: number;
  maxFolds?: number;
  holdoutStartDate?: string;
  holdoutEndDate?: string;
  json: boolean;
};

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    initialTrainSize: 30,
    testSize: 10,
    stepSize: 10,
    purgeSize: 2,
    embargoSize: 2,
    maxFolds: 6,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--manifest' || arg === '-m') && argv[i + 1]) {
      out.manifestPath = argv[i + 1];
      i += 1;
      continue;
    }
    if ((arg === '--tickers' || arg === '-t') && argv[i + 1]) {
      out.tickers = argv[i + 1]
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--start' && argv[i + 1]) {
      out.startDate = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--end' && argv[i + 1]) {
      out.endDate = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--initial-train-size' && argv[i + 1]) {
      out.initialTrainSize = parsePositiveInt(argv[i + 1], 'initialTrainSize');
      i += 1;
      continue;
    }
    if (arg === '--test-size' && argv[i + 1]) {
      out.testSize = parsePositiveInt(argv[i + 1], 'testSize');
      i += 1;
      continue;
    }
    if (arg === '--step-size' && argv[i + 1]) {
      out.stepSize = parsePositiveInt(argv[i + 1], 'stepSize');
      i += 1;
      continue;
    }
    if (arg === '--purge-size' && argv[i + 1]) {
      out.purgeSize = parseNonNegativeInt(argv[i + 1], 'purgeSize');
      i += 1;
      continue;
    }
    if (arg === '--embargo-size' && argv[i + 1]) {
      out.embargoSize = parseNonNegativeInt(argv[i + 1], 'embargoSize');
      i += 1;
      continue;
    }
    if (arg === '--max-folds' && argv[i + 1]) {
      out.maxFolds = parsePositiveInt(argv[i + 1], 'maxFolds');
      i += 1;
      continue;
    }
    if (arg === '--holdout-start' && argv[i + 1]) {
      out.holdoutStartDate = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--holdout-end' && argv[i + 1]) {
      out.holdoutEndDate = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
    }
  }

  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runParityWalkForwardValidation({
    manifestPath: args.manifestPath,
    tickers: args.tickers,
    startDate: args.startDate,
    endDate: args.endDate,
    holdoutStartDate: args.holdoutStartDate,
    holdoutEndDate: args.holdoutEndDate,
    walkForward: {
      initialTrainSize: args.initialTrainSize,
      testSize: args.testSize,
      stepSize: args.stepSize,
      purgeSize: args.purgeSize,
      embargoSize: args.embargoSize,
      maxFolds: args.maxFolds,
    },
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const persisted = await persistParityWalkForwardReport(report);
  console.log('Parity walk-forward validation completed');
  console.log(`Mode: ${report.mode}`);
  console.log(`Manifest: ${path.relative(process.cwd(), report.universe.manifestPath)}`);
  console.log(
    `Tickers: ${report.universe.effectiveTickerCount}/${report.universe.tickerCount} effective/manifest`,
  );
  console.log(`Window: ${report.dateWindow.startDate} -> ${report.dateWindow.endDate}`);
  console.log(`Folds: ${report.walkForward.folds.length}`);
  console.log(`Holdout: ${report.holdout ? `${report.holdout.startDate} -> ${report.holdout.endDate}` : 'none'}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`JSON: ${path.relative(process.cwd(), persisted.jsonPath)}`);
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('parity-walk-forward.cli.ts') ||
    process.argv[1].endsWith('parity-walk-forward.cli.js'));

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Parity walk-forward validation failed: ${message}`);
    process.exit(1);
  });
}
