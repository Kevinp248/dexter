import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runFundamentalAnalysis } from '../../agents/analysis/fundamentals.js';
import { runSentimentAnalysis } from '../../agents/analysis/sentiment.js';
import { runTechnicalAnalysis } from '../../agents/analysis/technical.js';
import { runValuationAnalysis } from '../../agents/analysis/valuation.js';
import {
  fetchHistoricalPrices,
  fetchUpcomingEarningsDate,
  type PriceBar,
} from '../../data/market.js';
import { SIGNAL_CONFIG } from '../config.js';
import { regimeSpyCalendarWindowDays, runDailyScan, type ScanProviders } from '../index.js';
import { AnalysisContext } from '../../agents/analysis/types.js';
import {
  ForwardReturnLabel,
  InputProvenance,
  ParityValidationConfig,
  ParityValidationReport,
  ParityValidationRow,
} from './parity-models.js';

interface ParityValidationDependencies {
  runDailyScanFn?: typeof runDailyScan;
  fetchHistoricalPricesFn?: typeof fetchHistoricalPrices;
  baseProviders?: Partial<ScanProviders>;
  nowFn?: () => Date;
}

type DayProvenance = {
  earningsByTicker: Map<string, InputProvenance>;
  regime: InputProvenance | null;
};

const DEFAULT_CONFIG: ParityValidationConfig = {
  tickers: ['AAPL', 'MSFT'],
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  watchlistSliceSize: 25,
  apiDelayMs: 0,
};

function asDateOnly(value: string): string {
  return value.slice(0, 10);
}

function subtractDays(date: string, days: number): string {
  const dt = new Date(`${date}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function roundTo(value: number, digits = 8): number {
  return Number(value.toFixed(digits));
}

function clampSliceSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackDateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function parseProviders(
  configProviders: Partial<ScanProviders> | undefined,
  fetchHistoricalPricesFn: typeof fetchHistoricalPrices,
): ScanProviders {
  const base: ScanProviders = {
    runTechnicalAnalysis: configProviders?.runTechnicalAnalysis ?? runTechnicalAnalysis,
    runFundamentalAnalysis: configProviders?.runFundamentalAnalysis ?? runFundamentalAnalysis,
    runSentimentAnalysis: configProviders?.runSentimentAnalysis ?? runSentimentAnalysis,
    runValuationAnalysis: configProviders?.runValuationAnalysis ?? runValuationAnalysis,
    fetchUpcomingEarningsDate:
      configProviders?.fetchUpcomingEarningsDate ??
      ((ticker: string, context?: AnalysisContext) =>
        fetchUpcomingEarningsDate(ticker, context?.asOfDate)),
    fetchMarketRegimeInputs:
      configProviders?.fetchMarketRegimeInputs ??
      (async (context?: AnalysisContext, lookbackDays = SIGNAL_CONFIG.regime.spySmaLookbackDays) => {
        const endDate = context?.asOfDate?.slice(0, 10);
        const volatilityTicker = SIGNAL_CONFIG.regime.volatilityTicker;
        const spyCalendarWindowDays = regimeSpyCalendarWindowDays(lookbackDays);
        const [spyBars, volBars] = await Promise.all([
          fetchHistoricalPricesFn('SPY', spyCalendarWindowDays, { endDate }),
          fetchHistoricalPricesFn(volatilityTicker, 20, { endDate }),
        ]);
        return {
          spyCloses: spyBars
            .map((bar) => bar.close)
            .filter((value) => Number.isFinite(value) && value > 0),
          vixClose: volBars.length ? volBars[volBars.length - 1].close : null,
        };
      }),
  };
  return base;
}

function createWrappedProviders(
  baseProviders: ScanProviders,
  dayProvenance: DayProvenance,
  source: InputProvenance['source'],
): ScanProviders {
  return {
    runTechnicalAnalysis: baseProviders.runTechnicalAnalysis,
    runFundamentalAnalysis: baseProviders.runFundamentalAnalysis,
    runSentimentAnalysis: baseProviders.runSentimentAnalysis,
    runValuationAnalysis: baseProviders.runValuationAnalysis,
    fetchUpcomingEarningsDate: async (ticker, context) => {
      const asOfDate = context?.asOfDate?.slice(0, 10) ?? null;
      try {
        const value = await baseProviders.fetchUpcomingEarningsDate?.(ticker, context);
        if (value) {
          dayProvenance.earningsByTicker.set(ticker, {
            status: 'available',
            source,
            asOfDateUsed: asOfDate,
            warning: null,
          });
          return value;
        }
        dayProvenance.earningsByTicker.set(ticker, {
          status: 'unavailable',
          source,
          asOfDateUsed: asOfDate,
          warning: `No upcoming earnings date returned for ${ticker} as of ${asOfDate ?? 'unknown'}.`,
        });
        return null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dayProvenance.earningsByTicker.set(ticker, {
          status: 'error',
          source,
          asOfDateUsed: asOfDate,
          warning: `Earnings provider error for ${ticker}: ${message}`,
        });
        return null;
      }
    },
    fetchMarketRegimeInputs: async (context, lookbackDays) => {
      const asOfDate = context?.asOfDate?.slice(0, 10) ?? null;
      try {
        const result = await baseProviders.fetchMarketRegimeInputs?.(context, lookbackDays);
        const hasSpy = Boolean(result?.spyCloses?.length);
        const hasVol = Number.isFinite(result?.vixClose ?? Number.NaN);
        dayProvenance.regime = {
          status: hasSpy && hasVol ? 'available' : 'unavailable',
          source,
          asOfDateUsed: asOfDate,
          warning:
            hasSpy && hasVol
              ? null
              : `Regime inputs incomplete as of ${asOfDate ?? 'unknown'} (spyBars=${result?.spyCloses?.length ?? 0}, vixClose=${String(result?.vixClose ?? null)}).`,
        };
        return result ?? { spyCloses: [], vixClose: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dayProvenance.regime = {
          status: 'error',
          source,
          asOfDateUsed: asOfDate,
          warning: `Regime provider error: ${message}`,
        };
        return { spyCloses: [], vixClose: null };
      }
    },
  };
}

function componentScore(alert: { reasoning: { components: Array<{ name: string; score: number }> } }, componentName: string): number {
  const component = alert.reasoning.components.find(
    (item: { name: string; score: number }) => item.name.toLowerCase() === componentName,
  );
  return component?.score ?? 0;
}

function buildForwardReturnLabel(
  tradingDates: string[],
  closesByDate: Map<string, number>,
  asOfDate: string,
  finalAction: ParityValidationRow['finalAction'],
  horizon: number,
  roundTripCostBps: number,
): ForwardReturnLabel {
  const idx = tradingDates.indexOf(asOfDate);
  if (idx < 0 || idx + horizon >= tradingDates.length) {
    return {
      basis: 'close_to_close',
      closeToCloseReturnPct: null,
      directionalReturnPct: null,
      directionalReturnAfterCostsPct: null,
      directionalAfterCostsAssumption: 'none',
      isLabelAvailable: false,
      isDirectionalAfterCostsLabelAvailable: false,
    };
  }
  const nowDate = tradingDates[idx];
  const futureDate = tradingDates[idx + horizon];
  const nowClose = closesByDate.get(nowDate);
  const futureClose = closesByDate.get(futureDate);
  if (!nowClose || !futureClose || nowClose <= 0) {
    return {
      basis: 'close_to_close',
      closeToCloseReturnPct: null,
      directionalReturnPct: null,
      directionalReturnAfterCostsPct: null,
      directionalAfterCostsAssumption: 'none',
      isLabelAvailable: false,
      isDirectionalAfterCostsLabelAvailable: false,
    };
  }
  const closeToCloseReturnPct = futureClose / nowClose - 1;
  const cost = roundTripCostBps / 10_000;
  let directionalReturnPct: number | null = null;
  let directionalReturnAfterCostsPct: number | null = null;
  let directionalAfterCostsAssumption: ForwardReturnLabel['directionalAfterCostsAssumption'] =
    'none';
  let isDirectionalAfterCostsLabelAvailable = false;

  if (finalAction === 'BUY') {
    directionalReturnPct = closeToCloseReturnPct;
    directionalReturnAfterCostsPct = directionalReturnPct - cost;
    directionalAfterCostsAssumption = 'buy_round_trip';
    isDirectionalAfterCostsLabelAvailable = true;
  } else if (finalAction === 'SELL') {
    // Long-only SELL validation means avoid/exit long exposure, not short entry.
    directionalReturnPct = -closeToCloseReturnPct;
    directionalReturnAfterCostsPct = directionalReturnPct;
    directionalAfterCostsAssumption = 'sell_zero_cost_avoidance';
    isDirectionalAfterCostsLabelAvailable = true;
  } else {
    // HOLD is no-trade in validation label semantics.
    directionalReturnPct = null;
    directionalReturnAfterCostsPct = null;
    directionalAfterCostsAssumption = 'none';
  }

  return {
    basis: 'close_to_close',
    closeToCloseReturnPct: roundTo(closeToCloseReturnPct),
    directionalReturnPct: directionalReturnPct === null ? null : roundTo(directionalReturnPct),
    directionalReturnAfterCostsPct:
      directionalReturnAfterCostsPct === null ? null : roundTo(directionalReturnAfterCostsPct),
    directionalAfterCostsAssumption,
    isLabelAvailable: true,
    isDirectionalAfterCostsLabelAvailable,
  };
}

function toCsvCell(value: string | number | boolean | null): string {
  const str = value === null ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowsToCsv(rows: ParityValidationRow[]): string {
  const headers = [
    'asOfDate',
    'ticker',
    'rawAction',
    'finalAction',
    'confidence',
    'aggregateScore',
    'riskScore',
    'technicalScore',
    'fundamentalsScore',
    'valuationScore',
    'sentimentScore',
    'earningsState',
    'earningsReasonCode',
    'earningsProvenanceStatus',
    'earningsProvenanceSource',
    'earningsProvenanceAsOfDate',
    'earningsProvenanceWarning',
    'regimeState',
    'regimeReasonCode',
    'regimeProvenanceStatus',
    'regimeProvenanceSource',
    'regimeProvenanceAsOfDate',
    'regimeProvenanceWarning',
    'expectedEdgePreCostBps',
    'expectedEdgePostCostBps',
    'minEdgeThresholdBps',
    'roundTripCostBps',
    'costChangedAction',
    'costAssumptionSource',
    'costAssumptionVersion',
    'costAssumptionSnapshotId',
    'dataCompletenessScore',
    'dataCompletenessStatus',
    'dataCompletenessMissingCritical',
    'fallbackHadFallback',
    'fallbackEventCount',
    'qualityGuardSuppressed',
    'qualityGuardReason',
    'qualityGuardFallbackRatio',
    'forward1dLabelBasis',
    'forward1dCloseToCloseReturnPct',
    'forward1dDirectionalReturnPct',
    'forward1dDirectionalReturnAfterCostsPct',
    'forward1dDirectionalAfterCostsAssumption',
    'forward1dLabelAvailable',
    'forward1dDirectionalAfterCostsLabelAvailable',
    'forward5dLabelBasis',
    'forward5dCloseToCloseReturnPct',
    'forward5dDirectionalReturnPct',
    'forward5dDirectionalReturnAfterCostsPct',
    'forward5dDirectionalAfterCostsAssumption',
    'forward5dLabelAvailable',
    'forward5dDirectionalAfterCostsLabelAvailable',
    'forward10dLabelBasis',
    'forward10dCloseToCloseReturnPct',
    'forward10dDirectionalReturnPct',
    'forward10dDirectionalReturnAfterCostsPct',
    'forward10dDirectionalAfterCostsAssumption',
    'forward10dLabelAvailable',
    'forward10dDirectionalAfterCostsLabelAvailable',
    'forward20dLabelBasis',
    'forward20dCloseToCloseReturnPct',
    'forward20dDirectionalReturnPct',
    'forward20dDirectionalReturnAfterCostsPct',
    'forward20dDirectionalAfterCostsAssumption',
    'forward20dLabelAvailable',
    'forward20dDirectionalAfterCostsLabelAvailable',
  ] as const;

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.asOfDate,
        row.ticker,
        row.rawAction,
        row.finalAction,
        row.confidence,
        row.aggregateScore,
        row.riskScore,
        row.technicalScore,
        row.fundamentalsScore,
        row.valuationScore,
        row.sentimentScore,
        row.earningsState,
        row.earningsReasonCode,
        row.earningsProvenance.status,
        row.earningsProvenance.source,
        row.earningsProvenance.asOfDateUsed,
        row.earningsProvenance.warning,
        row.regimeState,
        row.regimeReasonCode,
        row.regimeProvenance.status,
        row.regimeProvenance.source,
        row.regimeProvenance.asOfDateUsed,
        row.regimeProvenance.warning,
        row.expectedEdgePreCostBps,
        row.expectedEdgePostCostBps,
        row.minEdgeThresholdBps,
        row.roundTripCostBps,
        row.costChangedAction,
        row.costAssumptionSource,
        row.costAssumptionVersion,
        row.costAssumptionSnapshotId,
        row.dataCompletenessScore,
        row.dataCompletenessStatus,
        row.dataCompletenessMissingCritical.join('|'),
        row.fallbackHadFallback,
        row.fallbackEventCount,
        row.qualityGuardSuppressed,
        row.qualityGuardReason,
        row.qualityGuardFallbackRatio,
        row.forward1d.basis,
        row.forward1d.closeToCloseReturnPct,
        row.forward1d.directionalReturnPct,
        row.forward1d.directionalReturnAfterCostsPct,
        row.forward1d.directionalAfterCostsAssumption,
        row.forward1d.isLabelAvailable,
        row.forward1d.isDirectionalAfterCostsLabelAvailable,
        row.forward5d.basis,
        row.forward5d.closeToCloseReturnPct,
        row.forward5d.directionalReturnPct,
        row.forward5d.directionalReturnAfterCostsPct,
        row.forward5d.directionalAfterCostsAssumption,
        row.forward5d.isLabelAvailable,
        row.forward5d.isDirectionalAfterCostsLabelAvailable,
        row.forward10d.basis,
        row.forward10d.closeToCloseReturnPct,
        row.forward10d.directionalReturnPct,
        row.forward10d.directionalReturnAfterCostsPct,
        row.forward10d.directionalAfterCostsAssumption,
        row.forward10d.isLabelAvailable,
        row.forward10d.isDirectionalAfterCostsLabelAvailable,
        row.forward20d.basis,
        row.forward20d.closeToCloseReturnPct,
        row.forward20d.directionalReturnPct,
        row.forward20d.directionalReturnAfterCostsPct,
        row.forward20d.directionalAfterCostsAssumption,
        row.forward20d.isLabelAvailable,
        row.forward20d.isDirectionalAfterCostsLabelAvailable,
      ]
        .map(toCsvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function buildParityValidationReport(
  config: Partial<ParityValidationConfig> = {},
  deps: ParityValidationDependencies = {},
): Promise<ParityValidationReport> {
  const resolved: ParityValidationConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    tickers: (config.tickers ?? DEFAULT_CONFIG.tickers)
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean),
    watchlistSliceSize: clampSliceSize(
      config.watchlistSliceSize ?? DEFAULT_CONFIG.watchlistSliceSize,
      DEFAULT_CONFIG.watchlistSliceSize,
    ),
    apiDelayMs: typeof config.apiDelayMs === 'number' && Number.isFinite(config.apiDelayMs)
      ? Math.max(0, Math.floor(config.apiDelayMs))
      : DEFAULT_CONFIG.apiDelayMs,
  };

  const fetchHistoricalPricesFn = deps.fetchHistoricalPricesFn ?? fetchHistoricalPrices;
  const runDailyScanFn = deps.runDailyScanFn ?? runDailyScan;
  const now = deps.nowFn ?? (() => new Date());

  if (!resolved.tickers.length) {
    throw new Error('parity validation requires at least one ticker');
  }

  const tradingDatesByTicker = new Map<string, string[]>();
  const closesByTickerDate = new Map<string, Map<string, number>>();

  const startForBars = subtractDays(resolved.startDate, 40);
  for (const ticker of resolved.tickers) {
    const bars = await fetchHistoricalPricesFn(ticker, 420, {
      startDate: startForBars,
      endDate: resolved.endDate,
    });
    const ordered = [...bars].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const inWindow = ordered.filter((bar) => {
      const date = asDateOnly(bar.date);
      return date >= resolved.startDate && date <= resolved.endDate;
    });
    const dates = inWindow.map((bar) => asDateOnly(bar.date));
    tradingDatesByTicker.set(ticker, dates);
    closesByTickerDate.set(
      ticker,
      new Map(inWindow.map((bar) => [asDateOnly(bar.date), bar.close])),
    );
  }

  const allDates = Array.from(
    new Set(Array.from(tradingDatesByTicker.values()).flat()),
  ).sort();
  const asOfDates = allDates.length ? allDates : fallbackDateRange(resolved.startDate, resolved.endDate);
  const slices = chunk(resolved.tickers, resolved.watchlistSliceSize);
  const rows: ParityValidationRow[] = [];
  const warnings = new Set<string>();

  let lastCallAt = 0;
  const usingCustomProviders = Boolean(deps.baseProviders);

  for (const asOfDate of asOfDates) {
    for (const sliceTickers of slices) {
      if (resolved.apiDelayMs > 0) {
        const nowMs = Date.now();
        const waitMs = Math.max(0, resolved.apiDelayMs - (nowMs - lastCallAt));
        if (waitMs > 0) await sleep(waitMs);
        lastCallAt = Date.now();
      }

      const dayProvenance: DayProvenance = {
        earningsByTicker: new Map<string, InputProvenance>(),
        regime: null,
      };
      const baseProviders = parseProviders(deps.baseProviders, fetchHistoricalPricesFn);
      const wrappedProviders = createWrappedProviders(
        baseProviders,
        dayProvenance,
        usingCustomProviders ? 'custom_provider' : 'historical_provider_asof',
      );

      const scan = await runDailyScanFn(
        {
          ...(resolved.scanOptions ?? {}),
          tickers: sliceTickers,
          portfolioValue: resolved.portfolioValue,
          analysisContext: {
            ...(resolved.analysisContext ?? {}),
            asOfDate,
            strictPointInTime: true,
          },
        },
        wrappedProviders,
      );

      for (const alert of scan.alerts) {
        const tickerDates = tradingDatesByTicker.get(alert.ticker) ?? [];
        const closes = closesByTickerDate.get(alert.ticker) ?? new Map<string, number>();
        const roundTripCostBps = alert.executionPlan.costEstimate.roundTripCostBps;

        const earningsProvenance =
          dayProvenance.earningsByTicker.get(alert.ticker) ?? {
            status: 'unavailable',
            source: usingCustomProviders ? 'custom_provider' : 'historical_provider_asof',
            asOfDateUsed: asOfDate,
            warning: `Earnings provenance unavailable for ${alert.ticker} as of ${asOfDate}.`,
          };
        const regimeProvenance =
          dayProvenance.regime ?? {
            status: 'unavailable',
            source: usingCustomProviders ? 'custom_provider' : 'historical_provider_asof',
            asOfDateUsed: asOfDate,
            warning: `Regime provenance unavailable as of ${asOfDate}.`,
          };

        if (earningsProvenance.warning) warnings.add(earningsProvenance.warning);
        if (regimeProvenance.warning) warnings.add(regimeProvenance.warning);

        rows.push({
          asOfDate,
          ticker: alert.ticker,
          rawAction: alert.rawAction,
          finalAction: alert.finalAction,
          confidence: roundTo(alert.confidence, 6),
          aggregateScore: roundTo(alert.reasoning.aggregateScore, 8),
          riskScore: roundTo(alert.reasoning.risk.riskScore, 8),
          technicalScore: roundTo(componentScore(alert, 'technical'), 8),
          fundamentalsScore: roundTo(componentScore(alert, 'fundamentals'), 8),
          valuationScore: roundTo(componentScore(alert, 'valuation'), 8),
          sentimentScore: roundTo(componentScore(alert, 'sentiment'), 8),
          earningsState: alert.earningsRisk.coverageStatus,
          earningsReasonCode: alert.earningsRisk.reasonCode,
          earningsProvenance,
          regimeState: alert.marketRegime.state,
          regimeReasonCode: alert.marketRegime.reasonCode,
          regimeProvenance,
          expectedEdgePreCostBps: roundTo(alert.executionPlan.costEstimate.expectedEdgePreCostBps, 6),
          expectedEdgePostCostBps: roundTo(alert.executionPlan.costEstimate.expectedEdgePostCostBps, 6),
          minEdgeThresholdBps: roundTo(alert.executionPlan.costEstimate.minEdgeThresholdBps, 6),
          roundTripCostBps: roundTo(roundTripCostBps, 6),
          costChangedAction: alert.executionPlan.costEstimate.costChangedAction,
          costAssumptionSource: alert.executionPlan.costEstimate.assumptionSource,
          costAssumptionVersion: alert.executionPlan.costEstimate.assumptionVersion,
          costAssumptionSnapshotId: alert.executionPlan.costEstimate.assumptionSnapshotId,
          dataCompletenessScore: roundTo(alert.dataCompleteness.score, 8),
          dataCompletenessStatus: alert.dataCompleteness.status,
          dataCompletenessMissingCritical: alert.dataCompleteness.missingCritical,
          fallbackHadFallback: alert.fallbackPolicy.hadFallback,
          fallbackEventCount: alert.fallbackPolicy.events.length,
          qualityGuardSuppressed: Boolean(alert.qualityGuard?.suppressed),
          qualityGuardReason: alert.qualityGuard?.reason ?? null,
          qualityGuardFallbackRatio: roundTo(alert.qualityGuard?.fallbackRatio ?? 0, 8),
          forward1d: buildForwardReturnLabel(
            tickerDates,
            closes,
            asOfDate,
            alert.finalAction,
            1,
            roundTripCostBps,
          ),
          forward5d: buildForwardReturnLabel(
            tickerDates,
            closes,
            asOfDate,
            alert.finalAction,
            5,
            roundTripCostBps,
          ),
          forward10d: buildForwardReturnLabel(
            tickerDates,
            closes,
            asOfDate,
            alert.finalAction,
            10,
            roundTripCostBps,
          ),
          forward20d: buildForwardReturnLabel(
            tickerDates,
            closes,
            asOfDate,
            alert.finalAction,
            20,
            roundTripCostBps,
          ),
        });
      }
    }
  }

  return {
    generatedAt: now().toISOString(),
    config: resolved,
    summary: {
      rows: rows.length,
      tickers: resolved.tickers.length,
      asOfDates: asOfDates.length,
      rowsWithFallback: rows.filter((row) => row.fallbackHadFallback).length,
      rowsSuppressedByQualityGuard: rows.filter((row) => row.qualityGuardSuppressed).length,
      rowsWithUnavailableEarningsProvenance: rows.filter(
        (row) => row.earningsProvenance.status !== 'available',
      ).length,
      rowsWithUnavailableRegimeProvenance: rows.filter(
        (row) => row.regimeProvenance.status !== 'available',
      ).length,
    },
    rows,
    warnings: Array.from(warnings),
  };
}

export async function persistParityValidationReport(
  report: ParityValidationReport,
): Promise<{ jsonPath: string; csvPath: string }> {
  const dir = path.join(process.cwd(), '.dexter', 'signal-engine', 'validation');
  await mkdir(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const suffix = `${report.config.startDate}-${report.config.endDate}-${report.config.tickers.join('_')}`;
  const jsonPath = path.join(dir, `parity-validation-${suffix}-${stamp}.json`);
  const csvPath = path.join(dir, `parity-validation-${suffix}-${stamp}.csv`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(csvPath, rowsToCsv(report.rows), 'utf8');
  return { jsonPath, csvPath };
}
