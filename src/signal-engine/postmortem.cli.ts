#!/usr/bin/env bun
import path from 'node:path';
import { loadPositionState } from './portfolio-ledger.js';
import {
  generatePostmortemIncidents,
  loadLatestScan,
  loadPaperTradeRows,
  persistPostmortemIncidents,
} from './postmortem.js';

type CliArgs = {
  scanPath: string;
  logPath: string;
  outPath?: string;
  includeResearch: boolean;
  lossThresholdPct: number;
  divergenceThresholdBps: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    scanPath: path.join(process.cwd(), '.dexter', 'signal-engine', 'last-scan.json'),
    logPath: path.join(process.cwd(), '.dexter', 'signal-engine', 'paper-trade-log.csv'),
    includeResearch: false,
    lossThresholdPct: -2,
    divergenceThresholdBps: 150,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--scan' || arg === '-s') && argv[i + 1]) {
      args.scanPath = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === '--log' || arg === '-l') && argv[i + 1]) {
      args.logPath = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === '--out' || arg === '-o') && argv[i + 1]) {
      args.outPath = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--with-research') {
      args.includeResearch = true;
      continue;
    }
    if (arg === '--loss-threshold' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value < 0) args.lossThresholdPct = value;
      i += 1;
      continue;
    }
    if (arg === '--divergence-bps' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.divergenceThresholdBps = value;
      i += 1;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scan = await loadLatestScan(args.scanPath);
  const rows = await loadPaperTradeRows(args.logPath);
  const positionState = await loadPositionState();
  const incidents = await generatePostmortemIncidents(rows, scan, positionState, {
    includeResearch: args.includeResearch,
    lossThresholdPct: args.lossThresholdPct,
    divergenceThresholdBps: args.divergenceThresholdBps,
  });
  const persisted = await persistPostmortemIncidents(incidents, args.outPath);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        incidentsGenerated: incidents.length,
        persistedPath: persisted.path,
        rowsWritten: persisted.rowsWritten,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Postmortem run failed: ${message}`);
  process.exit(1);
});
