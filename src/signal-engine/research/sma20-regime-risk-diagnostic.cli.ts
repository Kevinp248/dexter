#!/usr/bin/env bun
import path from 'node:path';
import {
  buildSma20RegimeRiskDiagnosticReport,
  loadPriceFeatureArtifactForSma20RegimeRisk,
  persistSma20RegimeRiskDiagnosticReport,
  type Sma20RegimeRiskDiagnosticConfig,
} from './sma20-regime-risk-diagnostic.js';

export interface Sma20RegimeRiskCliArgs extends Sma20RegimeRiskDiagnosticConfig {
  inputPath: string;
  outputPath?: string;
  json: boolean;
  help: boolean;
}

export function parseSma20RegimeRiskCliArgs(argv: string[]): Sma20RegimeRiskCliArgs {
  const out: Sma20RegimeRiskCliArgs = { inputPath: '', json: false, help: false };
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
  console.log('Research-only SMA20 regime/risk diagnostic lane');
  console.log('');
  console.log('Diagnose existing sma20_gap_reversion trades from a local price-feature artifact:');
  console.log(
    '  bun run src/signal-engine/research/sma20-regime-risk-diagnostic.cli.ts --in .dexter/signal-engine/research/price-features/price-features-*.json',
  );
  console.log('');
  console.log('Options:');
  console.log('  --in, --input, --file, -f <path>   Price-feature/label artifact JSON');
  console.log('  --out <path>                       Diagnostic JSON output path');
  console.log('  --json                             Print JSON to stdout instead of writing file');
  console.log('  --help, -h                         Show this help');
}

async function main(): Promise<void> {
  const args = parseSma20RegimeRiskCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.inputPath) throw new Error('Missing required --in <price-feature-artifact-path> argument.');

  const artifact = await loadPriceFeatureArtifactForSma20RegimeRisk(args.inputPath);
  const report = buildSma20RegimeRiskDiagnosticReport(artifact, {
    inputPath: args.inputPath,
    outputPath: args.outputPath,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const saved = await persistSma20RegimeRiskDiagnosticReport(report, args.outputPath);
  console.log('Research SMA20 regime/risk diagnostic completed');
  console.log(`Configs: ${report.configResults.length}`);
  console.log(`Final diagnostic verdict: ${report.finalDiagnosticVerdict}`);
  console.log(`Final recommendation: ${report.finalRecommendation}`);
  console.log(`JSON: ${path.relative(process.cwd(), saved)}`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'sma20-regime-risk-diagnostic.cli.ts') {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Research SMA20 regime/risk diagnostic failed: ${message}`);
    process.exit(1);
  });
}
