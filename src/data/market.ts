import { api } from '../tools/finance/api.js';
import { TTL_15M, TTL_1H, TTL_24H } from '../tools/finance/utils.js';
import { readCache, writeCache } from '../utils/cache.js';

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
}

export interface MarketDataRange {
  startDate?: string;
  endDate?: string;
  asOfDate?: string;
}

export type PriceProviderRouting = 'paid_api' | 'cache_yahoo_paid_fallback';

export interface PriceFetchStats {
  cacheHits: number;
  cacheMisses: number;
  yahooCalls: number;
  paidApiCalls: number;
}

const priceFetchStats: PriceFetchStats = {
  cacheHits: 0,
  cacheMisses: 0,
  yahooCalls: 0,
  paidApiCalls: 0,
};

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isDateInPast(date?: string): boolean {
  if (!date) return false;
  const normalized = date.slice(0, 10);
  const today = formatDate(new Date());
  return normalized < today;
}

function offlineReplayEnabled(): boolean {
  const value = (process.env.FINANCIAL_DATASETS_OFFLINE_REPLAY ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function isFinitePriceBar(bar: PriceBar): boolean {
  return (
    Boolean(bar.date) &&
    Number.isFinite(bar.open) &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    Number.isFinite(bar.close) &&
    Number.isFinite(bar.adjustedClose) &&
    Number.isFinite(bar.volume)
  );
}

const AVAILABILITY_KEYS = [
  'available_date',
  'available_at',
  'accepted_date',
  'accepted_at',
  'publish_date',
  'published_at',
  'filed_date',
  'filing_date',
] as const;

function toDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function extractAvailabilityDate(record: Record<string, unknown>): string | null {
  for (const key of AVAILABILITY_KEYS) {
    const parsed = toDateOnly(record[key]);
    if (parsed) return parsed;
  }
  return null;
}

function annotateAvailability<T extends Record<string, unknown>>(
  row: T,
  asOfDate?: string,
): T | null {
  if (!asOfDate) return row;
  const availabilityDate = extractAvailabilityDate(row);
  if (availabilityDate && availabilityDate > asOfDate) {
    return null;
  }
  if (!availabilityDate) {
    return {
      ...row,
      __pitMissingAvailability: true,
    };
  }
  return row;
}

function toEpochSeconds(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 1000);
}

function fromEpochSeconds(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export function resetPriceFetchStats(): void {
  priceFetchStats.cacheHits = 0;
  priceFetchStats.cacheMisses = 0;
  priceFetchStats.yahooCalls = 0;
  priceFetchStats.paidApiCalls = 0;
}

export function getPriceFetchStats(): PriceFetchStats {
  return { ...priceFetchStats };
}

async function safeApi<T>(call: () => Promise<T>, fallback: T, label: string): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = message.includes('429');
      const isPaymentRequired = message.includes('402');
      if (isRateLimit && attempt < maxAttempts) {
        const backoffMs = 300 * 2 ** (attempt - 1) + Math.floor(Math.random() * 120);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      if (isPaymentRequired) {
        console.warn(
          `[market:${label}] provider returned 402 Payment Required. ` +
            'Check FINANCIAL_DATASETS_API_KEY plan/credits, endpoint access scope, or switch data provider.',
        );
      }
      console.warn(`[market:${label}] ${error}`);
      return fallback;
    }
  }
  return fallback;
}

export async function fetchHistoricalPrices(
  ticker: string,
  intervalDays = 40,
  range: MarketDataRange = {},
): Promise<PriceBar[]> {
  const endDate = range.endDate
    ? new Date(range.endDate)
    : range.asOfDate
      ? new Date(range.asOfDate)
      : new Date();
  const startDate = range.startDate
    ? new Date(range.startDate)
    : new Date(endDate);
  if (!range.startDate) {
    startDate.setDate(endDate.getDate() - intervalDays);
  }

  const endDateStr = formatDate(endDate);
  const isHistoricalWindow = isDateInPast(endDateStr);
  priceFetchStats.paidApiCalls += 1;
  return safeApi(async () => {
    const { data } = await api.get(
      '/prices/',
      {
        ticker: ticker.toUpperCase(),
        interval: 'day',
        start_date: formatDate(startDate),
        end_date: endDateStr,
      },
      { cacheable: true, ttlMs: isHistoricalWindow ? TTL_24H : TTL_1H },
    );

    const rawBars = Array.isArray(data.prices) ? data.prices : [];
    return rawBars
      .map((row) => ({
        // FinancialDatasets can return `time` instead of `date` for price bars.
        date: String(row.date ?? row.time ?? row.period ?? ''),
        open: Number(row.open ?? row.price_open ?? 0),
        high: Number(row.high ?? row.price_high ?? 0),
        low: Number(row.low ?? row.price_low ?? 0),
        close: Number(row.close ?? row.price_close ?? row.price ?? 0),
        adjustedClose: Number(
          row.adjusted_close ?? row.adj_close ?? row.close ?? row.price_close ?? row.price ?? 0,
        ),
        volume: Number(row.volume ?? 0),
      }))
      .filter((bar): bar is PriceBar => Boolean(bar.date))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }, [], 'fetchHistoricalPrices');
}

export async function fetchHistoricalPricesFromYahoo(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<PriceBar[]> {
  const endpoint = '/prices-yahoo/';
  const params = {
    ticker: ticker.toUpperCase(),
    interval: '1d',
    start_date: startDate,
    end_date: endDate,
  };
  const cached = readCache(endpoint, params, TTL_24H);
  if (cached) {
    priceFetchStats.cacheHits += 1;
    const cachedBars = Array.isArray(cached.data.prices) ? cached.data.prices : [];
    return cachedBars
      .map((row) => ({
        date: String((row as Record<string, unknown>).date ?? ''),
        open: Number((row as Record<string, unknown>).open ?? 0),
        high: Number((row as Record<string, unknown>).high ?? 0),
        low: Number((row as Record<string, unknown>).low ?? 0),
        close: Number((row as Record<string, unknown>).close ?? 0),
        adjustedClose: Number(
          (row as Record<string, unknown>).adjustedClose ??
            (row as Record<string, unknown>).adjusted_close ??
            (row as Record<string, unknown>).adj_close ??
            (row as Record<string, unknown>).close ??
            0,
        ),
        volume: Number((row as Record<string, unknown>).volume ?? 0),
      }))
      .filter(isFinitePriceBar);
  }

  priceFetchStats.cacheMisses += 1;
  if (offlineReplayEnabled()) {
    throw new Error(
      `[market:yahoo] offline replay enabled and cache miss for ${ticker} ${startDate} -> ${endDate}`,
    );
  }

  const period1 = toEpochSeconds(startDate);
  const period2 = toEpochSeconds(endDate) + 86_400;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}`);
  url.searchParams.set('period1', String(period1));
  url.searchParams.set('period2', String(period2));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'history');
  url.searchParams.set('includeAdjustedClose', 'true');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`[market:yahoo] request failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const chart = payload.chart as Record<string, unknown> | undefined;
  const result = Array.isArray(chart?.result)
    ? (chart?.result?.[0] as Record<string, unknown> | undefined)
    : undefined;
  const timestamps = Array.isArray(result?.timestamp) ? result?.timestamp : [];
  const quote = Array.isArray((result?.indicators as Record<string, unknown> | undefined)?.quote)
    ? (((result?.indicators as Record<string, unknown>).quote as unknown[])[0] as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const opens = Array.isArray(quote?.open) ? quote?.open : [];
  const highs = Array.isArray(quote?.high) ? quote?.high : [];
  const lows = Array.isArray(quote?.low) ? quote?.low : [];
  const closes = Array.isArray(quote?.close) ? quote?.close : [];
  const volumes = Array.isArray(quote?.volume) ? quote?.volume : [];
  const adj = Array.isArray(
    ((result?.indicators as Record<string, unknown> | undefined)?.adjclose as
      | Array<Record<string, unknown>>
      | undefined)?.[0]?.adjclose,
  )
    ? ((((result?.indicators as Record<string, unknown>).adjclose as Array<Record<string, unknown>>)[0]
        .adjclose as unknown[]) ?? [])
    : [];

  const bars: PriceBar[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = Number(timestamps[i]);
    const close = Number(closes[i]);
    if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
    const open = Number(opens[i]);
    const high = Number(highs[i]);
    const low = Number(lows[i]);
    const volume = Number(volumes[i]);
    const adjustedClose = Number(adj[i]);
    bars.push({
      date: fromEpochSeconds(ts),
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      adjustedClose: Number.isFinite(adjustedClose) ? adjustedClose : close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  const normalized = bars.filter(isFinitePriceBar).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  writeCache(endpoint, params, { prices: normalized }, url.toString());
  priceFetchStats.yahooCalls += 1;
  return normalized;
}

export async function fetchHistoricalPricesRouted(
  ticker: string,
  startDate: string,
  endDate: string,
  provider: PriceProviderRouting,
): Promise<PriceBar[]> {
  if (provider === 'paid_api') {
    return fetchHistoricalPrices(ticker, 420, { startDate, endDate });
  }
  try {
    const yahooBars = await fetchHistoricalPricesFromYahoo(ticker, startDate, endDate);
    if (yahooBars.length > 0) return yahooBars;
  } catch (error) {
    console.warn(`[market:routing] yahoo provider failed for ${ticker}: ${error}`);
  }
  return fetchHistoricalPrices(ticker, 420, { startDate, endDate });
}

export async function fetchKeyRatios(
  ticker: string,
  range: MarketDataRange = {},
): Promise<Record<string, unknown>> {
  const asOf = range.asOfDate ?? range.endDate;
  const isHistoricalSnapshot = isDateInPast(asOf);
  return safeApi(async () => {
    const { data } = await api.get('/financial-metrics/snapshot/', {
      ticker: ticker.toUpperCase(),
      as_of: asOf,
      report_period_lte: asOf,
    }, { cacheable: true, ttlMs: isHistoricalSnapshot ? TTL_24H : TTL_1H });
    const snapshot = ((data.snapshot as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
    const annotated = annotateAvailability(snapshot, asOf);
    return annotated ?? {};
  }, {}, 'fetchKeyRatios');
}

export async function fetchCashFlowStatements(
  ticker: string,
  limit = 8,
  range: MarketDataRange = {},
): Promise<Array<Record<string, unknown>>> {
  const asOf = range.asOfDate ?? range.endDate;
  const isHistoricalSnapshot = isDateInPast(asOf);
  return safeApi(async () => {
    const { data } = await api.get('/financials/cash-flow-statements/', {
      ticker: ticker.toUpperCase(),
      period: 'ttm',
      limit,
      report_period_lte: asOf,
      as_of: asOf,
    }, { cacheable: true, ttlMs: isHistoricalSnapshot ? TTL_24H : TTL_1H });
    const rows = (data.cash_flow_statements as Array<Record<string, unknown>>) ?? [];
    return rows
      .map((row) => annotateAvailability(row, asOf))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }, [], 'fetchCashFlowStatements');
}

export async function fetchIncomeStatements(
  ticker: string,
  limit = 8,
  range: MarketDataRange = {},
): Promise<Array<Record<string, unknown>>> {
  const asOf = range.asOfDate ?? range.endDate;
  const isHistoricalSnapshot = isDateInPast(asOf);
  return safeApi(async () => {
    const { data } = await api.get('/financials/income-statements/', {
      ticker: ticker.toUpperCase(),
      period: 'ttm',
      limit,
      report_period_lte: asOf,
      as_of: asOf,
    }, { cacheable: true, ttlMs: isHistoricalSnapshot ? TTL_24H : TTL_1H });
    const rows = (data.income_statements as Array<Record<string, unknown>>) ?? [];
    return rows
      .map((row) => annotateAvailability(row, asOf))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }, [], 'fetchIncomeStatements');
}

export async function fetchCompanyNews(
  ticker: string,
  limit = 5,
  range: MarketDataRange = {},
): Promise<Array<Record<string, unknown>>> {
  const endDate = range.endDate ?? range.asOfDate;
  const asOf = range.asOfDate ?? range.endDate;
  const isHistoricalWindow = isDateInPast(endDate);
  return safeApi(async () => {
    const { data } = await api.get('/news', {
      ticker: ticker.toUpperCase(),
      limit: Math.min(limit, 10),
      end_date: endDate,
      start_date: range.startDate,
    }, { cacheable: true, ttlMs: isHistoricalWindow ? TTL_24H : TTL_15M });
    const rows = (data.news as Array<Record<string, unknown>>) ?? [];
    return rows
      .map((row) => annotateAvailability(row, asOf))
      .filter((row): row is Record<string, unknown> => Boolean(row));
  }, [], 'fetchCompanyNews');
}

function pickUpcomingDateFromRow(row: Record<string, unknown>): string | null {
  const candidates = [
    row.earnings_date,
    row.next_earnings_date,
    row.date,
    row.report_date,
    row.release_date,
  ];
  for (const candidate of candidates) {
    const parsed = toDateOnly(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export async function fetchUpcomingEarningsDate(
  ticker: string,
  asOfDate?: string,
): Promise<string | null> {
  const asOf = asOfDate?.slice(0, 10);
  const isHistoricalSnapshot = isDateInPast(asOf);
  return safeApi(async () => {
    const { data } = await api.get(
      '/earnings-calendar/',
      {
        ticker: ticker.toUpperCase(),
        limit: 6,
        date_gte: asOf,
      },
      { cacheable: true, ttlMs: isHistoricalSnapshot ? TTL_24H : TTL_1H },
    );
    const rows = (data.earnings as Array<Record<string, unknown>>) ?? [];
    const dates = rows
      .map((row) => pickUpcomingDateFromRow(row))
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    if (!dates.length) return null;
    if (!asOf) return dates[0];
    return dates.find((date) => date >= asOf) ?? null;
  }, null, 'fetchUpcomingEarningsDate');
}
