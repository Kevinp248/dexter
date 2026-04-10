import { api } from '../tools/finance/api.js';
import { TTL_15M, TTL_1H, TTL_24H } from '../tools/finance/utils.js';

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataRange {
  startDate?: string;
  endDate?: string;
  asOfDate?: string;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function isDateInPast(date?: string): boolean {
  if (!date) return false;
  const normalized = date.slice(0, 10);
  const today = formatDate(new Date());
  return normalized < today;
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
        volume: Number(row.volume ?? 0),
      }))
      .filter((bar): bar is PriceBar => Boolean(bar.date))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }, [], 'fetchHistoricalPrices');
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
    return (data.snapshot as Record<string, unknown>) ?? {};
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
    return (data.cash_flow_statements as Array<Record<string, unknown>>) ?? [];
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
    return (data.income_statements as Array<Record<string, unknown>>) ?? [];
  }, [], 'fetchIncomeStatements');
}

export async function fetchCompanyNews(
  ticker: string,
  limit = 5,
  range: MarketDataRange = {},
): Promise<Array<{ title?: string; url?: string; published_at?: string }>> {
  const endDate = range.endDate ?? range.asOfDate;
  const isHistoricalWindow = isDateInPast(endDate);
  return safeApi(async () => {
    const { data } = await api.get('/news', {
      ticker: ticker.toUpperCase(),
      limit: Math.min(limit, 10),
      end_date: endDate,
      start_date: range.startDate,
    }, { cacheable: true, ttlMs: isHistoricalWindow ? TTL_24H : TTL_15M });
    return (data.news as Array<Record<string, unknown>>) ?? [];
  }, [], 'fetchCompanyNews');
}
