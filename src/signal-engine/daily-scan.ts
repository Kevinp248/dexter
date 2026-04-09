#!/usr/bin/env bun
import { config } from 'dotenv';
import { logger } from '../utils/logger.js';
import { runDailyScan } from './index.js';

config({ quiet: true });

async function main() {
  const scan = await runDailyScan();
  console.log(JSON.stringify(scan, null, 2));
}

main().catch((error) => {
  logger.error('Daily scan failed', error);
  process.exit(1);
});
