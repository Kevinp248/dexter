import { applyEarningsPolicy } from '../earnings-awareness.js';

describe('earnings awareness policy', () => {
  test('suppresses BUY to HOLD inside blackout window', () => {
    const result = applyEarningsPolicy({
      action: 'BUY',
      asOfDate: '2026-01-02',
      nextEarningsDate: '2026-01-06',
      config: { blackoutTradingDays: 5 },
    });
    expect(result.action).toBe('HOLD');
    expect(result.assessment.inBlackoutWindow).toBe(true);
    expect(result.assessment.reasonCode).toBe('EARNINGS_BLACKOUT_BUY_SUPPRESSED');
  });

  test('warns only when coverage is missing by default', () => {
    const result = applyEarningsPolicy({
      action: 'BUY',
      asOfDate: '2026-01-02',
      nextEarningsDate: null,
      config: { missingCoveragePolicy: 'warn_only' },
    });
    expect(result.action).toBe('BUY');
    expect(result.assessment.policyApplied).toBe('warn_only');
    expect(result.assessment.reasonCode).toBe('EARNINGS_COVERAGE_WARN');
  });

  test('suppresses BUY when missing coverage policy is strict', () => {
    const result = applyEarningsPolicy({
      action: 'BUY',
      asOfDate: '2026-01-02',
      nextEarningsDate: null,
      config: { missingCoveragePolicy: 'suppress_buy' },
    });
    expect(result.action).toBe('HOLD');
    expect(result.assessment.reasonCode).toBe('EARNINGS_MISSING_COVERAGE_SUPPRESSED');
  });

  test('keeps SELL unchanged during blackout', () => {
    const result = applyEarningsPolicy({
      action: 'SELL',
      asOfDate: '2026-01-02',
      nextEarningsDate: '2026-01-06',
      config: { blackoutTradingDays: 5 },
    });
    expect(result.action).toBe('SELL');
    expect(result.assessment.inBlackoutWindow).toBe(true);
  });
});
