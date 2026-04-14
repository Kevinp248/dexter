import { runDailyScan, type ScanProviders } from '../index.js';

function makeProviders(
  technicalScore: number,
  fundamentalScore: number,
  valuationScore: number,
  sentimentScore: number,
  technicalVolatility = 0.18,
  averageDailyDollarVolume = 2_000_000,
  policyOverrides?: {
    nextEarningsDate?: string | null;
    spyCloses?: number[];
    vixClose?: number | null;
  },
): ScanProviders {
  const close = 100;
  const volume = Math.floor(averageDailyDollarVolume / close);
  const bars = Array.from({ length: 120 }, (_, i) => {
    const dt = new Date('2025-08-01T00:00:00.000Z');
    dt.setUTCDate(dt.getUTCDate() + i);
    return {
      date: dt.toISOString().slice(0, 10),
      close,
      rawClose: close,
      volume,
    };
  });

  return {
    async runTechnicalAnalysis(ticker: string) {
      return {
        ticker,
        score: technicalScore,
        confidence: Math.abs(technicalScore),
        signal: technicalScore > 0.1 ? 'bullish' as const : technicalScore < -0.1 ? 'bearish' as const : 'neutral' as const,
        volatility: technicalVolatility,
        bars,
        returns: Array.from({ length: bars.length - 1 }, (_, i) =>
          i % 2 === 0 ? 0.01 : -0.005,
        ),
        summary: 'Mock technical',
        subSignals: {
          trend: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          meanReversion: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          momentum: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          volatility: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          macd: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
        },
      };
    },

    async runFundamentalAnalysis(ticker: string) {
      return {
        ticker,
        score: fundamentalScore,
        confidence: Math.abs(fundamentalScore),
        signal: fundamentalScore > 0.1 ? 'bullish' as const : fundamentalScore < -0.1 ? 'bearish' as const : 'neutral' as const,
        metrics: {
          peRatio: 20,
          debtToEquity: 0.4,
          roic: 0.11,
        },
        pillars: {
          profitability: { signal: 'neutral' as const, score: 0, details: 'mock' },
          growth: { signal: 'neutral' as const, score: 0, details: 'mock' },
          health: { signal: 'neutral' as const, score: 0, details: 'mock' },
          cashFlowQuality: { signal: 'neutral' as const, score: 0, details: 'mock' },
          capitalEfficiency: { signal: 'neutral' as const, score: 0, details: 'mock' },
          valuationRatios: { signal: 'neutral' as const, score: 0, details: 'mock' },
        },
        summary: 'Mock fundamentals',
        pitAvailabilityMissing: false,
      };
    },

    async runValuationAnalysis(ticker: string) {
      return {
        ticker,
        score: valuationScore,
        confidence: Math.abs(valuationScore),
        signal: valuationScore > 0.1 ? 'bullish' as const : valuationScore < -0.1 ? 'bearish' as const : 'neutral' as const,
        marketCap: 100,
        weightedGap: valuationScore * 0.3,
        context: {
          sector: 'Technology',
          fairPeBase: 20,
          fairPeAdjusted: 22,
          pegGrowthUsed: 0.05,
          role: 'context_modifier' as const,
        },
        methods: {
          dcf: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
          ownerEarnings: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
          multiples: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
          residualIncome: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
        },
        summary: 'Mock valuation',
        pitAvailabilityMissing: false,
      };
    },

    async runSentimentAnalysis(ticker: string) {
      return {
        ticker,
        score: sentimentScore,
        summary: 'Mock sentiment',
        positive: sentimentScore > 0 ? 3 : 1,
        negative: sentimentScore < 0 ? 3 : 1,
        provider: 'structured_news' as const,
        articleCount: 4,
        usedArticleCount: 4,
        ignoredArticleCount: 0,
        pitAvailabilityMissing: false,
        evidence: [],
      };
    },
    async fetchUpcomingEarningsDate() {
      return policyOverrides?.nextEarningsDate !== undefined
        ? policyOverrides.nextEarningsDate
        : '2026-02-15';
    },
    async fetchMarketRegimeInputs() {
      return {
        spyCloses:
          policyOverrides?.spyCloses ??
          Array.from({ length: 220 }, (_, i) => 450 + i * 0.2),
        vixClose: policyOverrides?.vixClose ?? 18,
      };
    },
  };
}

describe('runDailyScan deterministic integration', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('golden scenario: strong bullish stack -> BUY', async () => {
    const scan = await runDailyScan(
      { tickers: ['AAPL'] },
      makeProviders(0.9, 0.8, 0.85, 0.7, 0.16),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('BUY');
    expect(scan.alerts[0].finalAction).toBe('BUY');
  });

  test('golden scenario: strong bearish stack -> SELL', async () => {
    const scan = await runDailyScan(
      { tickers: ['MSFT'], positions: { MSFT: { longShares: 50, shortShares: 0 } } },
      makeProviders(-0.9, -0.8, -0.85, -0.7, 0.24),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('SELL');
    expect(scan.alerts[0].finalAction).toBe('SELL');
  });

  test('golden scenario: mixed/conflicted signals -> HOLD', async () => {
    const scan = await runDailyScan(
      { tickers: ['SHOP'] },
      makeProviders(0.25, -0.2, 0.1, -0.05, 0.22),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('HOLD');
    expect(scan.alerts[0].finalAction).toBe('HOLD');
  });

  test('golden scenario: short position and thesis flip -> HOLD (canonical long-only)', async () => {
    const scan = await runDailyScan(
      { tickers: ['NVDA'], positions: { NVDA: { longShares: 0, shortShares: 100 } } },
      makeProviders(0.6, 0.5, 0.5, 0.3, 0.18),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].rawAction).toBe('COVER');
    expect(scan.alerts[0].action).toBe('HOLD');
    expect(scan.alerts[0].finalAction).toBe('HOLD');
  });

  test('portfolio cap breach downgrades BUY to HOLD', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
        portfolioValue: 100_000,
        portfolioContext: {
          grossExposurePct: 0.98,
          maxGrossExposurePct: 1.0,
        },
      },
      makeProviders(0.95, 0.9, 0.9, 0.6, 0.14),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('BUY');
    expect(scan.alerts[0].finalAction).toBe('HOLD');
    expect(scan.alerts[0].executionPlan.constraints.isAllowed).toBe(false);
  });

  test('execution cost stress downgrades BUY to HOLD', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
        executionConfig: {
          costMultiplier: 8,
          minimumEdgeAfterCostsBps: 100,
        },
      },
      makeProviders(0.7, 0.6, 0.65, 0.4, 0.2),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('BUY');
    expect(scan.alerts[0].finalAction).toBe('HOLD');
    expect(scan.alerts[0].executionPlan.costEstimate.isTradeableAfterCosts).toBe(false);
    expect(scan.alerts[0].executionPlan.costEstimate.costChangedAction).toBe(true);
  });

  test('earnings blackout suppresses BUY to HOLD', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
        analysisContext: { asOfDate: '2026-01-02' },
      },
      makeProviders(0.85, 0.75, 0.7, 0.5, 0.18, 2_000_000, {
        nextEarningsDate: '2026-01-06',
      }),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('BUY');
    expect(scan.alerts[0].finalAction).toBe('HOLD');
    expect(scan.alerts[0].earningsRisk.reasonCode).toBe('EARNINGS_BLACKOUT_BUY_SUPPRESSED');
  });

  test('missing earnings coverage defaults to warn_only and does not suppress BUY', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
        analysisContext: { asOfDate: '2026-01-02' },
        earningsConfig: { missingCoveragePolicy: 'warn_only' },
      },
      makeProviders(0.9, 0.8, 0.75, 0.5, 0.18, 2_000_000, {
        nextEarningsDate: null,
      }),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('BUY');
    expect(scan.alerts[0].finalAction).toBe('BUY');
    expect(scan.alerts[0].earningsRisk.policyApplied).toBe('warn_only');
    expect(scan.alerts[0].earningsRisk.reasonCode).toBe('EARNINGS_COVERAGE_WARN');
  });

  test('risk_off regime raises buy threshold and caps confidence/allocation', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
      },
      makeProviders(0.6, 0.55, 0.5, 0.45, 0.18, 2_000_000, {
        spyCloses: Array.from({ length: 220 }, (_, i) => 500 - i * 0.5),
        vixClose: 32,
      }),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].marketRegime.state).toBe('risk_off');
    expect(scan.alerts[0].finalAction).toBe('HOLD');
    expect(scan.alerts[0].confidence).toBeLessThanOrEqual(70);
    expect(scan.alerts[0].reasoning.risk.maxAllocation).toBeLessThan(0.2);
  });

  test('regime_unknown applies conservative caps with explicit reason', async () => {
    const scan = await runDailyScan(
      { tickers: ['AAPL'] },
      makeProviders(0.9, 0.8, 0.75, 0.4, 0.18, 2_000_000, {
        spyCloses: Array.from({ length: 20 }, () => 500),
        vixClose: 18,
      }),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].marketRegime.state).toBe('regime_unknown');
    expect(scan.alerts[0].marketRegime.reasonCode).toContain('REGIME_UNKNOWN');
    expect(scan.alerts[0].confidence).toBeLessThanOrEqual(60);
  });

  test('high-correlation basket applies conservative correlation multiplier', async () => {
    const scan = await runDailyScan(
      { tickers: ['AAPL', 'MSFT'] },
      makeProviders(0.65, 0.55, 0.5, 0.3, 0.2),
    );
    expect(scan.alerts).toHaveLength(2);
    for (const alert of scan.alerts) {
      expect(alert.reasoning.risk.averageCorrelation).not.toBeNull();
      expect(alert.reasoning.risk.correlationMultiplier).toBe(0.7);
    }
  });

  test('canadian low-liquidity check downgrades BUY to HOLD', async () => {
    const scan = await runDailyScan(
      { tickers: ['SHOP'] },
      makeProviders(0.95, 0.8, 0.75, 0.4, 0.2, 100_000),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('BUY');
    expect(scan.alerts[0].regionalMarketCheck.isTradeableInRegion).toBe(false);
    expect(scan.alerts[0].finalAction).toBe('HOLD');
  });

  test('critical data gaps are marked as NO_SIGNAL_DATA_GAP', async () => {
    const base = makeProviders(0.8, 0.7, 0.7, 0.3, 0.2);
    const gapProviders: ScanProviders = {
      ...base,
      async runTechnicalAnalysis(ticker: string) {
        const technical = await base.runTechnicalAnalysis(ticker);
        return { ...technical, bars: [], returns: [] };
      },
      async runFundamentalAnalysis(ticker: string) {
        const fundamental = await base.runFundamentalAnalysis(ticker);
        return { ...fundamental, metrics: {} };
      },
      async runValuationAnalysis(ticker: string) {
        const valuation = await base.runValuationAnalysis(ticker);
        return {
          ...valuation,
          marketCap: 0,
          methods: {
            ...valuation.methods,
            dcf: { ...valuation.methods.dcf, value: 0 },
            ownerEarnings: { ...valuation.methods.ownerEarnings, value: 0 },
            multiples: { ...valuation.methods.multiples, value: 0 },
            residualIncome: { ...valuation.methods.residualIncome, value: 0 },
          },
        };
      },
    };

    const scan = await runDailyScan({ tickers: ['AAPL'] }, gapProviders);
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('HOLD');
    expect(scan.alerts[0].finalAction).toBe('HOLD');
    expect(scan.alerts[0].qualityGuard?.suppressed).toBe(true);
    expect(scan.alerts[0].qualityGuard?.reason).toContain('NO_SIGNAL_DATA_GAP');
    expect(scan.alerts[0].dataCompleteness.status).toBe('fail');
    expect(scan.alerts[0].dataCompleteness.missingCritical.length).toBeGreaterThan(0);
  });

  test('snapshot: full output shape remains stable', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['SHOP'],
        portfolioValue: 120_000,
        portfolioContext: {
          grossExposurePct: 0.3,
          maxGrossExposurePct: 1.0,
          sectorExposurePct: { 'E-commerce': 0.15 },
          maxSectorExposurePct: 0.4,
        },
      },
      makeProviders(0.4, 0.2, 0.3, 0.1, 0.2),
    );
    expect(scan).toMatchSnapshot();
  });

  test('delta explains action and aggregate changes versus previous scan', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
        previousSignalsByTicker: {
          AAPL: {
            generatedAt: '2025-12-31T00:00:00.000Z',
            action: 'HOLD',
            finalAction: 'HOLD',
            confidence: 42,
            aggregateScore: 0.01,
            weightedInputs: {
              technical: 0.01,
              fundamentals: 0.0,
              valuation: 0.0,
              sentiment: 0.0,
            },
          },
        },
      },
      makeProviders(0.9, 0.8, 0.85, 0.7, 0.16),
    );

    expect(scan.alerts).toHaveLength(1);
    const delta = scan.alerts[0].delta;
    expect(delta.hasPrevious).toBe(true);
    expect(delta.actionChanged).toBe(true);
    expect(delta.finalActionChanged).toBe(true);
    expect(delta.aggregateScoreChange).toBeGreaterThan(0);
    expect(delta.topDrivers.length).toBeGreaterThan(0);
  });

  test('fallback policy reports reason and retry guidance when a component fails', async () => {
    jest.useRealTimers();
    const base = makeProviders(0.4, 0.3, 0.35, 0.2, 0.2);
    const failingProviders: ScanProviders = {
      ...base,
      async runFundamentalAnalysis() {
        throw new Error('simulated fundamentals API timeout');
      },
    };

    const scan = await runDailyScan({ tickers: ['AAPL'] }, failingProviders);
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].fallbackPolicy.hadFallback).toBe(true);
    const fundamentalEvent = scan.alerts[0].fallbackPolicy.events.find(
      (event) => event.component === 'fundamental',
    );
    expect(fundamentalEvent?.fallbackUsed).toBe(true);
    expect(fundamentalEvent?.reason).toContain('failed after');
    expect(fundamentalEvent?.retrySuggestion).toContain('Retry');
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
  });

  test('position performance includes mark-to-market PnL when cost basis is available', async () => {
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
        positions: {
          AAPL: {
            longShares: 10,
            shortShares: 0,
          },
        },
        positionStatesByTicker: {
          AAPL: {
            longShares: 10,
            shortShares: 0,
            longCostBasis: 95,
            shortCostBasis: 0,
            realizedPnlUsd: 12.5,
            totalFeesUsd: 1,
            lastTradeAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
      makeProviders(0.6, 0.6, 0.6, 0.3, 0.18),
    );

    expect(scan.alerts).toHaveLength(1);
    const perf = scan.alerts[0].positionPerformance;
    expect(perf.hasOpenPosition).toBe(true);
    expect(perf.isCostBasisAvailable).toBe(true);
    expect(perf.unrealizedPnlUsd).toBe(50);
    expect(perf.realizedPnlUsd).toBe(12.5);
    expect(perf.totalPnlUsd).toBe(62.5);
  });
});
