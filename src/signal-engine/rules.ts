import { RiskAssessment } from '../risk/risk.js';
import { SignalAction } from './models.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveAction(score: number, risk: RiskAssessment): SignalAction {
  if (score >= 0.5 && risk.riskScore > 0.35) {
    return 'BUY';
  }
  if (score <= -0.5) {
    return 'SELL';
  }
  if (score >= 0.25 && risk.riskScore > 0.2) {
    return 'HOLD';
  }
  if (risk.riskScore < 0.2 && score > 0) {
    return 'HOLD';
  }
  return score < -0.25 ? 'SELL' : 'HOLD';
}

export function deriveConfidence(score: number, risk: RiskAssessment): number {
  const base = Math.abs(score) * 70;
  const riskBonus = risk.riskScore * 30;
  return clamp(base + riskBonus, 0, 100);
}
