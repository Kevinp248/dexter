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
        oneWayCostBps: 13,
        roundTripCostBps: 26,
        estimatedRoundTripCostUsd: 0,
        expectedEdgeBps: 42.11,
        expectedEdgeAfterCostsBps: 16.11,
        isTradeableAfterCosts: true,
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
    expect(lines[0]).toContain('Date,Ticker,action,finalAction,Confidence');
    expect(lines[1]).toContain('AAPL,HOLD,HOLD,29.05,skip');
    expect(lines[2]).toContain('MSFT,HOLD,HOLD,29.05,skip');
  });
});
