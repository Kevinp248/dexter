import { runDailyScan, type ScanProviders } from '../index.js';
import { buildParityValidationReport } from '../validation/parity-validation.js';
import { PriceBar } from '../../data/market.js';

function makeBars(startDate: string, days: number, startPrice: number): PriceBar[] {
  const out: PriceBar[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  let price = startPrice;
  while (out.length < days) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push({
        date: cursor.toISOString().slice(0, 10),
        open: price,
        high: price + 1,
        low: price - 1,
        close: price + 0.5,
        adjustedClose: price + 0.5,
        volume: 1_000_000,
      });
      price += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function makeProviders(capture?: {
  regimeAsOfDates?: string[];
  earningsAsOfByTicker?: Array<{ ticker: string; asOfDate: string | null }>;
},
scores: {
  technical?: number;
  fundamentals?: number;
  valuation?: number;
  sentiment?: number;
} = {}): ScanProviders {
  const bars = makeBars('2026-01-01', 260, 100);
  const technicalScore = scores.technical ?? 0.8;
  const fundamentalsScore = scores.fundamentals ?? 0.65;
  const valuationScore = scores.valuation ?? 0.4;
  const sentimentScore = scores.sentiment ?? 0.35;

  return {
    async runTechnicalAnalysis(ticker: string) {
      return {
        ticker,
        score: technicalScore,
        confidence: Math.abs(technicalScore),
        signal:
          technicalScore > 0.1
            ? 'bullish'
            : technicalScore < -0.1
              ? 'bearish'
              : 'neutral',
        volatility: 0.18,
        bars: bars.slice(-120).map((bar) => ({
          date: bar.date,
          close: bar.adjustedClose,
          rawClose: bar.close,
          volume: bar.volume,
        })),
        returns: Array.from({ length: 119 }, (_, idx) => (idx % 2 === 0 ? 0.01 : -0.004)),
        summary: 'mock technical',
        subSignals: {
          trend: { signal: 'bullish' as const, confidence: 0.7, score: 0.7, metrics: {} },
          meanReversion: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          momentum: { signal: 'bullish' as const, confidence: 0.7, score: 0.7, metrics: {} },
          volatility: { signal: 'neutral' as const, confidence: 0.5, score: 0, metrics: {} },
          macd: { signal: 'bullish' as const, confidence: 0.7, score: 0.7, metrics: {} },
        },
      };
    },
    async runFundamentalAnalysis(ticker: string) {
      return {
        ticker,
        score: fundamentalsScore,
        confidence: Math.abs(fundamentalsScore),
        signal:
          fundamentalsScore > 0.1
            ? 'bullish'
            : fundamentalsScore < -0.1
              ? 'bearish'
              : 'neutral',
        pitAvailabilityMissing: false,
        metrics: { peRatio: 20, debtToEquity: 0.4, roic: 0.12 },
        pillars: {
          profitability: { signal: 'bullish' as const, score: 0.6, details: 'mock' },
          growth: { signal: 'bullish' as const, score: 0.6, details: 'mock' },
          health: { signal: 'neutral' as const, score: 0, details: 'mock' },
          cashFlowQuality: { signal: 'neutral' as const, score: 0, details: 'mock' },
          capitalEfficiency: { signal: 'bullish' as const, score: 0.5, details: 'mock' },
          valuationRatios: { signal: 'neutral' as const, score: 0, details: 'mock' },
        },
        summary: 'mock fundamental',
      };
    },
    async runSentimentAnalysis(ticker: string) {
      return {
        ticker,
        score: sentimentScore,
        summary: 'mock sentiment',
        positive: sentimentScore > 0 ? 3 : 1,
        negative: sentimentScore < 0 ? 3 : 1,
        provider: 'structured_news' as const,
        articleCount: 5,
        usedArticleCount: 5,
        ignoredArticleCount: 0,
        pitAvailabilityMissing: false,
        evidence: [],
      };
    },
    async runValuationAnalysis(ticker: string) {
      return {
        ticker,
        score: valuationScore,
        confidence: Math.abs(valuationScore),
        signal:
          valuationScore > 0.1
            ? 'bullish'
            : valuationScore < -0.1
              ? 'bearish'
              : 'neutral',
        pitAvailabilityMissing: false,
        marketCap: 100,
        weightedGap: 0.1,
        context: {
          sector: 'Technology',
          fairPeBase: 20,
          fairPeAdjusted: 21,
          pegGrowthUsed: 0.06,
          role: 'context_modifier' as const,
        },
        methods: {
          dcf: { value: 100, gap: 0.1, signal: 'bullish' as const, details: 'mock' },
          ownerEarnings: { value: 100, gap: 0.1, signal: 'bullish' as const, details: 'mock' },
          multiples: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
          residualIncome: { value: 100, gap: 0, signal: 'neutral' as const, details: 'mock' },
        },
        summary: 'mock valuation',
      };
    },
    async fetchUpcomingEarningsDate(ticker: string, context) {
      capture?.earningsAsOfByTicker?.push({
        ticker,
        asOfDate: context?.asOfDate?.slice(0, 10) ?? null,
      });
      return '2026-12-15';
    },
    async fetchMarketRegimeInputs(context) {
      capture?.regimeAsOfDates?.push(context?.asOfDate?.slice(0, 10) ?? '');
      return {
        spyCloses: Array.from({ length: 220 }, (_, i) => 450 + i * 0.2),
        vixClose: 18,
      };
    },
  };
}

describe('parity validation harness', () => {
  test('parity harness finalAction equals runDailyScan finalAction', async () => {
    const providers = makeProviders();
    const bars = makeBars('2026-01-01', 30, 100);
    const scan = await runDailyScan(
      {
        tickers: ['AAPL'],
        analysisContext: { asOfDate: bars[0].date, strictPointInTime: true },
      },
      providers,
    );

    const report = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[0].date,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
      },
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].finalAction).toBe(scan.alerts[0].finalAction);
  });

  test('no profile overrides are applied', async () => {
    const providers = makeProviders();
    const bars = makeBars('2026-01-01', 5, 100);
    const report = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
      },
    );

    expect(report.rows.every((row) => row.finalAction === 'BUY')).toBe(true);
  });

  test('no stop-loss/take-profit/max-hold overlays are applied', async () => {
    const providers = makeProviders();
    const bars = makeBars('2026-01-01', 12, 100);
    const report = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
      },
    );

    // Validation rows are direct daily scan outputs and remain BUY without backtest overlays.
    expect(report.rows.length).toBeGreaterThan(3);
    expect(report.rows.every((row) => row.finalAction === 'BUY')).toBe(true);
  });

  test('historical regime provider uses asOfDate', async () => {
    const capture = { regimeAsOfDates: [] as string[] };
    const providers = makeProviders(capture);
    const bars = makeBars('2026-01-01', 6, 100);

    await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
      },
    );

    const uniqueAsOf = Array.from(new Set(capture.regimeAsOfDates));
    expect(uniqueAsOf).toEqual(bars.map((bar) => bar.date));
  });

  test('historical earnings provider uses asOfDate or records unavailable provenance', async () => {
    const capture = { earningsAsOfByTicker: [] as Array<{ ticker: string; asOfDate: string | null }> };
    const providers: ScanProviders = {
      ...makeProviders(capture),
      async fetchUpcomingEarningsDate(ticker, context) {
        capture.earningsAsOfByTicker.push({ ticker, asOfDate: context?.asOfDate?.slice(0, 10) ?? null });
        return null;
      },
    };
    const bars = makeBars('2026-01-01', 3, 100);

    const report = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
      },
    );

    expect(capture.earningsAsOfByTicker.map((item) => item.asOfDate)).toEqual(
      bars.map((bar) => bar.date),
    );
    expect(report.rows.every((row) => row.earningsProvenance.status === 'unavailable')).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('No upcoming earnings date'))).toBe(true);
  });

  test('forward-return labels are deterministic and action-aware after-costs are BUY-only', async () => {
    const providers = makeProviders();
    const bars = makeBars('2026-01-01', 30, 100);

    const one = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
      },
    );
    const two = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
      },
    );

    expect(one.rows).toEqual(two.rows);
    const row = one.rows.find((item) => item.forward1d.isLabelAvailable);
    expect(row).toBeDefined();
    expect(row!.forward1d.basis).toBe('close_to_close');
    expect(row!.forward1d.directionalAfterCostsAssumption).toBe('buy_round_trip');
    const expected =
      (row!.forward1d.directionalReturnPct as number) - row!.roundTripCostBps / 10_000;
    expect(row!.forward1d.directionalReturnAfterCostsPct).toBeCloseTo(expected, 8);
  });

  test('SELL labels invert direction and HOLD labels avoid generic trade-cost deduction', async () => {
    const bars = makeBars('2026-01-01', 30, 100);
    const sellProviders = makeProviders(
      undefined,
      { technical: -0.9, fundamentals: -0.8, valuation: -0.7, sentiment: -0.5 },
    );
    const holdProviders = makeProviders(
      undefined,
      { technical: 0.02, fundamentals: 0.01, valuation: 0.0, sentiment: 0.0 },
    );

    const sellReport = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
        scanOptions: {
          positions: {
            AAPL: { longShares: 10, shortShares: 0 },
          },
        },
      },
      {
        baseProviders: sellProviders,
        fetchHistoricalPricesFn: async () => bars,
      },
    );
    const holdReport = await buildParityValidationReport(
      {
        tickers: ['AAPL'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
      },
      {
        baseProviders: holdProviders,
        fetchHistoricalPricesFn: async () => bars,
      },
    );

    const sellRow = sellReport.rows.find((row) => row.forward1d.isLabelAvailable);
    expect(sellRow).toBeDefined();
    expect(sellRow!.finalAction).toBe('SELL');
    expect(sellRow!.forward1d.directionalReturnPct).toBeCloseTo(
      -(sellRow!.forward1d.closeToCloseReturnPct as number),
      8,
    );
    expect(sellRow!.forward1d.directionalReturnAfterCostsPct).toBeCloseTo(
      sellRow!.forward1d.directionalReturnPct as number,
      8,
    );
    expect(sellRow!.forward1d.directionalAfterCostsAssumption).toBe('sell_zero_cost_avoidance');

    const holdRow = holdReport.rows.find((row) => row.finalAction === 'HOLD');
    expect(holdRow).toBeDefined();
    expect(holdRow!.forward1d.directionalReturnPct).toBeNull();
    expect(holdRow!.forward1d.directionalReturnAfterCostsPct).toBeNull();
    expect(holdRow!.forward1d.directionalAfterCostsAssumption).toBe('none');
    expect(holdRow!.forward1d.isDirectionalAfterCostsLabelAvailable).toBe(false);
  });

  test('multi-ticker validation preserves cross-ticker scan context', async () => {
    const providers = makeProviders();
    const calls: string[][] = [];
    const bars = makeBars('2026-01-01', 4, 100);

    await buildParityValidationReport(
      {
        tickers: ['AAPL', 'MSFT'],
        startDate: bars[0].date,
        endDate: bars[bars.length - 1].date,
        watchlistSliceSize: 10,
      },
      {
        baseProviders: providers,
        fetchHistoricalPricesFn: async () => bars,
        runDailyScanFn: async (options, scanProviders) => {
          calls.push([...(options?.tickers ?? [])]);
          return runDailyScan(options, scanProviders);
        },
      },
    );

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((tickers) => tickers.length === 2)).toBe(true);
  });
});
