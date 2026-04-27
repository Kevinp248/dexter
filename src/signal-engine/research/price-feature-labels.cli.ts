#!/usr/bin/env bun
import path from 'node:path';
import {
  buildPriceFeatureLabelArtifact,
  loadNormalizedYahooArtifactFromFile,
  persistPriceFeatureLabelArtifact,
} from './price-feature-labels.js';

type CliArgs = {
  inputPath: string;
  outputPath?: string;
  sourceRef?: string;
  costBps?: number;
  json: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    inputPath: '',
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--in' || arg === '--input') && argv[i + 1]) {
      out.inputPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      out.outputPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--source-ref' && argv[i + 1]) {
      out.sourceRef = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--cost-bps' && argv[i + 1]) {
      out.costBps = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }

  return out;
}

function printHelp(): void {
  console.log('Research-only price feature/label dataset builder');
  console.log('');
  console.log('Build from normalized Yahoo artifact (offline only):');
  console.log('  bun run src/signal-engine/research/price-feature-labels.cli.ts --in .dexter/.../yahoo-normalized-*.json');
  console.log('');
  console.log('Options:');
  console.log('  --in, --input <path>       Normalized Yahoo artifact JSON');
  console.log('  --out <path>               Output path for dataset JSON');
  console.log('  --source-ref <string>      Source artifact reference/path metadata');
  console.log('  --cost-bps <number>        Round-trip fixed cost assumption in bps (default 10)');
  console.log('  --json                     Print JSON to stdout instead of writing file');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.inputPath) {
    throw new Error('Missing required --in <normalized-artifact-path> argument.');
  }

  const normalized = await loadNormalizedYahooArtifactFromFile(args.inputPath);
  const artifact = buildPriceFeatureLabelArtifact(normalized, {
    sourceArtifactPath: args.sourceRef ?? path.resolve(args.inputPath),
    roundTripCostBps: args.costBps,
  });

  if (args.json) {
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  const saved = await persistPriceFeatureLabelArtifact(artifact, args.outputPath);
  console.log('Research price feature/label dataset generated');
  console.log(`Rows: ${artifact.summary.rowCount}`);
  console.log(`Tickers: ${artifact.summary.tickers.length}`);
  console.log(`First date: ${artifact.summary.firstDate ?? 'n/a'}`);
  console.log(`Last date: ${artifact.summary.lastDate ?? 'n/a'}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Research price feature/label build failed: ${message}`);
  process.exit(1);
});
