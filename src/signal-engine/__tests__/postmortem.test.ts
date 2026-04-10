import { generatePostmortemIncidents } from '../postmortem.js';
import { PositionStateSnapshot } from '../portfolio-ledger.js';

describe('postmortem engine', () => {
  test('generates incidents for loss and edge divergence triggers', async () => {
    const rows = [
      {
        date: '2026-04-09',
        ticker: 'AAPL',
        action: 'BUY',
        finalAction: 'BUY',
        confidence: 78,
        decision: 'trade',
        direction: 'long',
        resultPct: -3.2,
        overrideReason: '',
        fallbackHadFallback: true,
        fallbackReason: 'Insufficient price history',
        fallbackRetrySuggestion: 'Retry after close',
      },
      {
        date: '2026-04-09',
        ticker: 'MSFT',
        action: 'BUY',
        finalAction: 'BUY',
        confidence: 65,
        decision: 'trade',
        direction: 'long',
        resultPct: -0.4,
        overrideReason: '',
        fallbackHadFallback: false,
        fallbackReason: '',
        fallbackRetrySuggestion: '',
      },
    ];

    const scan = {
      generatedAt: '2026-04-09T12:00:00.000Z',
      alerts: [
        {
          ticker: 'AAPL',
          confidence: 80,
          fallbackPolicy: {
            hadFallback: true,
            events: [
              {
                component: 'technical',
                fallbackUsed: true,
                reason: 'Insufficient price history',
                retrySuggestion: 'Retry after close',
                attempts: 0,
                lastError: null,
              },
            ],
          },
          reasoning: {
            risk: { checks: ['High valuation'] },
          },
          executionPlan: {
            costEstimate: {
              expectedEdgeAfterCostsBps: 120,
            },
          },
        },
        {
          ticker: 'MSFT',
          confidence: 55,
          fallbackPolicy: { hadFallback: false, events: [] },
          reasoning: { risk: { checks: [] } },
          executionPlan: {
            costEstimate: {
              expectedEdgeAfterCostsBps: 200,
            },
          },
        },
      ],
    } as any;

    const state: PositionStateSnapshot = {
      generatedAt: '2026-04-09T12:05:00.000Z',
      fillsCount: 1,
      positions: {
        AAPL: {
          longShares: 10,
          shortShares: 0,
          longCostBasis: 200,
          shortCostBasis: 0,
          realizedPnlUsd: 0,
          totalFeesUsd: 1,
          lastTradeAt: '2026-04-09T12:00:00.000Z',
        },
      },
      totals: {
        realizedPnlUsd: 0,
        totalFeesUsd: 1,
        openLongCount: 1,
        openShortCount: 0,
      },
    };

    const incidents = await generatePostmortemIncidents(rows as any, scan, state, {
      includeResearch: false,
      lossThresholdPct: -2,
      divergenceThresholdBps: 150,
    });

    expect(incidents).toHaveLength(2);
    expect(incidents[0].ticker).toBe('AAPL');
    expect(incidents[0].rootCauseHypotheses.length).toBeGreaterThan(0);
    expect(incidents[0].recommendations.length).toBeGreaterThan(0);
    expect(incidents[1].type).toBe('edge_divergence');
  });
});
