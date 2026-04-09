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
    expect(deriveConfidence(2, baseRisk)).toBeLessThanOrEqual(100);
    expect(deriveConfidence(-2, baseRisk)).toBeGreaterThanOrEqual(0);
  });
});
