import { RiskAssessment } from '../risk/risk.js';
import { PositionContext, SignalAction } from './models.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveAction(
  score: number,
  risk: RiskAssessment,
  position: PositionContext,
): SignalAction {
  if (position.shortShares > 0 && (score > 0.15 || risk.riskScore < 0.25)) {
    return 'COVER';
  }
  if (score >= 0.5 && risk.riskScore > 0.35) {
    return 'BUY';
  }
  if (score <= -0.45) {
    return 'SELL';
  }
  if (position.longShares > 0 && score < -0.25) {
    return 'SELL';
  }
  return 'HOLD';
}

export function deriveConfidence(score: number, risk: RiskAssessment): number {
  const base = Math.abs(score) * 70;
  const riskBonus = risk.riskScore * 30;
  return clamp(base + riskBonus, 0, 100);
}
