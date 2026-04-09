#!/usr/bin/env bun
import { config } from 'dotenv';
import { logger } from '../utils/logger.js';
import { runDailyScan } from './index.js';
import { ScanOptions } from './models.js';

config({ quiet: true });

function parseArgs(argv: string[]): ScanOptions {
  const options: ScanOptions = { positions: {} };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tickers' && argv[i + 1]) {
      options.tickers = argv[i + 1]
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (arg === '--position' && argv[i + 1]) {
      // Format: TICKER:long:100 or TICKER:short:50
      const [tickerRaw, sideRaw, qtyRaw] = argv[i + 1].split(':');
      const ticker = tickerRaw?.trim().toUpperCase();
      const side = sideRaw?.trim().toLowerCase();
      const qty = Number(qtyRaw ?? 0);
      if (ticker && (side === 'long' || side === 'short') && Number.isFinite(qty)) {
        const current = options.positions?.[ticker] ?? { longShares: 0, shortShares: 0 };
        if (side === 'long') current.longShares = Math.max(0, qty);
        if (side === 'short') current.shortShares = Math.max(0, qty);
        options.positions![ticker] = current;
      }
      i += 1;
      continue;
    }
  }

  if (options.positions && Object.keys(options.positions).length === 0) {
    delete options.positions;
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scan = await runDailyScan(options);
  console.log(JSON.stringify(scan, null, 2));
}

main().catch((error) => {
  logger.error('Daily scan failed', error);
  process.exit(1);
});
