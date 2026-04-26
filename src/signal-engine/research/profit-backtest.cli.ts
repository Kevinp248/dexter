#!/usr/bin/env bun
import path from 'node:path';
import {
  buildProfitBacktestReport,
  loadPriceFeatureArtifactFromFile,
  persistProfitBacktestReport,
  validateProfitBacktestConfig,
  type ProfitBacktestConfig,
  type RebalanceFrequency,
} from './profit-backtest.js';

export interface ProfitBacktestCliArgs extends ProfitBacktestConfig {
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

function parseRebalance(value: string): RebalanceFrequency {
  if (value === 'daily' || value === 'weekly') return value;
  throw new Error(`Invalid rebalance frequency: ${value}`);
}

export function parseProfitBacktestCliArgs(argv: string[]): ProfitBacktestCliArgs {
  const out: ProfitBacktestCliArgs = {
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
    if (arg === '--cost-bps' && argv[i + 1]) {
      out.costBps = parseNumberFlag(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--top-n' && argv[i + 1]) {
      out.topN = parseNumberFlag(arg, argv[i + 1]);
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
    if (arg === '--ret-1d-rebalance' && argv[i + 1]) {
      const rebalanceFrequency = parseRebalance(argv[i + 1]);
      out.strategies = [
        {
          id: 'drawdown_reversal_20d',
          feature: 'drawdown_252d',
          rankDirection: 'ascending',
          holdDays: 20,
          rebalanceFrequency: 'weekly',
        },
        {
          id: 'ret_1d_reversal_5d',
          feature: 'ret_1d',
          rankDirection: 'ascending',
          holdDays: 5,
          rebalanceFrequency,
        },
        {
          id: 'sma20_gap_reversion_20d',
          feature: 'sma_20_gap',
          rankDirection: 'ascending',
          holdDays: 20,
          rebalanceFrequency: 'weekly',
        },
      ];
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

  validateProfitBacktestConfig(out, {
    initialCapital: '--initial-capital',
    costBps: '--cost-bps',
    topN: '--top-n',
    maxPositions: '--max-positions',
    minTradesForCandidate: '--min-trades',
  });

  return out;
}

function printHelp(): void {
  console.log('Research-only profit backtest lane');
  console.log('');
  console.log('Build an offline long-only profit simulation from a price-feature artifact:');
  console.log(
    '  bun run src/signal-engine/research/profit-backtest.cli.ts --in .dexter/signal-engine/research/price-features/price-features-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Price-feature/label artifact JSON');
  console.log('  --out <path>                       Profit backtest JSON output path');
  console.log('  --initial-capital <number>         Default 100000');
  console.log('  --cost-bps <number>                Entry and exit cost bps, default 10');
  console.log('  --top-n <number>                   Default 2');
  console.log('  --max-positions <number>           Default 3');
  console.log('  --min-trades <number>              Default 20');
  console.log('  --ret-1d-rebalance daily|weekly    Default weekly');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseProfitBacktestCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.inputPath) {
    throw new Error('Missing required --in <price-feature-artifact-path> argument.');
  }

  const artifact = await loadPriceFeatureArtifactFromFile(args.inputPath);
  const report = buildProfitBacktestReport(artifact, {
    inputPath: args.inputPath,
    initialCapital: args.initialCapital,
    costBps: args.costBps,
    topN: args.topN,
    maxPositions: args.maxPositions,
    minTradesForCandidate: args.minTradesForCandidate,
    strategies: args.strategies,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistProfitBacktestReport(report, args.outputPath);
  console.log('Research profit backtest completed');
  console.log(`Strategies: ${report.strategies.length}`);
  console.log(`Baselines: ${report.baselines.length}`);
  console.log(
    `Verdicts: ${JSON.stringify(Object.fromEntries(report.strategies.map((item) => [item.id, item.profitVerdict])))}`,
  );
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'profit-backtest.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research profit backtest failed: ${message}`);
    process.exit(1);
  });
}
