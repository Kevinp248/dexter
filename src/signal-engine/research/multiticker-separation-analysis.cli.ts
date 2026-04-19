#!/usr/bin/env bun
import path from 'node:path';
import {
  buildMultiTickerSeparationReport,
  persistMultiTickerSeparationReport,
  type MultiTickerSeparationConfig,
} from './multiticker-separation-analysis.js';

interface CliArgs extends MultiTickerSeparationConfig {
  json: boolean;
  help: boolean;
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    directories: undefined,
    files: undefined,
    outputPath: undefined,
    weakSpreadThreshold: undefined,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--dir' || arg === '-d') && argv[i + 1]) {
      out.directories = [...(out.directories ?? []), ...parseList(argv[i + 1])];
      i += 1;
      continue;
    }
    if ((arg === '--file' || arg === '-f') && argv[i + 1]) {
      out.files = [...(out.files ?? []), ...parseList(argv[i + 1])];
      i += 1;
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      out.outputPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--weak-spread-threshold' && argv[i + 1]) {
      out.weakSpreadThreshold = Number(argv[i + 1]);
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
  console.log('Research-only multi-ticker price-feature separation analysis');
  console.log('');
  console.log('Usage: bun run src/signal-engine/research/multiticker-separation-analysis.cli.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --dir, -d <path[,path]>      Directory with price-feature dataset JSON files');
  console.log('  --file, -f <path[,path]>     Explicit price-feature dataset JSON file(s)');
  console.log('  --out <path>                 Output JSON path (default under .dexter/signal-engine/research/analysis/)');
  console.log('  --weak-spread-threshold <n>  Absolute spread threshold for weak/noisy flagging (default 0.002)');
  console.log('  --json                       Print JSON report to stdout instead of persisting');
  console.log('  --help, -h                   Show this help');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = await buildMultiTickerSeparationReport({
    directories: args.directories,
    files: args.files,
    outputPath: args.outputPath,
    weakSpreadThreshold: args.weakSpreadThreshold,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const outPath = await persistMultiTickerSeparationReport(report, args.outputPath);
  console.log('Research multi-ticker separation analysis completed');
  console.log(`Datasets loaded: ${report.datasetCoverage.datasetsLoaded}`);
  console.log(`Tickers: ${report.datasetCoverage.tickers.join(', ') || 'none'}`);
  console.log(`Rows: ${report.datasetCoverage.totalRows}`);
  console.log(`Instability flags: ${report.instabilityFlags.length}`);
  console.log(`JSON: ${path.relative(process.cwd(), outPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Research multi-ticker separation analysis failed: ${message}`);
  process.exit(1);
});
