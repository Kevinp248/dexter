#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  fetchYahooHistoryToCache,
  persistYahooRawArtifact,
  type YahooHistoryFetchConfig,
} from './yahoo-history-fetch.js';
import {
  normalizeYahooRawArtifact,
  persistYahooNormalizedArtifact,
} from './yahoo-normalize.js';

type CliArgs = {
  tickers: string[];
  startDate: string;
  endDate: string;
  cacheDir?: string;
  out?: string;
  normalizeOut?: string;
  normalizeFrom?: string;
  useCache: boolean;
  forceRefresh: boolean;
  json: boolean;
  help: boolean;
};

function parseTickers(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    tickers: [],
    startDate: '',
    endDate: '',
    useCache: true,
    forceRefresh: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--tickers' || arg === '-t') && argv[i + 1]) {
      out.tickers = parseTickers(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--start' && argv[i + 1]) {
      out.startDate = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--end' && argv[i + 1]) {
      out.endDate = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--cache-dir' && argv[i + 1]) {
      out.cacheDir = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--out' && argv[i + 1]) {
      out.out = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--normalize-out' && argv[i + 1]) {
      out.normalizeOut = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--normalize-from' && argv[i + 1]) {
      out.normalizeFrom = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === '--no-cache') {
      out.useCache = false;
      continue;
    }
    if (arg === '--force-refresh') {
      out.forceRefresh = true;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    }
  }

  return out;
}

function printHelp(): void {
  console.log('Research-only Yahoo daily OHLCV lane');
  console.log('');
  console.log('Fetch/cache raw daily OHLCV (research-only):');
  console.log('  bun run src/signal-engine/research/yahoo-history.cli.ts --tickers AAPL,MSFT --start 2025-01-01 --end 2025-12-31');
  console.log('');
  console.log('Normalize from saved raw artifact:');
  console.log('  bun run src/signal-engine/research/yahoo-history.cli.ts --normalize-from .dexter/signal-engine/research/yahoo/raw/yahoo-history-*.json');
  console.log('');
  console.log('Options:');
  console.log('  --tickers, -t <csv>');
  console.log('  --start YYYY-MM-DD');
  console.log('  --end YYYY-MM-DD');
  console.log('  --cache-dir <path>');
  console.log('  --out <path>                 Raw artifact output path');
  console.log('  --normalize-out <path>       Normalized artifact output path');
  console.log('  --normalize-from <path>      Normalize an existing raw artifact and exit');
  console.log('  --no-cache                   Ignore cache reads');
  console.log('  --force-refresh              Refresh cache from Yahoo');
  console.log('  --json                       Print artifact JSON to stdout');
}

async function runNormalizeFromFile(args: CliArgs): Promise<void> {
  const rawPath = path.resolve(args.normalizeFrom as string);
  const raw = JSON.parse(await readFile(rawPath, 'utf8'));
  const normalized = normalizeYahooRawArtifact(raw);
  if (args.json) {
    console.log(JSON.stringify(normalized, null, 2));
    return;
  }
  const outPath = await persistYahooNormalizedArtifact(normalized, args.normalizeOut);
  console.log('Yahoo normalized artifact generated');
  console.log(`Rows: ${normalized.rows.length}`);
  console.log(`Tickers: ${normalized.tickerSummaries.length}`);
  console.log(`JSON: ${path.relative(process.cwd(), outPath)}`);
}

async function runFetchAndNormalize(args: CliArgs): Promise<void> {
  if (!args.tickers.length || !args.startDate || !args.endDate) {
    throw new Error('Fetch mode requires --tickers, --start, and --end');
  }

  const fetchConfig: YahooHistoryFetchConfig = {
    tickers: args.tickers,
    startDate: args.startDate,
    endDate: args.endDate,
    interval: '1d',
    cacheDir: args.cacheDir,
    useCache: args.useCache,
    forceRefresh: args.forceRefresh,
  };

  const rawArtifact = await fetchYahooHistoryToCache(fetchConfig);
  const normalized = normalizeYahooRawArtifact(rawArtifact);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          rawArtifact,
          normalized,
        },
        null,
        2,
      ),
    );
    return;
  }

  const rawPath = await persistYahooRawArtifact(rawArtifact, args.out);
  const normalizedPath = await persistYahooNormalizedArtifact(normalized, args.normalizeOut);

  console.log('Yahoo research fetch completed');
  console.log(`Raw tickers: ${rawArtifact.tickers.length}`);
  console.log(`Normalized rows: ${normalized.rows.length}`);
  console.log(`Raw JSON: ${path.relative(process.cwd(), rawPath)}`);
  console.log(`Normalized JSON: ${path.relative(process.cwd(), normalizedPath)}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.normalizeFrom) {
    await runNormalizeFromFile(args);
    return;
  }

  await runFetchAndNormalize(args);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Yahoo research lane failed: ${message}`);
  process.exit(1);
});
