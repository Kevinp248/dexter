#!/usr/bin/env bun
import path from 'node:path';
import {
  buildSma20RiskControlReport,
  loadPriceFeatureArtifactForSma20RiskControl,
  persistSma20RiskControlReport,
  validateSma20RiskControlConfig,
  type RiskControlVariantId,
  type Sma20RiskControlConfig,
} from './sma20-risk-control-test.js';

export interface Sma20RiskControlCliArgs extends Sma20RiskControlConfig {
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

function parseVariantList(value: string): RiskControlVariantId[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean) as RiskControlVariantId[];
}

export function parseSma20RiskControlCliArgs(argv: string[]): Sma20RiskControlCliArgs {
  const out: Sma20RiskControlCliArgs = { inputPath: '', json: false, help: false };
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
    if (arg === '--variants' && argv[i + 1]) {
      out.variantIds = parseVariantList(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--min-trades' && argv[i + 1]) {
      out.minTradesForCandidate = parseNumberFlag(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--research-start' && argv[i + 1]) {
      out.researchWindow = { ...(out.researchWindow ?? { endDate: '2024-12-31' }), startDate: argv[i + 1].trim() };
      i += 1;
      continue;
    }
    if (arg === '--research-end' && argv[i + 1]) {
      out.researchWindow = { ...(out.researchWindow ?? { startDate: '2021-01-04' }), endDate: argv[i + 1].trim() };
      i += 1;
      continue;
    }
    if (arg === '--holdout-start' && argv[i + 1]) {
      out.holdoutWindow = { ...(out.holdoutWindow ?? { endDate: '2026-04-24' }), startDate: argv[i + 1].trim() };
      i += 1;
      continue;
    }
    if (arg === '--holdout-end' && argv[i + 1]) {
      out.holdoutWindow = { ...(out.holdoutWindow ?? { startDate: '2025-01-01' }), endDate: argv[i + 1].trim() };
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
  validateSma20RiskControlConfig(out);
  return out;
}

function printHelp(): void {
  console.log('Research-only SMA20 risk-control test lane');
  console.log('');
  console.log('Run SMA20 risk-control variants from a local price-feature artifact:');
  console.log(
    '  bun run src/signal-engine/research/sma20-risk-control-test.cli.ts --in .dexter/signal-engine/research/price-features/price-features-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Price-feature/label artifact JSON');
  console.log('  --out <path>                       Risk-control report JSON output path');
  console.log('  --top-ns <csv>                     Default 4,6');
  console.log('  --cost-bps-values <csv>            Default 0,10,25');
  console.log('  --variants <csv>                   Optional variant id list');
  console.log('  --research-start <YYYY-MM-DD>      Default 2021-01-04');
  console.log('  --research-end <YYYY-MM-DD>        Default 2024-12-31');
  console.log('  --holdout-start <YYYY-MM-DD>       Default 2025-01-01');
  console.log('  --holdout-end <YYYY-MM-DD>         Default 2026-04-24');
  console.log('  --min-trades <number>              Default 20');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseSma20RiskControlCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.inputPath) throw new Error('Missing required --in <price-feature-artifact-path> argument.');

  const artifact = await loadPriceFeatureArtifactForSma20RiskControl(args.inputPath);
  const report = buildSma20RiskControlReport(artifact, {
    inputPath: args.inputPath,
    outputPath: args.outputPath,
    initialCapital: args.initialCapital,
    topNs: args.topNs,
    costBpsValues: args.costBpsValues,
    minTradesForCandidate: args.minTradesForCandidate,
    researchWindow: args.researchWindow,
    holdoutWindow: args.holdoutWindow,
    variantIds: args.variantIds,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistSma20RiskControlReport(report, args.outputPath);
  console.log('Research SMA20 risk-control test completed');
  console.log(`Rows: ${report.rows.length}`);
  console.log(`Holdout verdicts: ${JSON.stringify(report.summary.countByVerdictByWindow.holdout)}`);
  console.log(`Final risk-control verdict: ${report.summary.finalRiskControlVerdict}`);
  console.log(`Final recommendation: ${report.summary.finalRecommendation}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'sma20-risk-control-test.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research SMA20 risk-control test failed: ${message}`);
    process.exit(1);
  });
}
