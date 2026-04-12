import { runFundamentalAnalysis } from '../agents/analysis/fundamentals.js';
import { runSentimentAnalysis } from '../agents/analysis/sentiment.js';
import { runTechnicalAnalysis } from '../agents/analysis/technical.js';
import { runValuationAnalysis } from '../agents/analysis/valuation.js';
import { reviewRisk } from '../risk/risk.js';
import { logger } from '../utils/logger.js';
import { getWatchlistForTickers } from '../watchlists/watchlists.js';
import { SIGNAL_CONFIG } from './config.js';
import {
  estimateExecutionCosts,
  estimateTargetNotionalUsd,
} from './execution.js';
import { evaluatePortfolioConstraints } from './portfolio-constraints.js';
import { deriveConfidence, resolveAction } from './rules.js';
import { normalizeActionForMode } from './action-normalization.js';
import {
  DataCompleteness,
  ExecutionPlan,
  FallbackEvent,
  PositionPerformance,
  PositionStateInput,
  PreviousSignalSnapshot,
  PositionContext,
  RegionalMarketCheck,
  ScanOptions,
  SignalComponent,
  SignalDelta,
  SignalPayload,
} from './models.js';
import { evaluateRegionalMarketCheck } from './regional-checks.js';
import { AnalysisContext } from '../agents/analysis/types.js';

export interface ScanProviders {
  runTechnicalAnalysis: (
    ticker: string,
    context?: AnalysisContext,
  ) => ReturnType<typeof runTechnicalAnalysis>;
  runFundamentalAnalysis: (
    ticker: string,
    context?: AnalysisContext,
  ) => ReturnType<typeof runFundamentalAnalysis>;
  runSentimentAnalysis: (
    ticker: string,
    context?: AnalysisContext,
  ) => ReturnType<typeof runSentimentAnalysis>;
  runValuationAnalysis: (
    ticker: string,
    context?: AnalysisContext,
  ) => ReturnType<typeof runValuationAnalysis>;
}

const defaultProviders: ScanProviders = {
  runTechnicalAnalysis,
  runFundamentalAnalysis,
  runSentimentAnalysis,
  runValuationAnalysis,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetryAndFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  label: string,
  retrySuggestion: string,
): Promise<{ value: T; event: FallbackEvent }> {
  const maxAttempts = 3;
  const baseDelayMs = 250;
  let attempts = 0;
  let lastError: string | null = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const value = await fn();
      return {
        value,
        event: {
          component: label,
          fallbackUsed: false,
          reason: 'Component succeeded',
          retrySuggestion: 'No retry needed',
          attempts,
          lastError: null,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn(`Signal component ${label} attempt ${attempts} failed: ${lastError}`);
      if (attempts < maxAttempts) {
        await sleep(baseDelayMs * attempts);
      }
    }
  }

  return {
    value: fallback,
    event: {
      component: label,
      fallbackUsed: true,
      reason: `${label} failed after ${maxAttempts} attempts`,
      retrySuggestion,
      attempts: maxAttempts,
      lastError,
    },
  };
}

function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < SIGNAL_CONFIG.risk.correlationMinObservations) return null;
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const meanX = xs.reduce((sum, v) => sum + v, 0) / n;
  const meanY = ys.reduce((sum, v) => sum + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

function averageCorrelationForTicker(
  ticker: string,
  returnsByTicker: Record<string, number[]>,
): number | null {
  const base = returnsByTicker[ticker];
  if (!base) return null;
  const vals: number[] = [];
  for (const [otherTicker, returns] of Object.entries(returnsByTicker)) {
    if (otherTicker === ticker) continue;
    const corr = correlation(base, returns);
    if (corr !== null) vals.push(corr);
  }
  if (!vals.length) return null;
  return vals.reduce((sum, value) => sum + value, 0) / vals.length;
}

function getPositionContext(
  ticker: string,
  positions?: Record<string, PositionContext>,
): PositionContext {
  return positions?.[ticker] ?? { longShares: 0, shortShares: 0 };
}

function estimatePriceFromTechnical(
  technical: Awaited<ReturnType<typeof runTechnicalAnalysis>>,
): number {
  const latest = technical.bars[technical.bars.length - 1];
  if (latest && Number.isFinite(latest.rawClose) && latest.rawClose > 0)
    return latest.rawClose;
  if (latest && Number.isFinite(latest.close) && latest.close > 0) return latest.close;
  return SIGNAL_CONFIG.execution.fallbackEstimatedPrice;
}

function buildPositionPerformance(
  markPrice: number,
  position: PositionContext,
  positionState: PositionStateInput | undefined,
): PositionPerformance {
  const hasOpenPosition = position.longShares > 0 || position.shortShares > 0;
  const isCostBasisAvailable = Boolean(positionState);
  const longCostBasis =
    positionState && position.longShares > 0 ? positionState.longCostBasis : null;
  const shortCostBasis =
    positionState && position.shortShares > 0 ? positionState.shortCostBasis : null;

  const longMarketValueUsd = position.longShares * markPrice;
  const shortMarketValueUsd = position.shortShares * markPrice;
  const netExposureUsd = longMarketValueUsd - shortMarketValueUsd;

  if (!hasOpenPosition) {
    return {
      hasOpenPosition,
      isCostBasisAvailable,
      markPrice: roundTo(markPrice, 2),
      longShares: position.longShares,
      shortShares: position.shortShares,
      longCostBasis,
      shortCostBasis,
      longMarketValueUsd: roundTo(longMarketValueUsd, 2),
      shortMarketValueUsd: roundTo(shortMarketValueUsd, 2),
      netExposureUsd: roundTo(netExposureUsd, 2),
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      realizedPnlUsd: roundTo(positionState?.realizedPnlUsd ?? 0, 2),
      totalPnlUsd: roundTo(positionState?.realizedPnlUsd ?? 0, 2),
      notes: ['No open position'],
    };
  }

  if (!positionState) {
    return {
      hasOpenPosition,
      isCostBasisAvailable,
      markPrice: roundTo(markPrice, 2),
      longShares: position.longShares,
      shortShares: position.shortShares,
      longCostBasis,
      shortCostBasis,
      longMarketValueUsd: roundTo(longMarketValueUsd, 2),
      shortMarketValueUsd: roundTo(shortMarketValueUsd, 2),
      netExposureUsd: roundTo(netExposureUsd, 2),
      unrealizedPnlUsd: null,
      unrealizedPnlPct: null,
      realizedPnlUsd: null,
      totalPnlUsd: null,
      notes: ['Missing cost basis in stored position ledger'],
    };
  }

  const longUnrealized =
    position.longShares > 0 ? (markPrice - positionState.longCostBasis) * position.longShares : 0;
  const shortUnrealized =
    position.shortShares > 0
      ? (positionState.shortCostBasis - markPrice) * position.shortShares
      : 0;
  const unrealizedPnlUsd = longUnrealized + shortUnrealized;
  const grossCostBasis =
    positionState.longCostBasis * position.longShares +
    positionState.shortCostBasis * position.shortShares;
  const unrealizedPnlPct =
    grossCostBasis > 0 ? (unrealizedPnlUsd / grossCostBasis) * 100 : null;
  const realizedPnlUsd = positionState.realizedPnlUsd;
  const totalPnlUsd = realizedPnlUsd + unrealizedPnlUsd;

  return {
    hasOpenPosition,
    isCostBasisAvailable,
    markPrice: roundTo(markPrice, 2),
    longShares: position.longShares,
    shortShares: position.shortShares,
    longCostBasis: longCostBasis === null ? null : roundTo(longCostBasis, 4),
    shortCostBasis: shortCostBasis === null ? null : roundTo(shortCostBasis, 4),
    longMarketValueUsd: roundTo(longMarketValueUsd, 2),
    shortMarketValueUsd: roundTo(shortMarketValueUsd, 2),
    netExposureUsd: roundTo(netExposureUsd, 2),
    unrealizedPnlUsd: roundTo(unrealizedPnlUsd, 2),
    unrealizedPnlPct: unrealizedPnlPct === null ? null : roundTo(unrealizedPnlPct, 4),
    realizedPnlUsd: roundTo(realizedPnlUsd, 2),
    totalPnlUsd: roundTo(totalPnlUsd, 2),
    notes: [],
  };
}

function buildSignalDelta(
  previous: PreviousSignalSnapshot | undefined,
  action: SignalPayload['action'],
  finalAction: SignalPayload['finalAction'],
  confidence: number,
  aggregateScore: number,
  weightedInputs: Record<string, number>,
): SignalDelta {
  if (!previous) {
    return {
      hasPrevious: false,
      previousGeneratedAt: null,
      actionChanged: false,
      finalActionChanged: false,
      confidenceChange: 0,
      aggregateScoreChange: 0,
      weightedInputChanges: {},
      topDrivers: ['No previous scan available'],
    };
  }

  const weightedInputChanges = Object.fromEntries(
    Object.entries(weightedInputs).map(([key, value]) => [
      key,
      value - (previous.weightedInputs[key] ?? 0),
    ]),
  );
  const topDrivers = Object.entries(weightedInputChanges)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([key, value]) => `${key} ${value >= 0 ? '+' : ''}${value.toFixed(3)}`);

  return {
    hasPrevious: true,
    previousGeneratedAt: previous.generatedAt,
    actionChanged: previous.action !== action,
    finalActionChanged: previous.finalAction !== finalAction,
    confidenceChange: confidence - previous.confidence,
    aggregateScoreChange: aggregateScore - previous.aggregateScore,
    weightedInputChanges,
    topDrivers,
  };
}

type InterimAnalysis = {
  ticker: string;
  technical: Awaited<ReturnType<typeof runTechnicalAnalysis>>;
  fundamental: Awaited<ReturnType<typeof runFundamentalAnalysis>>;
  sentiment: Awaited<ReturnType<typeof runSentimentAnalysis>>;
  valuation: Awaited<ReturnType<typeof runValuationAnalysis>>;
  fallbackEvents: FallbackEvent[];
};

function hasFallback(events: FallbackEvent[], component: string): boolean {
  return events.some((event) => event.component === component && event.fallbackUsed);
}

function coreFallbackRatio(events: FallbackEvent[]): number {
  const core = ['technical', 'fundamental', 'sentiment', 'valuation'];
  const failed = core.filter((component) => hasFallback(events, component)).length;
  return failed / core.length;
}

function detectDataFallbacks(
  ticker: string,
  technical: Awaited<ReturnType<typeof runTechnicalAnalysis>>,
  fundamental: Awaited<ReturnType<typeof runFundamentalAnalysis>>,
  valuation: Awaited<ReturnType<typeof runValuationAnalysis>>,
): FallbackEvent[] {
  const events: FallbackEvent[] = [];
  if (technical.bars.length < 20) {
    events.push({
      component: 'technical',
      fallbackUsed: true,
      reason: `Insufficient price history for ${ticker} (${technical.bars.length} bars)`,
      retrySuggestion:
        'Retry after market close, confirm ticker/exchange mapping, and verify price API coverage.',
      attempts: 0,
      lastError: null,
    });
  }

  const metricsPresent = Object.values(fundamental.metrics).some((value) => value !== undefined);
  if (!metricsPresent) {
    events.push({
      component: 'fundamental',
      fallbackUsed: true,
      reason: `No fundamental metrics returned for ${ticker}`,
      retrySuggestion:
        'Retry with valid FINANCIAL_DATASETS_API_KEY and verify the issuer reports on supported endpoints.',
      attempts: 0,
      lastError: null,
    });
  }

  if (!valuation.marketCap || valuation.marketCap <= 0) {
    events.push({
      component: 'valuation',
      fallbackUsed: true,
      reason: `Valuation inputs incomplete for ${ticker} (missing market cap/financial statements)`,
      retrySuggestion:
        'Retry later and verify market-cap + financial statement endpoints for this ticker.',
      attempts: 0,
      lastError: null,
    });
  }

  return events;
}

function evaluateDataCompleteness(
  technical: Awaited<ReturnType<typeof runTechnicalAnalysis>>,
  fundamental: Awaited<ReturnType<typeof runFundamentalAnalysis>>,
  sentiment: Awaited<ReturnType<typeof runSentimentAnalysis>>,
  valuation: Awaited<ReturnType<typeof runValuationAnalysis>>,
): DataCompleteness {
  const barsCount = technical.bars.length;
  const technicalScore = clamp(barsCount / 120, 0, 1);
  const fundamentalMetricCount = Object.values(fundamental.metrics).filter(
    (value) => value !== undefined,
  ).length;
  const fundamentalScore = clamp(fundamentalMetricCount / 8, 0, 1);
  const valuationMethodCount = Object.values(valuation.methods).filter(
    (method) => Number.isFinite(method.value) && method.value > 0,
  ).length;
  const valuationScore =
    valuation.marketCap > 0 ? clamp(valuationMethodCount / 4, 0, 1) : 0;
  const sentimentSignals = sentiment.positive + sentiment.negative;
  const sentimentScore = sentimentSignals > 0 ? 1 : 0.5;

  const score = roundTo(
    technicalScore * 0.35 +
      fundamentalScore * 0.3 +
      valuationScore * 0.3 +
      sentimentScore * 0.05,
    4,
  );
  const missingCritical: string[] = [];
  if (barsCount < 20) missingCritical.push('technical.price_history');
  if (fundamentalMetricCount === 0) missingCritical.push('fundamental.metrics');
  if (valuation.marketCap <= 0 || valuationMethodCount === 0) {
    missingCritical.push('valuation.core_inputs');
  }

  const notes = [
    `Technical bars: ${barsCount}`,
    `Fundamental metrics present: ${fundamentalMetricCount}`,
    `Valuation methods with valid value: ${valuationMethodCount}`,
    `Sentiment signal count: ${sentimentSignals}`,
  ];
  if (fundamental.pitAvailabilityMissing)
    notes.push('Fundamentals missing explicit PIT availability timestamp');
  if (valuation.pitAvailabilityMissing)
    notes.push('Valuation inputs missing explicit PIT availability timestamp');
  if (sentiment.pitAvailabilityMissing)
    notes.push('Sentiment inputs missing explicit PIT availability timestamp');
  const status: DataCompleteness['status'] =
    missingCritical.length > 0
      ? 'fail'
      : fundamental.pitAvailabilityMissing ||
          valuation.pitAvailabilityMissing ||
          sentiment.pitAvailabilityMissing ||
          score < 0.8
        ? 'warn'
        : 'pass';

  return {
    score,
    status,
    missingCritical,
    notes,
  };
}

export async function runDailyScan(
  options: ScanOptions = {},
  providers: ScanProviders = defaultProviders,
): Promise<{ generatedAt: string; alerts: SignalPayload[] }> {
  const generatedAt = new Date().toISOString();
  const watchlist = getWatchlistForTickers(options.tickers);
  const portfolioValue = options.portfolioValue ?? 100_000;
  const interim: InterimAnalysis[] = [];

  for (const entry of watchlist) {
    const [technicalResult, fundamentalResult, sentimentResult, valuationResult] =
      await Promise.all([
        runWithRetryAndFallback(
        () => providers.runTechnicalAnalysis(entry.ticker, options.analysisContext),
        {
          ticker: entry.ticker,
          score: 0,
          confidence: 0,
            signal: 'neutral' as const,
          volatility: 0.3,
          bars: [],
          returns: [],
          summary: 'Technical data unavailable',
          subSignals: {
            trend: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
            meanReversion: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
            momentum: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
            volatility: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
            statArb: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          },
        },
        'technical',
        'Retry in 5-10 minutes. If still failing, validate historical price endpoint and symbol format.',
      ),
        runWithRetryAndFallback(
        () => providers.runFundamentalAnalysis(entry.ticker, options.analysisContext),
        {
          ticker: entry.ticker,
          score: 0,
          confidence: 0,
          signal: 'neutral' as const,
          pitAvailabilityMissing: false,
          metrics: {},
          summary: 'Fundamental data unavailable',
          pillars: {
            profitability: { signal: 'neutral' as const, score: 0, details: '' },
            growth: { signal: 'neutral' as const, score: 0, details: '' },
            health: { signal: 'neutral' as const, score: 0, details: '' },
            valuationRatios: { signal: 'neutral' as const, score: 0, details: '' },
          },
        },
        'fundamental',
        'Retry after data provider refresh; verify financial-metrics snapshot availability for the ticker.',
      ),
        runWithRetryAndFallback(
        () => providers.runSentimentAnalysis(entry.ticker, options.analysisContext),
        {
          ticker: entry.ticker,
          score: 0,
          summary: 'Sentiment data unavailable',
          positive: 0,
          negative: 0,
          pitAvailabilityMissing: false,
        },
        'sentiment',
        'Retry after 15 minutes; if still empty, treat sentiment as low-priority and use other components.',
      ),
        runWithRetryAndFallback(
        () => providers.runValuationAnalysis(entry.ticker, options.analysisContext),
        {
          ticker: entry.ticker,
          score: 0,
          confidence: 0,
          signal: 'neutral' as const,
          pitAvailabilityMissing: false,
          marketCap: 0,
          weightedGap: 0,
          methods: {
            dcf: { value: 0, gap: 0, signal: 'neutral' as const, details: 'Unavailable' },
            ownerEarnings: { value: 0, gap: 0, signal: 'neutral' as const, details: 'Unavailable' },
            multiples: { value: 0, gap: 0, signal: 'neutral' as const, details: 'Unavailable' },
            residualIncome: { value: 0, gap: 0, signal: 'neutral' as const, details: 'Unavailable' },
          },
          summary: 'Valuation data unavailable',
        },
        'valuation',
        'Retry with fresh financial statements; confirm market cap and cash-flow endpoints respond for this symbol.',
      ),
      ]);

    const technical = technicalResult.value;
    const fundamental = fundamentalResult.value;
    const sentiment = sentimentResult.value;
    const valuation = valuationResult.value;
    const fallbackEvents = [
      technicalResult.event,
      fundamentalResult.event,
      sentimentResult.event,
      valuationResult.event,
      ...detectDataFallbacks(entry.ticker, technical, fundamental, valuation),
    ];
    if (fundamental.pitAvailabilityMissing) {
      fallbackEvents.push({
        component: 'fundamental_pit',
        fallbackUsed: true,
        reason:
          'Fundamentals missing explicit availability timestamp; applied conservative confidence penalty.',
        retrySuggestion:
          'Retry with provider fields that include publish/accepted/available timestamps.',
        attempts: 0,
        lastError: null,
      });
    }
    if (valuation.pitAvailabilityMissing) {
      fallbackEvents.push({
        component: 'valuation_pit',
        fallbackUsed: true,
        reason:
          'Valuation inputs missing explicit availability timestamp; applied conservative confidence penalty.',
        retrySuggestion:
          'Retry with provider fields that include publish/accepted/available timestamps.',
        attempts: 0,
        lastError: null,
      });
    }
    if (sentiment.pitAvailabilityMissing) {
      fallbackEvents.push({
        component: 'sentiment_pit',
        fallbackUsed: true,
        reason:
          'News items missing explicit availability timestamp; applied conservative sentiment penalty.',
        retrySuggestion:
          'Retry with provider fields that include publish/accepted/available timestamps.',
        attempts: 0,
        lastError: null,
      });
    }

    interim.push({
      ticker: entry.ticker,
      technical,
      fundamental,
      sentiment,
      valuation,
      fallbackEvents,
    });
  }

  const returnsByTicker = Object.fromEntries(
    interim.map((item) => [item.ticker, item.technical.returns]),
  );

  const alerts: SignalPayload[] = [];
  for (const item of interim) {
    const entry = watchlist.find((candidate) => candidate.ticker === item.ticker);
    if (!entry) continue;

    const avgCorr = averageCorrelationForTicker(item.ticker, returnsByTicker);
    const risk = reviewRisk(item.technical, item.fundamental, avgCorr);
    const fallbackRatio = coreFallbackRatio(item.fallbackEvents);
    const dataCompleteness = evaluateDataCompleteness(
      item.technical,
      item.fundamental,
      item.sentiment,
      item.valuation,
    );
    const isDegradedDataMode =
      hasFallback(item.fallbackEvents, 'fundamental') || hasFallback(item.fallbackEvents, 'valuation');
    let weightedInputs = {
      technical: item.technical.score * SIGNAL_CONFIG.aggregateWeights.technical,
      fundamentals: item.fundamental.score * SIGNAL_CONFIG.aggregateWeights.fundamentals,
      valuation: item.valuation.score * SIGNAL_CONFIG.aggregateWeights.valuation,
      sentiment: item.sentiment.score * SIGNAL_CONFIG.aggregateWeights.sentiment,
    };
    if (isDegradedDataMode) {
      weightedInputs = {
        technical: item.technical.score * 0.8,
        fundamentals: 0,
        valuation: 0,
        sentiment: item.sentiment.score * 0.2,
      };
      item.fallbackEvents.push({
        component: 'degraded_mode',
        fallbackUsed: true,
        reason: 'Fundamental/valuation coverage degraded; switched to technical+sentiment fallback.',
        retrySuggestion:
          'Restore paid data coverage or switch provider for financial statements/market-cap endpoints.',
        attempts: 0,
        lastError: null,
      });
    }
    const aggregateScore = clamp(
      weightedInputs.technical +
        weightedInputs.fundamentals +
        weightedInputs.valuation +
        weightedInputs.sentiment,
      -1,
      1,
    );
    const positionContext = getPositionContext(item.ticker, options.positions);
    const rawAction = resolveAction(aggregateScore, risk, positionContext);
    const normalizedInitialAction = normalizeActionForMode(
      rawAction,
      'long_only',
      positionContext,
    );
    const action = normalizedInitialAction.canonicalAction;
    const baseConfidence = deriveConfidence(aggregateScore, risk);
    const confidence = isDegradedDataMode
      ? roundTo(baseConfidence * SIGNAL_CONFIG.confidence.degradedDataPenalty, 4)
      : baseConfidence;
    const estimatedPrice = estimatePriceFromTechnical(item.technical);
    const targetNotional = estimateTargetNotionalUsd(
      action,
      risk,
      portfolioValue,
      confidence,
      positionContext,
    );
    let estimatedShares = Math.floor(targetNotional / estimatedPrice);
    if (action === 'SELL') estimatedShares = positionContext.longShares;
    const notionalUsd = estimatedShares * estimatedPrice;
    const costEstimate = estimateExecutionCosts({
      action,
      watchlist: entry,
      position: positionContext,
      confidence,
      aggregateScore,
      notionalUsd,
      config: options.executionConfig,
    });
    const constraints = evaluatePortfolioConstraints({
      action,
      watchlist: entry,
      notionalUsd,
      portfolioValue,
      options,
    });
    const shouldDowngradeToHold =
      action !== 'HOLD' &&
      estimatedShares > 0 &&
      (!costEstimate.isTradeableAfterCosts || !constraints.isAllowed);
    const regionalMarketCheck: RegionalMarketCheck = evaluateRegionalMarketCheck(
      entry,
      item.technical,
    );
    const shouldDowngradeForRegionalChecks =
      action !== 'HOLD' && estimatedShares > 0 && !regionalMarketCheck.isTradeableInRegion;
    const suppressedByQualityGuard =
      fallbackRatio >= SIGNAL_CONFIG.quality.noSignalFallbackRatio;
    const suppressedByDataGap =
      dataCompleteness.status === 'fail' && dataCompleteness.missingCritical.length > 0;
    if (suppressedByQualityGuard) {
      item.fallbackEvents.push({
        component: 'quality_guard',
        fallbackUsed: true,
        reason: `Fallback ratio ${(fallbackRatio * 100).toFixed(1)}% exceeded NO_SIGNAL guard.`,
        retrySuggestion:
          'Do not trade this signal yet. Retry after fixing provider coverage and rerun scan.',
        attempts: 0,
        lastError: null,
      });
    }
    if (suppressedByDataGap) {
      item.fallbackEvents.push({
        component: 'data_completeness',
        fallbackUsed: true,
        reason: `NO_SIGNAL_DATA_GAP: missing critical data [${dataCompleteness.missingCritical.join(', ')}]`,
        retrySuggestion:
          'Retry after market close, verify API quota/plan, and confirm ticker mapping on price + financial endpoints.',
        attempts: 0,
        lastError: null,
      });
    }
    const rawFinalAction =
      suppressedByQualityGuard ||
      suppressedByDataGap ||
      shouldDowngradeToHold ||
      shouldDowngradeForRegionalChecks
        ? 'HOLD'
        : action;
    const normalizedFinalAction = normalizeActionForMode(
      rawFinalAction,
      'long_only',
      positionContext,
    );
    const finalAction = normalizedFinalAction.canonicalAction;
    const delta = buildSignalDelta(
      options.previousSignalsByTicker?.[item.ticker],
      action,
      finalAction,
      confidence,
      aggregateScore,
      weightedInputs,
    );
    const executionPlan: ExecutionPlan = {
      estimatedPrice,
      estimatedShares,
      notionalUsd,
      costEstimate,
      constraints,
    };
    const positionPerformance = buildPositionPerformance(
      estimatedPrice,
      positionContext,
      options.positionStatesByTicker?.[item.ticker],
    );

    const components: SignalComponent[] = [
      {
        name: 'Technical',
        score: item.technical.score,
        details: {
          signal: item.technical.signal,
          summary: item.technical.summary,
          subSignals: item.technical.subSignals,
        },
      },
      {
        name: 'Fundamentals',
        score: item.fundamental.score,
        details: {
          signal: item.fundamental.signal,
          summary: item.fundamental.summary,
          pitAvailabilityMissing: item.fundamental.pitAvailabilityMissing,
          pillars: item.fundamental.pillars,
          metrics: item.fundamental.metrics,
        },
      },
      {
        name: 'Valuation',
        score: item.valuation.score,
        details: {
          signal: item.valuation.signal,
          summary: item.valuation.summary,
          pitAvailabilityMissing: item.valuation.pitAvailabilityMissing,
          weightedGap: item.valuation.weightedGap,
          methods: item.valuation.methods,
        },
      },
      {
        name: 'Sentiment',
        score: item.sentiment.score,
        details: {
          summary: item.sentiment.summary,
          pitAvailabilityMissing: item.sentiment.pitAvailabilityMissing,
          positive: item.sentiment.positive,
          negative: item.sentiment.negative,
        },
      },
    ];

    const payload: SignalPayload = {
      ticker: item.ticker,
      action:
        suppressedByQualityGuard || suppressedByDataGap
          ? 'HOLD'
          : normalizedInitialAction.canonicalAction,
      confidence: suppressedByQualityGuard || suppressedByDataGap ? 0 : confidence,
      finalAction,
      rawAction,
      rawFinalAction,
      actionNormalizationNote:
        normalizedInitialAction.note || normalizedFinalAction.note
          ? [normalizedInitialAction.note, normalizedFinalAction.note]
              .filter(Boolean)
              .join(' | ')
          : null,
      qualityGuard: {
        suppressed: suppressedByQualityGuard || suppressedByDataGap,
        reason: suppressedByDataGap
          ? `NO_SIGNAL_DATA_GAP: ${dataCompleteness.missingCritical.join(', ')}`
          : suppressedByQualityGuard
            ? 'NO_SIGNAL: data quality too degraded'
            : null,
        fallbackRatio: roundTo(fallbackRatio, 4),
      },
      dataCompleteness,
      delta,
      regionalMarketCheck,
      positionContext,
      positionPerformance,
      executionPlan,
      fallbackPolicy: {
        hadFallback: item.fallbackEvents.some((event) => event.fallbackUsed),
        events: item.fallbackEvents,
      },
      reasoning: {
        components,
        risk,
        aggregateScore,
        weightedInputs,
      },
      watchlist: entry,
      generatedAt,
    };

    logger.info(`Generated signal for ${item.ticker}`, payload);
    alerts.push(payload);
  }

  return { generatedAt, alerts };
}
