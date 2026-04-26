#!/usr/bin/env bun
import path from 'node:path';
import {
  buildProfitRobustnessGridReport,
  loadPriceFeatureArtifactForRobustness,
  persistProfitRobustnessGridReport,
  type ProfitRobustnessGridConfig,
} from './profit-robustness-grid.js';
import { type RebalanceFrequency } from './profit-backtest.js';

interface CliArgs extends ProfitRobustnessGridConfig {
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
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseNumberFlag(flag, item));
  if (!parsed.length) {
    throw new Error(`Invalid value for ${flag}: expected at least one comma-separated number.`);
  }
  return parsed;
}

function parseRebalanceList(value: string): RebalanceFrequency[] {
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parsed.length) {
    throw new Error('Invalid value for --rebalance: expected daily, weekly, or both.');
  }
  for (const item of parsed) {
    if (item !== 'daily' && item !== 'weekly') {
      throw new Error(`Invalid value for --rebalance: ${item}. Expected daily or weekly.`);
    }
  }
  return parsed as RebalanceFrequency[];
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
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
    if (arg === '--hold-days' && argv[i + 1]) {
      out.holdDays = parseNumberList(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--top-ns' && argv[i + 1]) {
      out.topNs = parseNumberList(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--cost-bps' && argv[i + 1]) {
      out.costBps = parseNumberList(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--rebalance' && argv[i + 1]) {
      out.rebalanceFrequencies = parseRebalanceList(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--initial-capital' && argv[i + 1]) {
      out.initialCapital = parseNumberFlag(arg, argv[i + 1]);
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

  return out;
}

function printHelp(): void {
  console.log('Research-only profit robustness grid');
  console.log('');
  console.log('Stress test SMA20 gap reversion across hold/topN/cost parameters:');
  console.log(
    '  bun run src/signal-engine/research/profit-robustness-grid.cli.ts --in .dexter/signal-engine/research/price-features/price-features-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Price-feature/label artifact JSON');
  console.log('  --out <path>                       Robustness grid JSON output path');
  console.log('  --hold-days <csv>                  Default 5,10,20,40');
  console.log('  --top-ns <csv>                     Default 1,2,3,4');
  console.log('  --cost-bps <csv>                   Default 0,10,25,50');
  console.log('  --rebalance <csv>                  Default weekly; values daily,weekly');
  console.log('  --initial-capital <number>         Default 100000');
  console.log('  --min-trades <number>              Default 20');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.inputPath) {
    throw new Error('Missing required --in <price-feature-artifact-path> argument.');
  }

  const artifact = await loadPriceFeatureArtifactForRobustness(args.inputPath);
  const report = buildProfitRobustnessGridReport(artifact, {
    inputPath: args.inputPath,
    initialCapital: args.initialCapital,
    minTradesForCandidate: args.minTradesForCandidate,
    holdDays: args.holdDays,
    topNs: args.topNs,
    costBps: args.costBps,
    rebalanceFrequencies: args.rebalanceFrequencies,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistProfitRobustnessGridReport(report, args.outputPath);
  console.log('Research profit robustness grid completed');
  console.log(`Grid rows: ${report.summary.totalGridRows}`);
  console.log(`Verdict: ${report.summary.finalRobustnessVerdict}`);
  console.log(`Counts: ${JSON.stringify(report.summary.countByVerdict)}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Research profit robustness grid failed: ${message}`);
  process.exit(1);
});
