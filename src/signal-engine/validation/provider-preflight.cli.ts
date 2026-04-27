#!/usr/bin/env bun
import path from 'node:path';
import {
  DEFAULT_SMOKE_MANIFEST_PATH,
  runProviderPreflight,
} from './provider-preflight.js';

type CliArgs = {
  manifestPath: string;
  tickers?: string[];
  asOfDate?: string;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    manifestPath: DEFAULT_SMOKE_MANIFEST_PATH,
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
    if (arg === '--as-of' && argv[i + 1]) {
      out.asOfDate = argv[i + 1];
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
  const report = await runProviderPreflight({
    manifestPath: args.manifestPath,
    tickers: args.tickers,
    asOfDate: args.asOfDate,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Provider preflight completed');
  console.log(`Manifest: ${path.relative(process.cwd(), args.manifestPath)}`);
  console.log(`As-of date: ${report.asOfDate}`);
  console.log(`Tickers: ${report.tickers.join(', ')}`);
  console.log(`Usable price tickers: ${report.usablePriceTickers.length}/${report.tickers.length}`);
  console.log(`Warnings: ${report.warnings.length}`);
  if (report.warnings.length) {
    for (const warning of report.warnings.slice(0, 10)) {
      console.log(`  - ${warning}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Provider preflight failed: ${message}`);
  process.exit(1);
});
