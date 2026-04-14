import { deriveConfidence, resolveAction } from '../rules.js';

const baseRisk = {
  ticker: 'AAPL',
  riskScore: 0.6,
  maxAllocation: 0.2,
  basePositionLimitPct: 0.2,
  correlationMultiplier: 1,
  combinedLimitPct: 0.2,
  annualizedVolatility: 0.25,
  averageCorrelation: 0.4,
  checks: [],
};

describe('signal-engine rules', () => {
  test('returns BUY when score and risk are supportive', () => {
    const action = resolveAction(0.75, baseRisk, { longShares: 0, shortShares: 0 });
    expect(action).toBe('BUY');
  });

  test('returns SELL on bearish score', () => {
    const action = resolveAction(-0.55, baseRisk, { longShares: 10, shortShares: 0 });
    expect(action).toBe('SELL');
  });

  test('returns COVER when short and thesis flips', () => {
    const action = resolveAction(0.2, baseRisk, { longShares: 0, shortShares: 50 });
    expect(action).toBe('COVER');
  });

  test('returns HOLD in neutral zone', () => {
    const action = resolveAction(0.05, baseRisk, { longShares: 0, shortShares: 0 });
    expect(action).toBe('HOLD');
  });

  test('confidence remains bounded between 0 and 100', () => {
    const bullish = deriveConfidence({
      aggregateScore: 2,
      risk: baseRisk,
      components: [
        { name: 'technical', score: 1 },
        { name: 'fundamentals', score: 0.9 },
        { name: 'valuation', score: 0.8 },
        { name: 'sentiment', score: 0.7 },
      ],
      dataCompletenessScore: 1,
      fallbackRatio: 0,
      pitAvailabilityMissingCount: 0,
    });
    const bearish = deriveConfidence({
      aggregateScore: -2,
      risk: baseRisk,
      components: [
        { name: 'technical', score: -1 },
        { name: 'fundamentals', score: -0.9 },
        { name: 'valuation', score: -0.8 },
        { name: 'sentiment', score: -0.7 },
      ],
      dataCompletenessScore: 1,
      fallbackRatio: 0,
      pitAvailabilityMissingCount: 0,
    });
    expect(bullish.confidence).toBeLessThanOrEqual(100);
    expect(bearish.confidence).toBeGreaterThanOrEqual(0);
  });

  test('confidence is not a disguised aggregate score copy', () => {
    const aligned = deriveConfidence({
      aggregateScore: 0.2,
      risk: baseRisk,
      components: [
        { name: 'technical', score: 0.4 },
        { name: 'fundamentals', score: 0.3 },
        { name: 'valuation', score: 0.2 },
        { name: 'sentiment', score: 0.2 },
      ],
      dataCompletenessScore: 0.95,
      fallbackRatio: 0,
      pitAvailabilityMissingCount: 0,
    });
    const conflicted = deriveConfidence({
      aggregateScore: 0.2,
      risk: baseRisk,
      components: [
        { name: 'technical', score: 0.7 },
        { name: 'fundamentals', score: -0.5 },
        { name: 'valuation', score: 0.1 },
        { name: 'sentiment', score: -0.2 },
      ],
      dataCompletenessScore: 0.95,
      fallbackRatio: 0,
      pitAvailabilityMissingCount: 0,
    });

    expect(aligned.confidence).toBeGreaterThan(conflicted.confidence);
    expect(conflicted.divergence).toBeGreaterThan(aligned.divergence);
  });
});
