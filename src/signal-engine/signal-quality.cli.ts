#!/usr/bin/env bun
import { runSignalQualityCli } from './signal-quality.js';

runSignalQualityCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOENT')) {
    console.error(
      'Signal quality failed: paper-trade CSV not found. Create .dexter/signal-engine/paper-trade-log.csv using docs/paper-trade-log-template.md, then retry `bun run quality:signals`.',
    );
  } else {
    console.error(`Signal quality failed: ${message}`);
  }
  process.exit(1);
});
