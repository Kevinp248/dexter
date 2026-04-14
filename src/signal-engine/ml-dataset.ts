import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runFundamentalAnalysis } from '../agents/analysis/fundamentals.js';
import { runSentimentAnalysis } from '../agents/analysis/sentiment.js';
import { runTechnicalAnalysis } from '../agents/analysis/technical.js';
import { runValuationAnalysis } from '../agents/analysis/valuation.js';
import { fetchHistoricalPrices, PriceBar } from '../data/market.js';
import {
  getApiUsageSnapshot,
  resetApiUsageCounters,
  writeApiUsageReport,
} from '../tools/finance/api.js';
import { runDailyScan, type ScanProviders } from './index.js';

export interface MlDatasetConfig {
  ticker: string;
  startDate: string;
  endDate: string;
  apiDelayMs: number;
  fundamentalRefreshDays: number;
  valuationRefreshDays: number;
  sentimentRefreshDays: number;
}

export interface MlDatasetRow {
  date: string;
  ticker: string;
  close: number;
  aggregateScore: number;
  confidence: number;
  riskScore: number;
  expectedEdgePreCostBps: number;
  expectedEdgeAfterCostsBps: number;
  minEdgeThresholdBps: number;
  roundTripCostBps: number;
  costChangedAction: boolean;
  costAssumptionSource: 'default' | 'override';
  costAssumptionVersion: string;
  action: string;
  finalAction: string;
  fallbackUsed: boolean;
  qualityGuardSuppressed: boolean;
  technicalScore: number;
  fundamentalsScore: number;
  valuationScore: number;
  sentimentScore: number;
  trendSignal: string;
  momentumSignal: string;
  volatilityPercentile: number;
  annualizedVolatility: number;
  volatilityRegime: 'low' | 'normal' | 'high';
  trendRegime: 'up' | 'down' | 'sideways';
  return1dPct: number | null;
  return5dPct: number | null;
  return1dAfterCostsPct: number | null;
  return5dAfterCostsPct: number | null;
  labelUp1dAfterCosts: number | null;
  labelUp5dAfterCosts: number | null;
}

export interface MlDatasetReport {
  config: MlDatasetConfig;
  generatedAt: string;
  rows: MlDatasetRow[];
  summary: {
    rows: number;
    labeled1dRows: number;
    labeled5dRows: number;
    fallbackRows: number;
    qualityGuardRows: number;
  };
  apiUsage: {
    totalCalls: number;
    endpoints: Array<{ endpoint: string; calls: number }>;
    usageReportPath: string;
  };
}

const DEFAULT_CONFIG: MlDatasetConfig = {
  ticker: 'AAPL',
  startDate: '2024-01-01',
  endDate: '2026-01-31',
  apiDelayMs: 250,
  fundamentalRefreshDays: 7,
  valuationRefreshDays: 7,
  sentimentRefreshDays: 3,
};

function asDateOnly(value: string): string {
  return value.slice(0, 10);
}

function dateToEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
}

function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function bucketDate(date: string, bucketDays: number): string {
  const day = dateToEpochDay(date);
  const bucketStart = day - (day % Math.max(1, bucketDays));
  return fromEpochDay(bucketStart);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function subtractDays(date: string, days: number): string {
  const dt = new Date(`${date}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function toNum(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function csvCell(value: string | number | boolean | null): string {
  const raw = value === null ? '' : String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function rowsToCsv(rows: MlDatasetRow[]): string {
  const headers: Array<keyof MlDatasetRow> = [
    'date',
    'ticker',
    'close',
    'aggregateScore',
    'confidence',
    'riskScore',
    'expectedEdgePreCostBps',
    'expectedEdgeAfterCostsBps',
    'minEdgeThresholdBps',
    'roundTripCostBps',
    'costChangedAction',
    'costAssumptionSource',
    'costAssumptionVersion',
    'action',
    'finalAction',
    'fallbackUsed',
    'qualityGuardSuppressed',
    'technicalScore',
    'fundamentalsScore',
    'valuationScore',
    'sentimentScore',
    'trendSignal',
    'momentumSignal',
    'volatilityPercentile',
    'annualizedVolatility',
    'volatilityRegime',
    'trendRegime',
    'return1dPct',
    'return5dPct',
    'return1dAfterCostsPct',
    'return5dAfterCostsPct',
    'labelUp1dAfterCosts',
    'labelUp5dAfterCosts',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header] as string | number | boolean | null)).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function getCloseAtOffset(closesByDate: Map<string, number>, dates: string[], idx: number, offset: number): number | null {
  const next = idx + offset;
  if (next >= dates.length) return null;
  const date = dates[next];
  return closesByDate.get(date) ?? null;
}

export async function buildMlDataset(
  config: Partial<MlDatasetConfig> = {},
): Promise<MlDatasetReport> {
  resetApiUsageCounters();
  const resolved: MlDatasetConfig = { ...DEFAULT_CONFIG, ...config };
  const startWithLookback = subtractDays(resolved.startDate, 280);
  const bars = await fetchHistoricalPrices(resolved.ticker, 700, {
    startDate: startWithLookback,
    endDate: resolved.endDate,
  });
  const orderedBars = [...bars].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const inWindow = orderedBars.filter((bar) => {
    const date = asDateOnly(bar.date);
    return date >= resolved.startDate && date <= resolved.endDate;
  });
  const dates = inWindow.map((bar) => asDateOnly(bar.date));
  const closesByDate = new Map(inWindow.map((bar) => [asDateOnly(bar.date), bar.close]));

  let lastCallAt = 0;
  const fundamentalCache = new Map<string, ReturnType<typeof runFundamentalAnalysis>>();
  const sentimentCache = new Map<string, ReturnType<typeof runSentimentAnalysis>>();
  const valuationCache = new Map<string, ReturnType<typeof runValuationAnalysis>>();
  const rows: MlDatasetRow[] = [];

  for (let i = 0; i < dates.length; i += 1) {
    const asOfDate = dates[i];
    const now = Date.now();
    const waitMs = Math.max(0, resolved.apiDelayMs - (now - lastCallAt));
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();

    const providers: ScanProviders = {
      runTechnicalAnalysis: (ticker) =>
        runTechnicalAnalysis(ticker, {
          asOfDate,
          strictPointInTime: true,
          priceHistoryOverride: orderedBars
            .filter((bar) => asDateOnly(bar.date) <= asOfDate)
            .slice(-240),
        }),
      runFundamentalAnalysis: (ticker) => {
        const key = `${ticker}:${bucketDate(asOfDate, resolved.fundamentalRefreshDays)}`;
        if (!fundamentalCache.has(key)) {
          fundamentalCache.set(
            key,
            runFundamentalAnalysis(ticker, {
              asOfDate: bucketDate(asOfDate, resolved.fundamentalRefreshDays),
              strictPointInTime: true,
            }),
          );
        }
        return fundamentalCache.get(key)!;
      },
      runSentimentAnalysis: (ticker) => {
        const key = `${ticker}:${bucketDate(asOfDate, resolved.sentimentRefreshDays)}`;
        if (!sentimentCache.has(key)) {
          sentimentCache.set(
            key,
            runSentimentAnalysis(ticker, {
              asOfDate: bucketDate(asOfDate, resolved.sentimentRefreshDays),
              strictPointInTime: true,
            }),
          );
        }
        return sentimentCache.get(key)!;
      },
      runValuationAnalysis: (ticker) => {
        const key = `${ticker}:${bucketDate(asOfDate, resolved.valuationRefreshDays)}`;
        if (!valuationCache.has(key)) {
          valuationCache.set(
            key,
            runValuationAnalysis(ticker, {
              asOfDate: bucketDate(asOfDate, resolved.valuationRefreshDays),
              strictPointInTime: true,
            }),
          );
        }
        return valuationCache.get(key)!;
      },
      fetchUpcomingEarningsDate: async () => null,
      fetchMarketRegimeInputs: async () => ({ spyCloses: [], vixClose: null }),
    };

    const scan = await runDailyScan(
      {
        tickers: [resolved.ticker],
        analysisContext: { asOfDate, strictPointInTime: true },
      },
      providers,
    );
    const alert = scan.alerts[0];
    if (!alert) continue;

    const componentMap = new Map(
      alert.reasoning.components.map((component) => [component.name.toLowerCase(), component]),
    );
    const technical = componentMap.get('technical');
    const technicalDetails = (technical?.details ?? {}) as Record<string, unknown>;
    const subSignals = (technicalDetails.subSignals ?? {}) as Record<string, Record<string, unknown>>;
    const trendSignal = String(subSignals.trend?.signal ?? 'neutral');
    const momentumSignal = String(subSignals.momentum?.signal ?? 'neutral');
    const volatilityMetrics = (subSignals.volatility?.metrics ?? {}) as Record<string, unknown>;
    const volatilityPercentile = toNum(volatilityMetrics.volatilityPercentile, 50);
    const annualizedVolatility = toNum(volatilityMetrics.annualizedVolatility, 0);
    const volatilityRegime: MlDatasetRow['volatilityRegime'] =
      volatilityPercentile >= 70 ? 'high' : volatilityPercentile <= 30 ? 'low' : 'normal';
    const trendRegime: MlDatasetRow['trendRegime'] =
      trendSignal === 'bullish' ? 'up' : trendSignal === 'bearish' ? 'down' : 'sideways';

    const close = closesByDate.get(asOfDate) ?? 0;
    const next1Close = getCloseAtOffset(closesByDate, dates, i, 1);
    const next5Close = getCloseAtOffset(closesByDate, dates, i, 5);
    const roundTripCostBps = alert.executionPlan.costEstimate.roundTripCostBps;
    const oneCostPct = roundTripCostBps / 10000;
    const return1dPct = next1Close && close > 0 ? next1Close / close - 1 : null;
    const return5dPct = next5Close && close > 0 ? next5Close / close - 1 : null;
    const return1dAfterCostsPct = return1dPct === null ? null : return1dPct - oneCostPct;
    const return5dAfterCostsPct = return5dPct === null ? null : return5dPct - oneCostPct;
    const labelUp1dAfterCosts = return1dAfterCostsPct === null ? null : return1dAfterCostsPct > 0 ? 1 : 0;
    const labelUp5dAfterCosts = return5dAfterCostsPct === null ? null : return5dAfterCostsPct > 0 ? 1 : 0;

    rows.push({
      date: asOfDate,
      ticker: resolved.ticker,
      close,
      aggregateScore: alert.reasoning.aggregateScore,
      confidence: alert.confidence,
      riskScore: alert.reasoning.risk.riskScore,
      expectedEdgePreCostBps: alert.executionPlan.costEstimate.expectedEdgePreCostBps,
      expectedEdgeAfterCostsBps: alert.executionPlan.costEstimate.expectedEdgeAfterCostsBps,
      minEdgeThresholdBps: alert.executionPlan.costEstimate.minEdgeThresholdBps,
      roundTripCostBps,
      costChangedAction: alert.executionPlan.costEstimate.costChangedAction,
      costAssumptionSource: alert.executionPlan.costEstimate.assumptionSource,
      costAssumptionVersion: alert.executionPlan.costEstimate.assumptionVersion,
      action: alert.action,
      finalAction: alert.finalAction,
      fallbackUsed: alert.fallbackPolicy.hadFallback,
      qualityGuardSuppressed: Boolean(alert.qualityGuard?.suppressed),
      technicalScore: toNum(componentMap.get('technical')?.score, 0),
      fundamentalsScore: toNum(componentMap.get('fundamentals')?.score, 0),
      valuationScore: toNum(componentMap.get('valuation')?.score, 0),
      sentimentScore: toNum(componentMap.get('sentiment')?.score, 0),
      trendSignal,
      momentumSignal,
      volatilityPercentile,
      annualizedVolatility,
      volatilityRegime,
      trendRegime,
      return1dPct,
      return5dPct,
      return1dAfterCostsPct,
      return5dAfterCostsPct,
      labelUp1dAfterCosts,
      labelUp5dAfterCosts,
    });
  }

  const usageLabel = `${resolved.ticker}-${resolved.startDate}-${resolved.endDate}`;
  const usageReportPath = writeApiUsageReport(usageLabel);
  const apiUsage = getApiUsageSnapshot();
  const labeled1dRows = rows.filter((row) => row.labelUp1dAfterCosts !== null).length;
  const labeled5dRows = rows.filter((row) => row.labelUp5dAfterCosts !== null).length;
  const fallbackRows = rows.filter((row) => row.fallbackUsed).length;
  const qualityGuardRows = rows.filter((row) => row.qualityGuardSuppressed).length;

  return {
    config: resolved,
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      rows: rows.length,
      labeled1dRows,
      labeled5dRows,
      fallbackRows,
      qualityGuardRows,
    },
    apiUsage: {
      totalCalls: apiUsage.totalCalls,
      endpoints: apiUsage.endpoints,
      usageReportPath,
    },
  };
}

export async function persistMlDataset(
  report: MlDatasetReport,
): Promise<{ csvPath: string; jsonPath: string }> {
  const baseDir = path.join(process.cwd(), '.dexter', 'signal-engine', 'datasets');
  await mkdir(baseDir, { recursive: true });
  const suffix = `${report.config.ticker}-${report.config.startDate}-${report.config.endDate}`;
  const csvPath = path.join(baseDir, `ml-dataset-${suffix}.csv`);
  const jsonPath = path.join(baseDir, `ml-dataset-${suffix}.json`);
  await writeFile(csvPath, rowsToCsv(report.rows), 'utf8');
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  return { csvPath, jsonPath };
}
