#!/usr/bin/env bun
import path from 'node:path';
import {
  buildFeatureEngineeredArtifact,
  buildSignalDiscoveryReport,
  loadPriceFeatureArtifactForSignalDiscovery,
  persistFeatureEngineeredArtifact,
  persistSignalDiscoveryReport,
  validateSignalDiscoveryConfig,
  type SignalDiscoveryConfig,
} from './feature-engineering-signal-discovery.js';

export interface SignalDiscoveryCliArgs extends SignalDiscoveryConfig {
  inputPath: string;
  featuresOutputPath: string;
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

export function parseSignalDiscoveryCliArgs(argv: string[]): SignalDiscoveryCliArgs {
  const out: SignalDiscoveryCliArgs = { inputPath: '', featuresOutputPath: '', json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--in' || arg === '--input' || arg === '--file' || arg === '-f') && argv[i + 1]) {
      out.inputPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--features-out' && argv[i + 1]) {
      out.featuresOutputPath = argv[i + 1].trim();
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
    if (arg === '--hold-days' && argv[i + 1]) {
      out.holdDays = parseNumberFlag(arg, argv[i + 1]);
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
  validateSignalDiscoveryConfig(out);
  return out;
}

function printHelp(): void {
  console.log('Research-only feature engineering and signal discovery');
  console.log('');
  console.log('Run from a local price-feature artifact:');
  console.log('  bun run src/signal-engine/research/feature-engineering-signal-discovery.cli.ts --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json --features-out .dexter/signal-engine/research/features/feature-engineered-signal-discovery-expanded-universe-2026-04-26.json --out .dexter/signal-engine/research/analysis/feature-engineering-signal-discovery-expanded-universe-2026-04-26.json');
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Existing local price-feature artifact JSON');
  console.log('  --features-out <path>              Enriched feature artifact output path');
  console.log('  --out <path>                       Signal discovery report JSON output path');
  console.log('  --top-ns <csv>                     Default 4,6,8');
  console.log('  --cost-bps-values <csv>            Default 0,10,25');
  console.log('  --hold-days <number>               Default 20');
  console.log('  --min-trades <number>              Default 20');
  console.log('  --json                             Print report JSON to stdout after writing feature artifact');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseSignalDiscoveryCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.inputPath) throw new Error('Missing required --in <price-feature-artifact-path> argument.');
  if (!args.featuresOutputPath) throw new Error('Missing required --features-out <feature-artifact-output-path> argument.');

  const priceArtifact = await loadPriceFeatureArtifactForSignalDiscovery(args.inputPath);
  const featureArtifact = buildFeatureEngineeredArtifact(priceArtifact, path.resolve(args.inputPath));
  const savedFeatures = await persistFeatureEngineeredArtifact(featureArtifact, args.featuresOutputPath);
  const report = buildSignalDiscoveryReport(featureArtifact, {
    inputPath: args.inputPath,
    featuresOutputPath: args.featuresOutputPath,
    outputPath: args.outputPath,
    initialCapital: args.initialCapital,
    topNs: args.topNs,
    costBpsValues: args.costBpsValues,
    holdDays: args.holdDays,
    minTradesForCandidate: args.minTradesForCandidate,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const savedReport = await persistSignalDiscoveryReport(report, args.outputPath);
  console.log('Research feature-engineering signal discovery completed');
  console.log(`Feature rows: ${report.featureArtifactHealth.rowCount}`);
  console.log(`Tickers: ${report.featureArtifactHealth.tickerCount}`);
  console.log(`Configs tested: ${report.summary.totalConfigsTested}`);
  console.log(`Final decision: ${report.summary.finalDecision}`);
  console.log(`Final recommendation: ${report.summary.finalRecommendation}`);
  console.log(`Features JSON: ${path.relative(process.cwd(), savedFeatures)}`);
  console.log(`Report JSON: ${path.relative(process.cwd(), savedReport)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'feature-engineering-signal-discovery.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research feature-engineering signal discovery failed: ${message}`);
    process.exit(1);
  });
}
