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
import {
  ExecutionPlan,
  PreviousSignalSnapshot,
  PositionContext,
  RegionalMarketCheck,
  ScanOptions,
  SignalComponent,
  SignalDelta,
  SignalPayload,
} from './models.js';
import { evaluateRegionalMarketCheck } from './regional-checks.js';

export interface ScanProviders {
  runTechnicalAnalysis: typeof runTechnicalAnalysis;
  runFundamentalAnalysis: typeof runFundamentalAnalysis;
  runSentimentAnalysis: typeof runSentimentAnalysis;
  runValuationAnalysis: typeof runValuationAnalysis;
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

async function safeRun<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`Signal component ${label} failed: ${error}`);
    return fallback;
  }
}

function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
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
  if (latest && Number.isFinite(latest.close) && latest.close > 0) return latest.close;
  return SIGNAL_CONFIG.execution.fallbackEstimatedPrice;
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
};

export async function runDailyScan(
  options: ScanOptions = {},
  providers: ScanProviders = defaultProviders,
): Promise<{ generatedAt: string; alerts: SignalPayload[] }> {
  const generatedAt = new Date().toISOString();
  const watchlist = getWatchlistForTickers(options.tickers);
  const portfolioValue = options.portfolioValue ?? 100_000;
  const interim: InterimAnalysis[] = [];

  for (const entry of watchlist) {
    const [technical, fundamental, sentiment, valuation] = await Promise.all([
      safeRun(
        () => providers.runTechnicalAnalysis(entry.ticker),
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
      ),
      safeRun(
        () => providers.runFundamentalAnalysis(entry.ticker),
        {
          ticker: entry.ticker,
          score: 0,
          confidence: 0,
          signal: 'neutral' as const,
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
      ),
      safeRun(
        () => providers.runSentimentAnalysis(entry.ticker),
        {
          ticker: entry.ticker,
          score: 0,
          summary: 'Sentiment data unavailable',
          positive: 0,
          negative: 0,
        },
        'sentiment',
      ),
      safeRun(
        () => providers.runValuationAnalysis(entry.ticker),
        {
          ticker: entry.ticker,
          score: 0,
          confidence: 0,
          signal: 'neutral' as const,
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
      ),
    ]);

    interim.push({ ticker: entry.ticker, technical, fundamental, sentiment, valuation });
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
    const weightedInputs = {
      technical: item.technical.score * SIGNAL_CONFIG.aggregateWeights.technical,
      fundamentals: item.fundamental.score * SIGNAL_CONFIG.aggregateWeights.fundamentals,
      valuation: item.valuation.score * SIGNAL_CONFIG.aggregateWeights.valuation,
      sentiment: item.sentiment.score * SIGNAL_CONFIG.aggregateWeights.sentiment,
    };
    const aggregateScore = clamp(
      weightedInputs.technical +
        weightedInputs.fundamentals +
        weightedInputs.valuation +
        weightedInputs.sentiment,
      -1,
      1,
    );
    const positionContext = getPositionContext(item.ticker, options.positions);
    const action = resolveAction(aggregateScore, risk, positionContext);
    const confidence = deriveConfidence(aggregateScore, risk);
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
    if (action === 'COVER') estimatedShares = positionContext.shortShares;
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
    const finalAction =
      shouldDowngradeToHold || shouldDowngradeForRegionalChecks ? 'HOLD' : action;
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
          weightedGap: item.valuation.weightedGap,
          methods: item.valuation.methods,
        },
      },
      {
        name: 'Sentiment',
        score: item.sentiment.score,
        details: {
          summary: item.sentiment.summary,
          positive: item.sentiment.positive,
          negative: item.sentiment.negative,
        },
      },
    ];

    const payload: SignalPayload = {
      ticker: item.ticker,
      action,
      confidence,
      finalAction,
      delta,
      regionalMarketCheck,
      positionContext,
      executionPlan,
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
