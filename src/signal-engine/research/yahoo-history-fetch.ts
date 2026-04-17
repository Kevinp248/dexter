import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type YahooTickerFetchStatus = 'success' | 'empty' | 'error';

export interface YahooHistoryFetchConfig {
  tickers: string[];
  startDate: string;
  endDate: string;
  interval?: '1d';
  cacheDir?: string;
  outputPath?: string;
  useCache?: boolean;
  forceRefresh?: boolean;
}

export interface YahooFetchRequestedParams {
  startDate: string;
  endDate: string;
  interval: '1d';
  includeAdjustedClose: boolean;
}

export interface YahooRawTickerResult {
  ticker: string;
  status: YahooTickerFetchStatus;
  source: 'cache' | 'network' | 'none';
  cachePath: string;
  fetchedAt: string;
  response: unknown | null;
  warning: string | null;
}

export interface YahooRawHistoryArtifact {
  vendor: 'yahoo';
  lane: 'research_only';
  assembledAt?: string;
  sourceFetchedAtMin?: string | null;
  sourceFetchedAtMax?: string | null;
  // Backward compatibility alias for older consumers; equals assembledAt in new artifacts.
  fetchedAt: string;
  requested: YahooFetchRequestedParams;
  tickers: YahooRawTickerResult[];
  warnings: string[];
}

interface YahooPerTickerCacheEnvelope {
  vendor: 'yahoo';
  ticker: string;
  requested: YahooFetchRequestedParams;
  fetchedAt: string;
  response: unknown;
}

export interface YahooHistoryFetchDeps {
  fetchFn?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
  }>;
  nowFn?: () => Date;
}

const DEFAULT_CACHE_DIR = path.join(
  process.cwd(),
  '.dexter',
  'signal-engine',
  'research',
  'yahoo',
  'raw',
);

function asDateOnly(value: string): string {
  return value.slice(0, 10);
}

function normalizeTickers(tickers: string[]): string[] {
  return Array.from(
    new Set(
      tickers
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function parseDateUtc(date: string): Date {
  const normalized = asDateOnly(date);
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  return parsed;
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function buildYahooUrl(ticker: string, requested: YahooFetchRequestedParams): string {
  const start = parseDateUtc(requested.startDate);
  const endExclusive = parseDateUtc(requested.endDate);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const params = new URLSearchParams({
    period1: String(epochSeconds(start)),
    period2: String(epochSeconds(endExclusive)),
    interval: requested.interval,
    events: 'history',
    includeAdjustedClose: requested.includeAdjustedClose ? 'true' : 'false',
  });

  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`;
}

function buildCachePath(
  cacheDir: string,
  ticker: string,
  requested: YahooFetchRequestedParams,
): string {
  return path.join(
    cacheDir,
    `${ticker}-${requested.startDate}-${requested.endDate}-${requested.interval}.json`,
  );
}

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isCacheEnvelope(value: unknown): value is YahooPerTickerCacheEnvelope {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.vendor === 'yahoo' &&
    typeof rec.ticker === 'string' &&
    typeof rec.fetchedAt === 'string' &&
    rec.requested !== null &&
    typeof rec.requested === 'object' &&
    Object.prototype.hasOwnProperty.call(rec, 'response')
  );
}

function hasYahooRows(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const chart = (payload as Record<string, unknown>).chart;
  if (!chart || typeof chart !== 'object') return false;
  const result = (chart as Record<string, unknown>).result;
  if (!Array.isArray(result) || result.length === 0) return false;
  const first = result[0];
  if (!first || typeof first !== 'object') return false;
  const timestamp = (first as Record<string, unknown>).timestamp;
  return Array.isArray(timestamp) && timestamp.length > 0;
}

function isIsoDateTime(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function computeSourceFetchRange(tickers: YahooRawTickerResult[]): {
  min: string | null;
  max: string | null;
} {
  const valid = tickers
    .map((ticker) => ticker.fetchedAt)
    .filter((value) => typeof value === 'string' && isIsoDateTime(value))
    .sort((a, b) => a.localeCompare(b));
  if (!valid.length) return { min: null, max: null };
  return { min: valid[0], max: valid[valid.length - 1] };
}

export async function fetchYahooHistoryToCache(
  config: YahooHistoryFetchConfig,
  deps: YahooHistoryFetchDeps = {},
): Promise<YahooRawHistoryArtifact> {
  const tickers = normalizeTickers(config.tickers);
  if (!tickers.length) {
    throw new Error('At least one ticker is required.');
  }

  const requested: YahooFetchRequestedParams = {
    startDate: asDateOnly(config.startDate),
    endDate: asDateOnly(config.endDate),
    interval: config.interval ?? '1d',
    includeAdjustedClose: true,
  };
  if (parseDateUtc(requested.startDate) > parseDateUtc(requested.endDate)) {
    throw new Error('startDate must be <= endDate');
  }

  const now = deps.nowFn ?? (() => new Date());
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as YahooHistoryFetchDeps['fetchFn']);
  if (!fetchFn) {
    throw new Error('No fetch implementation available.');
  }
  const cacheDir = path.resolve(config.cacheDir ?? DEFAULT_CACHE_DIR);
  const useCache = config.useCache ?? true;
  const forceRefresh = config.forceRefresh ?? false;
  await mkdir(cacheDir, { recursive: true });

  const warnings: string[] = [];
  const out: YahooRawTickerResult[] = [];

  for (const ticker of tickers) {
    const cachePath = buildCachePath(cacheDir, ticker, requested);
    const fetchedAtNow = now().toISOString();

    if (useCache && !forceRefresh) {
      const cached = await readJsonIfExists(cachePath);
      if (cached !== null) {
        const isEnvelope = isCacheEnvelope(cached);
        const cachedResponse = isEnvelope ? cached.response : cached;
        const cacheFetchedAt = isEnvelope ? cached.fetchedAt : fetchedAtNow;
        const envelopeWarning =
          isEnvelope
            ? null
            : `Legacy cache payload detected for ${ticker}; original fetchedAt unavailable.`;
        if (envelopeWarning) warnings.push(envelopeWarning);
        const rowWarning = hasYahooRows(cachedResponse)
          ? envelopeWarning
          : `Cached response for ${ticker} contains no daily rows.${envelopeWarning ? ` ${envelopeWarning}` : ''}`;
        out.push({
          ticker,
          status: hasYahooRows(cachedResponse) ? 'success' : 'empty',
          source: 'cache',
          cachePath,
          fetchedAt: cacheFetchedAt,
          response: cachedResponse,
          warning: rowWarning,
        });
        continue;
      }
    }

    const url = buildYahooUrl(ticker, requested);
    try {
      const response = await fetchFn(url);
      const text = await response.text();
      if (!response.ok) {
        const warning = `Yahoo request failed for ${ticker} with HTTP ${response.status}.`;
        warnings.push(warning);
        out.push({
          ticker,
          status: 'error',
          source: 'network',
          cachePath,
          fetchedAt: fetchedAtNow,
          response: text ? { errorText: text } : null,
          warning,
        });
        continue;
      }

      const json = JSON.parse(text) as unknown;
      const envelope: YahooPerTickerCacheEnvelope = {
        vendor: 'yahoo',
        ticker,
        requested,
        fetchedAt: fetchedAtNow,
        response: json,
      };
      await writeFile(cachePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
      const hasRows = hasYahooRows(json);
      const warning = hasRows ? null : `Yahoo returned no daily rows for ${ticker}.`;
      if (warning) warnings.push(warning);
      out.push({
        ticker,
        status: hasRows ? 'success' : 'empty',
        source: 'network',
        cachePath,
        fetchedAt: fetchedAtNow,
        response: json,
        warning,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const warning = `Yahoo request error for ${ticker}: ${message}`;
      warnings.push(warning);
      out.push({
        ticker,
        status: 'error',
        source: 'network',
        cachePath,
        fetchedAt: fetchedAtNow,
        response: null,
        warning,
      });
    }
  }

  const assembledAt = now().toISOString();
  const sourceRange = computeSourceFetchRange(out);
  return {
    vendor: 'yahoo',
    lane: 'research_only',
    assembledAt,
    sourceFetchedAtMin: sourceRange.min,
    sourceFetchedAtMax: sourceRange.max,
    fetchedAt: assembledAt,
    requested,
    tickers: out,
    warnings: Array.from(new Set(warnings)).sort((a, b) => a.localeCompare(b)),
  };
}

function defaultRawOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'research',
    'yahoo',
    'raw',
    `yahoo-history-${stamp}.json`,
  );
}

export async function persistYahooRawArtifact(
  artifact: YahooRawHistoryArtifact,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultRawOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return target;
}
