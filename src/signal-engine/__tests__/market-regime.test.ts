import { evaluateMarketRegime } from '../market-regime.js';

describe('market regime policy', () => {
  test('classifies risk_on when SPY above SMA and VIX below threshold', () => {
    const result = evaluateMarketRegime({
      asOfDate: '2026-01-02',
      spyCloses: Array.from({ length: 220 }, (_, i) => 400 + i * 0.4),
      vixClose: 18,
      config: { spySmaLookbackDays: 200, vixRiskOffThreshold: 25 },
    });
    expect(result.assessment.state).toBe('risk_on');
    expect(result.assessment.reasonCode).toBe('REGIME_RISK_ON');
  });

  test('classifies risk_off and applies non-blocking policy defaults', () => {
    const result = evaluateMarketRegime({
      asOfDate: '2026-01-02',
      spyCloses: Array.from({ length: 220 }, (_, i) => 500 - i * 0.6),
      vixClose: 32,
      config: { spySmaLookbackDays: 200, strictBuyGateInRiskOff: false },
    });
    expect(result.assessment.state).toBe('risk_off');
    expect(result.assessment.policyAdjustmentsApplied.strictBuyGate).toBe(false);
    expect(result.assessment.policyAdjustmentsApplied.buyThresholdAdd).toBeGreaterThan(0);
  });

  test('returns regime_unknown when history is insufficient', () => {
    const result = evaluateMarketRegime({
      asOfDate: '2026-01-02',
      spyCloses: Array.from({ length: 50 }, () => 500),
      vixClose: 20,
      config: { spySmaLookbackDays: 200 },
    });
    expect(result.assessment.state).toBe('regime_unknown');
    expect(result.assessment.reasonCode).toBe('REGIME_UNKNOWN_INSUFFICIENT_HISTORY');
  });
});
