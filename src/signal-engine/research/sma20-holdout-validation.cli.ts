#!/usr/bin/env bun
import path from 'node:path';
import {
  buildSma20HoldoutValidationReport,
  loadPriceFeatureArtifactForSma20Holdout,
  persistSma20HoldoutValidationReport,
  validateSma20HoldoutConfig,
  type Sma20HoldoutValidationConfig,
} from './sma20-holdout-validation.js';

export interface Sma20HoldoutCliArgs extends Sma20HoldoutValidationConfig {
  inputPath: string;
  outputPath?: string;
  json: boolean;
  help: boolean;
}

function parseNumberFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseNumberList(flag: string, value: string): number[] {
  const raw = value.split(',').map((item) => item.trim());
  const parsed = raw.map(Number);
  const invalid = raw.find((_, index) => !Number.isFinite(parsed[index]));
  if (invalid !== undefined) throw new Error(`Invalid numeric value for ${flag}: ${invalid}`);
  return parsed;
}

export function parseSma20HoldoutCliArgs(argv: string[]): Sma20HoldoutCliArgs {
  const out: Sma20HoldoutCliArgs = {
    inputPath: '',
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--in' || arg === '--input' || arg === '--file' || arg === '-f') && argv[i + 1]) {
      out.inputPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      out.outputPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--initial-capital' && argv[i + 1]) {
      out.initialCapital = parseNumberFlag(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--top-ns' && argv[i + 1]) {
      out.topNs = parseNumberList(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--cost-bps-values' && argv[i + 1]) {
      out.costBpsValues = parseNumberList(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--min-trades' && argv[i + 1]) {
      out.minTradesForCandidate = parseNumberFlag(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--research-start' && argv[i + 1]) {
      out.researchWindow = { ...(out.researchWindow ?? { endDate: '2024-12-31' }), startDate: argv[i + 1].trim() };
      i += 1;
      continue;
    }
    if (arg === '--research-end' && argv[i + 1]) {
      out.researchWindow = { ...(out.researchWindow ?? { startDate: '2021-01-04' }), endDate: argv[i + 1].trim() };
      i += 1;
      continue;
    }
    if (arg === '--holdout-start' && argv[i + 1]) {
      out.holdoutWindow = { ...(out.holdoutWindow ?? { endDate: '2026-04-24' }), startDate: argv[i + 1].trim() };
      i += 1;
      continue;
    }
    if (arg === '--holdout-end' && argv[i + 1]) {
      out.holdoutWindow = { ...(out.holdoutWindow ?? { startDate: '2025-01-01' }), endDate: argv[i + 1].trim() };
      i += 1;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
  }

  validateSma20HoldoutConfig(out);
  return out;
}

function printHelp(): void {
  console.log('Research-only SMA20 holdout validation lane');
  console.log('');
  console.log('Run a fixed research/holdout split for sma20_gap_reversion from a local price-feature artifact:');
  console.log(
    '  bun run src/signal-engine/research/sma20-holdout-validation.cli.ts --in .dexter/signal-engine/research/price-features/price-features-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Price-feature/label artifact JSON');
  console.log('  --out <path>                       Holdout validation JSON output path');
  console.log('  --top-ns <csv>                     Default 2,4,6');
  console.log('  --cost-bps-values <csv>            Default 0,10,25');
  console.log('  --research-start <YYYY-MM-DD>      Default 2021-01-04');
  console.log('  --research-end <YYYY-MM-DD>        Default 2024-12-31');
  console.log('  --holdout-start <YYYY-MM-DD>       Default 2025-01-01');
  console.log('  --holdout-end <YYYY-MM-DD>         Default 2026-04-24');
  console.log('  --min-trades <number>              Default 20');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseSma20HoldoutCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.inputPath) {
    throw new Error('Missing required --in <price-feature-artifact-path> argument.');
  }

  const artifact = await loadPriceFeatureArtifactForSma20Holdout(args.inputPath);
  const report = buildSma20HoldoutValidationReport(artifact, {
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    initialCapital: args.initialCapital,
    topNs: args.topNs,
    costBpsValues: args.costBpsValues,
    minTradesForCandidate: args.minTradesForCandidate,
    researchWindow: args.researchWindow,
    holdoutWindow: args.holdoutWindow,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistSma20HoldoutValidationReport(report, args.outputPath);
  console.log('Research SMA20 holdout validation completed');
  console.log(`Rows: ${report.rows.length}`);
  console.log(`Research verdicts: ${JSON.stringify(report.summary.researchCountByVerdict)}`);
  console.log(`Holdout verdicts: ${JSON.stringify(report.summary.holdoutCountByVerdict)}`);
  console.log(`Final holdout verdict: ${report.summary.finalHoldoutVerdict}`);
  console.log(`Final recommendation: ${report.summary.finalRecommendation}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'sma20-holdout-validation.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research SMA20 holdout validation failed: ${message}`);
    process.exit(1);
  });
}
