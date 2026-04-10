#!/usr/bin/env bun
import { runBlockerAnalyticsCli } from './blocker-analytics.js';

runBlockerAnalyticsCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Blocker analytics failed: ${message}`);
  process.exit(1);
});
