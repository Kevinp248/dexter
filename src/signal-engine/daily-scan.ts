#!/usr/bin/env bun
import { config } from 'dotenv';
import { logger } from '../utils/logger.js';
import {
  getApiUsageSnapshot,
  resetApiUsageCounters,
  writeApiUsageReport,
} from '../tools/finance/api.js';
import { loadPreviousSignalsByTicker, saveLatestScan } from './history.js';
import { runDailyScan } from './index.js';
import { appendScanAlertsToPaperTradeLog } from './paper-trade-log.js';
import {
  loadPositionContexts,
  loadPositionState,
} from './portfolio-ledger.js';
import { ScanOptions } from './models.js';

config({ quiet: true });

type ParsedCliArgs = {
  scanOptions: ScanOptions;
  appendCsvPath?: string;
};

function parseArgs(argv: string[]): ParsedCliArgs {
  const options: ScanOptions = { positions: {} };
  let appendCsvPath: string | undefined;

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

    if (arg === '--portfolio-value' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) options.portfolioValue = value;
      i += 1;
      continue;
    }

    if (arg === '--gross-exposure' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) {
        options.portfolioContext = options.portfolioContext ?? {};
        options.portfolioContext.grossExposurePct = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--max-gross' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.portfolioContext = options.portfolioContext ?? {};
        options.portfolioContext.maxGrossExposurePct = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--max-sector' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.portfolioContext = options.portfolioContext ?? {};
        options.portfolioContext.maxSectorExposurePct = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--sector-exposure' && argv[i + 1]) {
      const pairs = argv[i + 1].split(',').map((token) => token.trim()).filter(Boolean);
      const map: Record<string, number> = {};
      for (const pair of pairs) {
        const [sector, exposureRaw] = pair.split(':');
        const exposure = Number(exposureRaw);
        if (sector && Number.isFinite(exposure) && exposure >= 0) {
          map[sector] = exposure;
        }
      }
      if (Object.keys(map).length > 0) {
        options.portfolioContext = options.portfolioContext ?? {};
        options.portfolioContext.sectorExposurePct = map;
      }
      i += 1;
      continue;
    }

    if (arg === '--cost-multiplier' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.executionConfig = options.executionConfig ?? {};
        options.executionConfig.costMultiplier = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--min-edge-bps' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) {
        options.executionConfig = options.executionConfig ?? {};
        options.executionConfig.minimumEdgeAfterCostsBps = value;
      }
      i += 1;
      continue;
    }

    if (arg === '--append-csv') {
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        appendCsvPath = argv[i + 1];
        i += 1;
      } else {
        appendCsvPath = '';
      }
      continue;
    }

    if (arg === '--offline-replay') {
      process.env.FINANCIAL_DATASETS_OFFLINE_REPLAY = '1';
      continue;
    }

    if (arg === '--max-api-calls' && argv[i + 1]) {
      process.env.FINANCIAL_DATASETS_MAX_CALLS_PER_RUN = argv[i + 1];
      i += 1;
      continue;
    }
  }

  if (options.positions && Object.keys(options.positions).length === 0) {
    delete options.positions;
  }

  return { scanOptions: options, appendCsvPath };
}

async function main() {
  resetApiUsageCounters();
  const parsed = parseArgs(process.argv.slice(2));
  const cliOptions = parsed.scanOptions;
  const positionStateSnapshot = await loadPositionState();
  const storedPositions = await loadPositionContexts();
  const mergedPositions = {
    ...storedPositions,
    ...(cliOptions.positions ?? {}),
  };
  const options: ScanOptions = {
    ...cliOptions,
    positions: Object.keys(mergedPositions).length ? mergedPositions : undefined,
    positionStatesByTicker: positionStateSnapshot?.positions ?? undefined,
  };
  options.previousSignalsByTicker = await loadPreviousSignalsByTicker();
  const scan = await runDailyScan(options);
  await saveLatestScan(scan);
  if (parsed.appendCsvPath !== undefined) {
    const appendResult = await appendScanAlertsToPaperTradeLog(
      scan,
      parsed.appendCsvPath || undefined,
    );
    logger.info(
      `Paper trade CSV update: appended ${appendResult.rowsAppended}, skipped ${appendResult.rowsSkipped} duplicate day/ticker row(s) at ${appendResult.path}`,
    );
  }
  const usageLabel = `scan-${new Date().toISOString().slice(0, 10)}`;
  const usagePath = writeApiUsageReport(usageLabel);
  const usage = getApiUsageSnapshot();
  logger.info(
    `API usage this run: ${usage.totalCalls} calls. Report: ${usagePath}`,
  );
  console.log(JSON.stringify(scan, null, 2));
}

main().catch((error) => {
  logger.error('Daily scan failed', error);
  process.exit(1);
});
