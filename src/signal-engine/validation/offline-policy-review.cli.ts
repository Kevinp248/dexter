#!/usr/bin/env bun
import path from 'node:path';
import {
  buildOfflinePolicyReviewReport,
  persistOfflinePolicyReviewReport,
  type OfflinePolicyReviewConfig,
} from './offline-policy-review.js';

interface CliArgs extends OfflinePolicyReviewConfig {
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
    if (arg === '--extra-file' && argv[i + 1]) {
      out.files = [...(out.files ?? []), argv[i + 1].trim()];
      i += 1;
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      out.outputPath = argv[i + 1].trim();
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
  console.log('Offline policy review (local artifacts only)');
  console.log('');
  console.log('Usage: bun run src/signal-engine/validation/offline-policy-review.cli.ts [options]');
  console.log('');
  console.log('Options:');
  console.log('  --dir, -d <path[,path]>   Directory to scan for JSON artifacts');
  console.log('  --file, -f <path[,path]>  Explicit JSON artifact file(s)');
  console.log('  --extra-file <path>       Optional extra JSON (for example /tmp/parity-aapl-rows.json)');
  console.log('  --out <path>              Output JSON path (default under .dexter/signal-engine/validation/)');
  console.log('  --json                    Print JSON report to stdout instead of persisting');
  console.log('  --help, -h                Show this help');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const report = await buildOfflinePolicyReviewReport({
    directories: args.directories,
    files: args.files,
    outputPath: args.outputPath,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const outPath = await persistOfflinePolicyReviewReport(report, args.outputPath);
  console.log('Offline policy review completed');
  console.log(`Artifacts: ${report.artifacts.length}`);
  console.log(`Replayable rows: ${report.replay.replayableRows}`);
  console.log(
    `Current actions (Set A): BUY=${report.replay.actionCountsCurrent.BUY} SELL=${report.replay.actionCountsCurrent.SELL} HOLD=${report.replay.actionCountsCurrent.HOLD}`,
  );
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`JSON: ${path.relative(process.cwd(), outPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Offline policy review failed: ${message}`);
  process.exit(1);
});
