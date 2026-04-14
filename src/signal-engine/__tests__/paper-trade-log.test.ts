import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { appendScanAlertsToPaperTradeLog } from '../paper-trade-log.js';
import { SignalPayload } from '../models.js';

function makeAlert(overrides: Partial<SignalPayload> = {}): SignalPayload {
  return {
    ticker: 'AAPL',
    action: 'HOLD',
    confidence: 29.05,
    finalAction: 'HOLD',
    rawAction: 'HOLD',
    rawFinalAction: 'HOLD',
    actionNormalizationNote: null,
    earningsRisk: {
      nextEarningsDate: null,
      tradingDaysToEarnings: null,
      coverageStatus: 'missing',
      inBlackoutWindow: false,
      policyApplied: 'warn_only',
      reasonCode: 'EARNINGS_COVERAGE_WARN',
    },
    marketRegime: {
      state: 'regime_unknown',
      reasonCode: 'REGIME_UNKNOWN_MISSING_SPY',
      inputs: {
        asOfDate: '2026-04-09',
        spyClose: null,
        spySma: null,
        vixClose: null,
        lookbackDays: 200,
      },
      policyAdjustmentsApplied: {
        buyThresholdAdd: 0,
        confidenceCap: 60,
        maxAllocationMultiplier: 0.6,
        strictBuyGate: false,
      },
    },
    dataCompleteness: {
      score: 0.92,
      status: 'pass',
      missingCritical: [],
      notes: [],
    },
    delta: {
      hasPrevious: true,
      previousGeneratedAt: '2026-04-09T07:00:00.000Z',
      actionChanged: false,
      finalActionChanged: false,
      confidenceChange: 0,
      aggregateScoreChange: 0,
      weightedInputChanges: {},
      topDrivers: ['technical +0.000'],
    },
    regionalMarketCheck: {
      isTradeableInRegion: true,
      checks: ['No regional restrictions triggered'],
      averageDollarVolume20d: null,
    },
    positionContext: {
      longShares: 10,
      shortShares: 0,
    },
    positionPerformance: {
      hasOpenPosition: true,
      isCostBasisAvailable: true,
      markPrice: 253.5,
      longShares: 10,
      shortShares: 0,
      longCostBasis: 253.6,
      shortCostBasis: null,
      longMarketValueUsd: 2535,
      shortMarketValueUsd: 0,
      netExposureUsd: 2535,
      unrealizedPnlUsd: -1,
      unrealizedPnlPct: -0.0394,
      realizedPnlUsd: 0,
      totalPnlUsd: -1,
      notes: [],
    },
    executionPlan: {
      estimatedPrice: 253.5,
      estimatedShares: 0,
      notionalUsd: 0,
      costEstimate: {
        expectedEdgePreCostBps: 42.11,
        oneWayCostBps: 13,
        roundTripCostBps: 26,
        costBreakdownBps: {
          spread: 5,
          slippage: 7,
          fee: 1,
          borrow: 0,
          oneWay: 13,
          roundTrip: 26,
        },
        estimatedRoundTripCostUsd: 0,
        expectedEdgeBps: 42.11,
        expectedEdgePostCostBps: 16.11,
        expectedEdgeAfterCostsBps: 16.11,
        minEdgeThresholdBps: 0,
        isTradeableAfterCosts: true,
        costChangedAction: false,
        assumptionSource: 'default',
        assumptionVersion: 'execution-defaults-v1',
        assumptionSnapshotId: 'execution-defaults-v1|cm=1.0000|minEdge=0.00|hold=5',
      },
      constraints: {
        isAllowed: true,
        blockedReasons: [],
        projectedGrossExposurePct: 0,
        projectedSectorExposurePct: 0,
      },
    },
    fallbackPolicy: {
      hadFallback: false,
      events: [],
    },
    reasoning: {
      components: [],
      risk: {
        ticker: 'AAPL',
        riskScore: 0.73,
        maxAllocation: 0.19,
        basePositionLimitPct: 0.19,
        correlationMultiplier: 1,
        combinedLimitPct: 0.19,
        annualizedVolatility: 0.2,
        averageCorrelation: null,
        checks: [],
      },
      aggregateScore: -0.09,
      weightedInputs: {
        technical: -0.01,
        fundamentals: 0.06,
        valuation: -0.3,
        sentiment: 0.15,
      },
    },
    watchlist: {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      region: 'US',
      exchange: 'NASDAQ',
      currency: 'USD',
      sector: 'Technology',
      rationale: 'test',
    },
    generatedAt: '2026-04-09T18:40:44.324Z',
    ...overrides,
  };
}

describe('paper trade CSV append', () => {
  test('creates header once, dedupes same day/ticker, and supports multiple tickers', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dexter-paper-log-'));
    const csvPath = path.join(dir, 'paper-trade-log.csv');

    const first = await appendScanAlertsToPaperTradeLog(
      {
        generatedAt: '2026-04-09T18:40:44.324Z',
        alerts: [makeAlert()],
      },
      csvPath,
    );
    expect(first.rowsAppended).toBe(1);
    expect(first.rowsSkipped).toBe(0);

    // Same day + same ticker should dedupe.
    const second = await appendScanAlertsToPaperTradeLog(
      {
        generatedAt: '2026-04-09T20:00:00.000Z',
        alerts: [makeAlert({ generatedAt: '2026-04-09T20:00:00.000Z' })],
      },
      csvPath,
    );
    expect(second.rowsAppended).toBe(0);
    expect(second.rowsSkipped).toBe(1);

    // Different ticker on same day should append.
    const third = await appendScanAlertsToPaperTradeLog(
      {
        generatedAt: '2026-04-09T21:00:00.000Z',
        alerts: [makeAlert({ ticker: 'MSFT', generatedAt: '2026-04-09T21:00:00.000Z' })],
      },
      csvPath,
    );
    expect(third.rowsAppended).toBe(1);
    expect(third.rowsSkipped).toBe(0);

    const content = await readFile(csvPath, 'utf8');
    const lines = content.trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Date,Ticker,signalRawAction,action,finalAction,Confidence');
    expect(lines[1]).toContain('AAPL,HOLD,HOLD,HOLD,29.05,skip');
    expect(lines[2]).toContain('MSFT,HOLD,HOLD,HOLD,29.05,skip');
  });
});
