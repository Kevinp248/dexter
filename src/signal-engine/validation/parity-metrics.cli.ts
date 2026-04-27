#!/usr/bin/env bun
import path from 'node:path';
import {
  buildParityMetricsReport,
  persistParityMetricsReport,
  readParityValidationReport,
} from './parity-metrics.js';

type CliArgs = {
  inputPath: string | null;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    inputPath: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--input' || arg === '-i') && argv[i + 1]) {
      out.inputPath = argv[i + 1];
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
  if (!args.inputPath) {
    throw new Error('Missing --input path to parity-validation JSON report.');
  }

  const validationReport = await readParityValidationReport(args.inputPath);
  const metricsReport = buildParityMetricsReport(validationReport);

  if (args.json) {
    console.log(JSON.stringify(metricsReport, null, 2));
    return;
  }

  const persisted = await persistParityMetricsReport(metricsReport, validationReport);
  console.log('Parity metrics completed');
  console.log(`Source report: ${path.relative(process.cwd(), args.inputPath)}`);
  console.log(`Source rows: ${metricsReport.sourceRows}`);
  console.log(`Warnings: ${metricsReport.warnings.length}`);
  if (metricsReport.warnings.length) {
    for (const warning of metricsReport.warnings.slice(0, 5)) {
      console.log(`  - ${warning}`);
    }
  }
  console.log(`JSON: ${path.relative(process.cwd(), persisted.jsonPath)}`);
  console.log(`Actions CSV: ${path.relative(process.cwd(), persisted.actionSummaryCsvPath)}`);
  console.log(`Calibration CSV: ${path.relative(process.cwd(), persisted.calibrationCsvPath)}`);
  console.log(`Regime CSV: ${path.relative(process.cwd(), persisted.regimeCsvPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Parity metrics failed: ${message}`);
  process.exit(1);
});
