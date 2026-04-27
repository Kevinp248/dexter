#!/usr/bin/env bun
import path from 'node:path';
import {
  buildMultiTickerEvidenceReport,
  loadMultiTickerSeparationReportFromFile,
  persistMultiTickerEvidenceReport,
  type BuildEvidenceReportOptions,
} from './multiticker-evidence-report.js';

export interface EvidenceReportCliArgs extends BuildEvidenceReportOptions {
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

export function parseEvidenceReportCliArgs(argv: string[]): EvidenceReportCliArgs {
  const out: EvidenceReportCliArgs = {
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
    if (arg === '--agreement-threshold' && argv[i + 1]) {
      out.thresholds = {
        ...out.thresholds,
        broadAgreementRatio: parseNumberFlag(arg, argv[i + 1]),
      };
      i += 1;
      continue;
    }
    if (arg === '--min-stable-tickers' && argv[i + 1]) {
      out.thresholds = {
        ...out.thresholds,
        minimumStableTickerCount: parseNumberFlag(arg, argv[i + 1]),
      };
      i += 1;
      continue;
    }
    if (arg === '--non-trivial-spread' && argv[i + 1]) {
      out.thresholds = {
        ...out.thresholds,
        nonTrivialPooledSpread: parseNumberFlag(arg, argv[i + 1]),
      };
      i += 1;
      continue;
    }
    if (arg === '--very-small-spread' && argv[i + 1]) {
      out.thresholds = {
        ...out.thresholds,
        verySmallPooledSpread: parseNumberFlag(arg, argv[i + 1]),
      };
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
  console.log('Research-only multi-ticker evidence report');
  console.log('');
  console.log('Build deterministic evidence gates from a multi-ticker separation artifact:');
  console.log(
    '  bun run src/signal-engine/research/multiticker-evidence-report.cli.ts --in .dexter/signal-engine/research/analysis/multiticker-separation-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Multi-ticker separation JSON artifact');
  console.log('  --out <path>                       Evidence report JSON output path');
  console.log('  --agreement-threshold <number>     Default 0.75');
  console.log('  --min-stable-tickers <number>      Default 5');
  console.log('  --non-trivial-spread <number>      Default 0.002');
  console.log('  --very-small-spread <number>       Default 0.002');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseEvidenceReportCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.inputPath) {
    throw new Error('Missing required --in <multiticker-separation-artifact-path> argument.');
  }

  const source = await loadMultiTickerSeparationReportFromFile(args.inputPath);
  const report = buildMultiTickerEvidenceReport(source, {
    sourceArtifactPath: args.inputPath,
    thresholds: args.thresholds,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistMultiTickerEvidenceReport(report, args.outputPath);
  console.log('Research multi-ticker evidence report generated');
  console.log(`Feature/horizons: ${report.summary.totalFeatureHorizons}`);
  console.log(`Recommendation: ${report.summary.finalRecommendation}`);
  console.log(`Classifications: ${JSON.stringify(report.summary.countByClassification)}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'multiticker-evidence-report.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research multi-ticker evidence report failed: ${message}`);
    process.exit(1);
  });
}
