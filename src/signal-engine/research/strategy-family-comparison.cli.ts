#!/usr/bin/env bun
import path from 'node:path';
import {
  buildStrategyFamilyComparisonReport,
  loadPriceFeatureArtifactForFamilyComparison,
  persistStrategyFamilyComparisonReport,
  validateStrategyFamilyComparisonConfig,
  type StrategyFamilyComparisonConfig,
} from './strategy-family-comparison.js';

export interface StrategyFamilyComparisonCliArgs extends StrategyFamilyComparisonConfig {
  inputPath: string;
  outputPath?: string;
  json: boolean;
  help: boolean;
}

function parseNumberList(flag: string, value: string): number[] {
  const values = value.split(',').map((item) => Number(item.trim()));
  const invalid = value.split(',').map((item) => item.trim()).find((_, index) => !Number.isFinite(values[index]));
  if (invalid !== undefined) {
    throw new Error(`Invalid numeric value for ${flag}: ${invalid}`);
  }
  return values;
}

function parseNumberFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }
  return parsed;
}

export function parseStrategyFamilyComparisonCliArgs(argv: string[]): StrategyFamilyComparisonCliArgs {
  const out: StrategyFamilyComparisonCliArgs = {
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
    if (arg === '--max-positions' && argv[i + 1]) {
      out.maxPositions = parseNumberFlag(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--min-trades' && argv[i + 1]) {
      out.minTradesForCandidate = parseNumberFlag(arg, argv[i + 1]);
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

  validateStrategyFamilyComparisonConfig(out);
  return out;
}

function printHelp(): void {
  console.log('Research-only strategy family comparison lane');
  console.log('');
  console.log('Compare simple long-only price-feature strategy families from a local price-feature artifact:');
  console.log(
    '  bun run src/signal-engine/research/strategy-family-comparison.cli.ts --in .dexter/signal-engine/research/price-features/price-features-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Price-feature/label artifact JSON');
  console.log('  --out <path>                       Strategy family comparison JSON output path');
  console.log('  --initial-capital <number>         Default 100000');
  console.log('  --top-ns <csv>                     Default 2,4,6');
  console.log('  --cost-bps-values <csv>            Default 0,10,25');
  console.log('  --max-positions <number>           Default 6');
  console.log('  --min-trades <number>              Default 20');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseStrategyFamilyComparisonCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.inputPath) {
    throw new Error('Missing required --in <price-feature-artifact-path> argument.');
  }

  const artifact = await loadPriceFeatureArtifactForFamilyComparison(args.inputPath);
  const report = buildStrategyFamilyComparisonReport(artifact, {
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    initialCapital: args.initialCapital,
    topNs: args.topNs,
    costBpsValues: args.costBpsValues,
    maxPositions: args.maxPositions,
    minTradesForCandidate: args.minTradesForCandidate,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistStrategyFamilyComparisonReport(report, args.outputPath);
  console.log('Research strategy family comparison completed');
  console.log(`Rows: ${report.summary.totalRows}`);
  console.log(`Verdicts: ${JSON.stringify(report.summary.countByVerdict)}`);
  console.log(`Overall recommendation: ${report.summary.overallRecommendation}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'strategy-family-comparison.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research strategy family comparison failed: ${message}`);
    process.exit(1);
  });
}
