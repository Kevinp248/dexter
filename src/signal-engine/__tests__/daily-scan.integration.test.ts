import { runDailyScan, type ScanProviders } from '../index.js';

function makeProviders(
  technicalScore: number,
  fundamentalScore: number,
  valuationScore: number,
  sentimentScore: number,
  technicalVolatility = 0.18,
): ScanProviders {
  return {
    async runTechnicalAnalysis(ticker: string) {
      return {
        ticker,
        score: technicalScore,
        confidence: Math.abs(technicalScore),
        signal: technicalScore > 0.1 ? 'bullish' as const : technicalScore < -0.1 ? 'bearish' as const : 'neutral' as const,
        volatility: technicalVolatility,
        bars: [],
        returns: Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005)),
        summary: 'Mock technical',
        subSignals: {
          trend: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          meanReversion: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          momentum: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          volatility: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          statArb: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
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
        },
        pillars: {
          profitability: { signal: 'neutral' as const, score: 0, details: 'mock' },
          growth: { signal: 'neutral' as const, score: 0, details: 'mock' },
          health: { signal: 'neutral' as const, score: 0, details: 'mock' },
          valuationRatios: { signal: 'neutral' as const, score: 0, details: 'mock' },
        },
        summary: 'Mock fundamentals',
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
        methods: {
          dcf: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
          ownerEarnings: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
          multiples: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
          residualIncome: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
        },
        summary: 'Mock valuation',
      };
    },

    async runSentimentAnalysis(ticker: string) {
      return {
        ticker,
        score: sentimentScore,
        summary: 'Mock sentiment',
        positive: sentimentScore > 0 ? 3 : 1,
        negative: sentimentScore < 0 ? 3 : 1,
      };
    },
  };
}

describe('runDailyScan deterministic integration', () => {
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

  test('golden scenario: short position and thesis flip -> COVER', async () => {
    const scan = await runDailyScan(
      { tickers: ['NVDA'], positions: { NVDA: { longShares: 0, shortShares: 100 } } },
      makeProviders(0.6, 0.5, 0.5, 0.3, 0.18),
    );
    expect(scan.alerts).toHaveLength(1);
    expect(scan.alerts[0].action).toBe('COVER');
    expect(scan.alerts[0].finalAction).toBe('COVER');
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
});
