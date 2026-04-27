import { estimateExecutionCosts } from '../execution.js';

describe('execution cost estimate provenance', () => {
  test('returns pre/post edge, min threshold, and default provenance', () => {
    const estimate = estimateExecutionCosts({
      action: 'BUY',
      watchlist: {
        ticker: 'AAPL',
        name: 'Apple',
        region: 'US',
        exchange: 'NASDAQ',
        currency: 'USD',
        sector: 'Technology',
        rationale: 'test',
      },
      position: { longShares: 0, shortShares: 0 },
      confidence: 75,
      aggregateScore: 0.6,
      notionalUsd: 10_000,
    });
    expect(estimate.expectedEdgePreCostBps).toBeGreaterThan(estimate.expectedEdgePostCostBps);
    expect(estimate.expectedEdgeAfterCostsBps).toBe(estimate.expectedEdgePostCostBps);
    expect(estimate.minEdgeThresholdBps).toBe(0);
    expect(estimate.assumptionSource).toBe('default');
    expect(estimate.assumptionVersion).toBeTruthy();
  });

  test('marks override provenance when runtime overrides are supplied', () => {
    const estimate = estimateExecutionCosts({
      action: 'BUY',
      watchlist: {
        ticker: 'AAPL',
        name: 'Apple',
        region: 'US',
        exchange: 'NASDAQ',
        currency: 'USD',
        sector: 'Technology',
        rationale: 'test',
      },
      position: { longShares: 0, shortShares: 0 },
      confidence: 60,
      aggregateScore: 0.5,
      notionalUsd: 5_000,
      config: {
        costMultiplier: 2,
        minimumEdgeAfterCostsBps: 15,
        assumptionVersion: 'override-v2',
      },
    });
    expect(estimate.assumptionSource).toBe('override');
    expect(estimate.assumptionVersion).toBe('override-v2');
    expect(estimate.minEdgeThresholdBps).toBe(15);
    expect(estimate.assumptionSnapshotId).toContain('override-v2');
  });
});
