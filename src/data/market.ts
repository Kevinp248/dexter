import { api } from '../tools/finance/api.js';
import { TTL_1H } from '../tools/finance/utils.js';

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function safeApi<T>(call: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    console.warn(`[market:${label}] ${error}`);
    return fallback;
  }
}

export async function fetchHistoricalPrices(
  ticker: string,
  intervalDays = 40,
): Promise<PriceBar[]> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - intervalDays);

  return safeApi(async () => {
    const { data } = await api.get(
      '/prices/',
      {
        ticker: ticker.toUpperCase(),
        interval: 'day',
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
      },
      { cacheable: true, ttlMs: TTL_1H },
    );

    const rawBars = Array.isArray(data.prices) ? data.prices : [];
    return rawBars
      .map((row) => ({
        date: String(row.date ?? row.period ?? ''),
        open: Number(row.open ?? row.price_open ?? 0),
        high: Number(row.high ?? row.price_high ?? 0),
        low: Number(row.low ?? row.price_low ?? 0),
        close: Number(row.close ?? row.price_close ?? row.price ?? 0),
        volume: Number(row.volume ?? 0),
      }))
      .filter((bar): bar is PriceBar => Boolean(bar.date));
  }, [], 'fetchHistoricalPrices');
}

export async function fetchKeyRatios(ticker: string): Promise<Record<string, unknown>> {
  return safeApi(async () => {
    const { data } = await api.get('/financial-metrics/snapshot/', {
      ticker: ticker.toUpperCase(),
    });
    return (data.snapshot as Record<string, unknown>) ?? {};
  }, {}, 'fetchKeyRatios');
}

export async function fetchCashFlowStatements(
  ticker: string,
  limit = 8,
): Promise<Array<Record<string, unknown>>> {
  return safeApi(async () => {
    const { data } = await api.get('/financials/cash-flow-statements/', {
      ticker: ticker.toUpperCase(),
      period: 'ttm',
      limit,
    });
    return (data.cash_flow_statements as Array<Record<string, unknown>>) ?? [];
  }, [], 'fetchCashFlowStatements');
}

export async function fetchIncomeStatements(
  ticker: string,
  limit = 8,
): Promise<Array<Record<string, unknown>>> {
  return safeApi(async () => {
    const { data } = await api.get('/financials/income-statements/', {
      ticker: ticker.toUpperCase(),
      period: 'ttm',
      limit,
    });
    return (data.income_statements as Array<Record<string, unknown>>) ?? [];
  }, [], 'fetchIncomeStatements');
}

export async function fetchCompanyNews(
  ticker: string,
  limit = 5,
): Promise<Array<{ title?: string; url?: string; published_at?: string }>> {
  return safeApi(async () => {
    const { data } = await api.get('/news', {
      ticker: ticker.toUpperCase(),
      limit: Math.min(limit, 10),
    });
    return (data.news as Array<Record<string, unknown>>) ?? [];
  }, [], 'fetchCompanyNews');
}
