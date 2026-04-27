#!/usr/bin/env bun
import path from 'node:path';
import {
  buildSma20DecisionReport,
  loadPriceFeatureArtifactForSma20Decision,
  persistSma20DecisionReport,
  validateSma20DecisionConfig,
  type Sma20DecisionConfig,
} from './sma20-walkforward-decision-report.js';

export interface Sma20DecisionCliArgs extends Sma20DecisionConfig {
  inputPath: string;
  outputPath?: string;
  json: boolean;
  help: boolean;
}

function parseNumberFlag(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  return parsed;
}

function parseNumberList(flag: string, value: string): number[] {
  const raw = value.split(',').map((item) => item.trim());
  const parsed = raw.map(Number);
  const invalid = raw.find((_, index) => !Number.isFinite(parsed[index]));
  if (invalid !== undefined) throw new Error(`Invalid numeric value for ${flag}: ${invalid}`);
  return parsed;
}

export function parseSma20DecisionCliArgs(argv: string[]): Sma20DecisionCliArgs {
  const out: Sma20DecisionCliArgs = { inputPath: '', json: false, help: false };
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
    if (arg === '--deep-pullback-thresholds' && argv[i + 1]) {
      out.deepPullbackThresholds = parseNumberList(arg, argv[i + 1]);
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
  validateSma20DecisionConfig(out);
  return out;
}

function printHelp(): void {
  console.log('Research-only SMA20 walk-forward decision report');
  console.log('');
  console.log('Run the SMA20 decision gate from a local price-feature artifact:');
  console.log(
    '  bun run src/signal-engine/research/sma20-walkforward-decision-report.cli.ts --in .dexter/signal-engine/research/price-features/price-features-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Price-feature/label artifact JSON');
  console.log('  --out <path>                       Decision report JSON output path');
  console.log('  --top-ns <csv>                     Default 4,6,8');
  console.log('  --cost-bps-values <csv>            Default 0,10,25');
  console.log('  --deep-pullback-thresholds <csv>   Default -0.06,-0.08,-0.10,-0.12,-0.15');
  console.log('  --min-trades <number>              Default 20');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseSma20DecisionCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.inputPath) throw new Error('Missing required --in <price-feature-artifact-path> argument.');
  const artifact = await loadPriceFeatureArtifactForSma20Decision(args.inputPath);
  const report = buildSma20DecisionReport(artifact, {
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    initialCapital: args.initialCapital,
    topNs: args.topNs,
    costBpsValues: args.costBpsValues,
    deepPullbackThresholds: args.deepPullbackThresholds,
    minTradesForCandidate: args.minTradesForCandidate,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistSma20DecisionReport(report, args.outputPath);
  console.log('Research SMA20 walk-forward decision report completed');
  console.log(`Configs tested: ${report.summary.totalConfigsTested}`);
  console.log(`Walk-forward windows: ${report.summary.walkForwardWindows}`);
  console.log(`Final decision verdict: ${report.finalDecision.verdict}`);
  console.log(`Final recommendation: ${report.finalDecision.recommendation}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'sma20-walkforward-decision-report.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research SMA20 walk-forward decision report failed: ${message}`);
    process.exit(1);
  });
}
