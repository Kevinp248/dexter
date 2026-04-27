import path from 'node:path';
import {
  fetchCashFlowStatements,
  fetchCompanyNews,
  fetchHistoricalPrices,
  fetchIncomeStatements,
  fetchKeyRatios,
  fetchUpcomingEarningsDate,
} from '../../data/market.js';
import { SIGNAL_CONFIG } from '../config.js';
import { regimeSpyCalendarWindowDays } from '../index.js';
import { loadUniverseManifest, UniverseTickerEntry } from './parity-walk-forward.js';

export type PreflightEndpoint =
  | 'prices'
  | 'fundamentals'
  | 'valuation_inputs'
  | 'news'
  | 'earnings'
  | 'regime_inputs';

export type PreflightStatus = 'ok' | 'warn' | 'fail';

export interface ProviderPreflightCheck {
  endpoint: PreflightEndpoint;
  ticker: string;
  status: PreflightStatus;
  message: string;
  sampleSize: number;
}

export interface ProviderPreflightSummaryRow {
  key: string;
  ok: number;
  warn: number;
  fail: number;
}

export interface ProviderPreflightReport {
  generatedAt: string;
  asOfDate: string;
  apiKeyPresent: boolean;
  tickers: string[];
  checks: ProviderPreflightCheck[];
  byEndpoint: ProviderPreflightSummaryRow[];
  byTicker: ProviderPreflightSummaryRow[];
  usablePriceTickers: string[];
  warnings: string[];
}

export interface ProviderPreflightConfig {
  manifestPath?: string;
  tickers?: string[];
  asOfDate?: string;
  priceLookbackDays?: number;
  minimumUsablePriceBars?: number;
  failOnNoUsablePrices?: boolean;
}

interface ProviderPreflightDependencies {
  loadUniverseManifestFn?: typeof loadUniverseManifest;
  fetchHistoricalPricesFn?: typeof fetchHistoricalPrices;
  fetchKeyRatiosFn?: typeof fetchKeyRatios;
  fetchCashFlowStatementsFn?: typeof fetchCashFlowStatements;
  fetchIncomeStatementsFn?: typeof fetchIncomeStatements;
  fetchCompanyNewsFn?: typeof fetchCompanyNews;
  fetchUpcomingEarningsDateFn?: typeof fetchUpcomingEarningsDate;
  nowFn?: () => Date;
}

export const DEFAULT_SMOKE_MANIFEST_PATH = path.join(
  process.cwd(),
  'src',
  'signal-engine',
  'validation',
  'universes',
  'liquid-us-smoke.json',
);

function asDateOnly(value: string): string {
  return value.slice(0, 10);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: string, days: number): string {
  const dt = new Date(`${date}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function normalizeTickerList(
  manifestTickers: UniverseTickerEntry[],
  explicitTickers?: string[],
): string[] {
  const base = explicitTickers?.length
    ? explicitTickers
    : manifestTickers.map((item) => item.ticker);
  return Array.from(
    new Set(base.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

function addSummary(
  map: Map<string, ProviderPreflightSummaryRow>,
  key: string,
  status: PreflightStatus,
): void {
  const row = map.get(key) ?? { key, ok: 0, warn: 0, fail: 0 };
  row[status] += 1;
  map.set(key, row);
}

function summarizeChecks(
  checks: ProviderPreflightCheck[],
): { byEndpoint: ProviderPreflightSummaryRow[]; byTicker: ProviderPreflightSummaryRow[] } {
  const byEndpointMap = new Map<string, ProviderPreflightSummaryRow>();
  const byTickerMap = new Map<string, ProviderPreflightSummaryRow>();
  for (const check of checks) {
    addSummary(byEndpointMap, check.endpoint, check.status);
    addSummary(byTickerMap, check.ticker, check.status);
  }
  return {
    byEndpoint: Array.from(byEndpointMap.values()).sort((a, b) => a.key.localeCompare(b.key)),
    byTicker: Array.from(byTickerMap.values()).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export async function runProviderPreflight(
  config: ProviderPreflightConfig = {},
  deps: ProviderPreflightDependencies = {},
): Promise<ProviderPreflightReport> {
  const now = deps.nowFn ?? (() => new Date());
  const asOfDate = asDateOnly(config.asOfDate ?? formatDate(now()));
  const loadManifestFn = deps.loadUniverseManifestFn ?? loadUniverseManifest;
  const fetchHistoricalPricesFn = deps.fetchHistoricalPricesFn ?? fetchHistoricalPrices;
  const fetchKeyRatiosFn = deps.fetchKeyRatiosFn ?? fetchKeyRatios;
  const fetchCashFlowStatementsFn = deps.fetchCashFlowStatementsFn ?? fetchCashFlowStatements;
  const fetchIncomeStatementsFn = deps.fetchIncomeStatementsFn ?? fetchIncomeStatements;
  const fetchCompanyNewsFn = deps.fetchCompanyNewsFn ?? fetchCompanyNews;
  const fetchUpcomingEarningsDateFn = deps.fetchUpcomingEarningsDateFn ?? fetchUpcomingEarningsDate;
  const priceLookbackDays = Math.max(1, Math.floor(config.priceLookbackDays ?? 40));
  const minimumUsablePriceBars = Math.max(1, Math.floor(config.minimumUsablePriceBars ?? 5));
  const failOnNoUsablePrices = config.failOnNoUsablePrices ?? true;
  const apiKeyPresent = Boolean((process.env.FINANCIAL_DATASETS_API_KEY ?? '').trim());

  const manifest = await loadManifestFn(config.manifestPath ?? DEFAULT_SMOKE_MANIFEST_PATH);
  const tickers = normalizeTickerList(manifest.tickers, config.tickers);
  if (!tickers.length) {
    throw new Error('Provider preflight requires at least one ticker.');
  }

  const checks: ProviderPreflightCheck[] = [];
  const warnings = new Set<string>();
  if (!apiKeyPresent) {
    warnings.add(
      'FINANCIAL_DATASETS_API_KEY is missing. Provider may run in restricted mode with limited ticker coverage.',
    );
  }

  const usablePriceTickers: string[] = [];
  for (const ticker of tickers) {
    try {
      const bars = await fetchHistoricalPricesFn(ticker, priceLookbackDays, { endDate: asOfDate });
      const usableBars = bars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
      const priceOk = usableBars.length >= minimumUsablePriceBars;
      if (priceOk) usablePriceTickers.push(ticker);
      checks.push({
        endpoint: 'prices',
        ticker,
        status: priceOk ? 'ok' : 'fail',
        message: priceOk
          ? `Fetched ${usableBars.length} usable price bars.`
          : `Insufficient usable price bars (${usableBars.length}/${minimumUsablePriceBars}).`,
        sampleSize: usableBars.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        endpoint: 'prices',
        ticker,
        status: 'fail',
        message,
        sampleSize: 0,
      });
    }

    try {
      const snapshot = await fetchKeyRatiosFn(ticker, { asOfDate });
      const sampleSize = Object.keys(snapshot).length;
      const ok = sampleSize > 0;
      checks.push({
        endpoint: 'fundamentals',
        ticker,
        status: ok ? 'ok' : 'warn',
        message: ok ? `Fetched fundamentals snapshot fields=${sampleSize}.` : 'No fundamentals snapshot returned.',
        sampleSize,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        endpoint: 'fundamentals',
        ticker,
        status: 'warn',
        message,
        sampleSize: 0,
      });
    }

    try {
      const [income, cashflow] = await Promise.all([
        fetchIncomeStatementsFn(ticker, 3, { asOfDate }),
        fetchCashFlowStatementsFn(ticker, 3, { asOfDate }),
      ]);
      const sampleSize = income.length + cashflow.length;
      const ok = income.length > 0 && cashflow.length > 0;
      checks.push({
        endpoint: 'valuation_inputs',
        ticker,
        status: ok ? 'ok' : 'warn',
        message: ok
          ? `Fetched income=${income.length}, cashflow=${cashflow.length}.`
          : `Partial valuation inputs (income=${income.length}, cashflow=${cashflow.length}).`,
        sampleSize,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        endpoint: 'valuation_inputs',
        ticker,
        status: 'warn',
        message,
        sampleSize: 0,
      });
    }

    try {
      const news = await fetchCompanyNewsFn(ticker, 3, {
        startDate: subtractDays(asOfDate, 10),
        endDate: asOfDate,
        asOfDate,
      });
      checks.push({
        endpoint: 'news',
        ticker,
        status: news.length > 0 ? 'ok' : 'warn',
        message: news.length > 0 ? `Fetched ${news.length} news items.` : 'No news items returned.',
        sampleSize: news.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        endpoint: 'news',
        ticker,
        status: 'warn',
        message,
        sampleSize: 0,
      });
    }

    try {
      const earnings = await fetchUpcomingEarningsDateFn(ticker, asOfDate);
      checks.push({
        endpoint: 'earnings',
        ticker,
        status: earnings ? 'ok' : 'warn',
        message: earnings
          ? `Fetched upcoming earnings date ${earnings}.`
          : 'No upcoming earnings date returned.',
        sampleSize: earnings ? 1 : 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        endpoint: 'earnings',
        ticker,
        status: 'warn',
        message,
        sampleSize: 0,
      });
    }
  }

  const volatilityTicker = SIGNAL_CONFIG.regime.volatilityTicker;
  try {
    const [spyBars, volBars] = await Promise.all([
      fetchHistoricalPricesFn(
        'SPY',
        regimeSpyCalendarWindowDays(SIGNAL_CONFIG.regime.spySmaLookbackDays),
        { endDate: asOfDate },
      ),
      fetchHistoricalPricesFn(volatilityTicker, 20, { endDate: asOfDate }),
    ]);
    const spyCount = spyBars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0).length;
    const volCount = volBars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0).length;
    const ok = spyCount > 0 && volCount > 0;
    checks.push({
      endpoint: 'regime_inputs',
      ticker: 'SPY',
      status: ok ? 'ok' : 'warn',
      message: ok
        ? `Regime inputs available (SPY=${spyCount}, ${volatilityTicker}=${volCount}).`
        : `Regime inputs incomplete (SPY=${spyCount}, ${volatilityTicker}=${volCount}).`,
      sampleSize: spyCount + volCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      endpoint: 'regime_inputs',
      ticker: 'SPY',
      status: 'warn',
      message,
      sampleSize: 0,
    });
  }

  for (const check of checks) {
    if (check.status !== 'ok') {
      warnings.add(`[${check.endpoint}] ${check.ticker}: ${check.message}`);
    }
  }

  const grouped = summarizeChecks(checks);
  const report: ProviderPreflightReport = {
    generatedAt: now().toISOString(),
    asOfDate,
    apiKeyPresent,
    tickers,
    checks: checks.slice().sort((a, b) => {
      if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
      return a.ticker.localeCompare(b.ticker);
    }),
    byEndpoint: grouped.byEndpoint,
    byTicker: grouped.byTicker,
    usablePriceTickers: usablePriceTickers.slice().sort((a, b) => a.localeCompare(b)),
    warnings: Array.from(warnings).sort((a, b) => a.localeCompare(b)),
  };

  if (failOnNoUsablePrices && report.usablePriceTickers.length === 0) {
    throw new Error(
      `Provider preflight failed: no usable price coverage across tickers (${tickers.join(', ')}).`,
    );
  }

  return report;
}
