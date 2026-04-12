import { RiskAssessment } from '../risk/risk.js';
import { SIGNAL_CONFIG } from './config.js';
import { PositionContext, RawSignalAction } from './models.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveAction(
  score: number,
  risk: RiskAssessment,
  position: PositionContext,
): RawSignalAction {
  if (
    position.shortShares > 0 &&
    (score > SIGNAL_CONFIG.actions.coverScoreThreshold ||
      risk.riskScore < SIGNAL_CONFIG.actions.coverRiskThreshold)
  ) {
    return 'COVER';
  }
  if (
    score >= SIGNAL_CONFIG.actions.buyScoreThreshold &&
    risk.riskScore > SIGNAL_CONFIG.actions.buyRiskThreshold
  ) {
    return 'BUY';
  }
  if (score <= SIGNAL_CONFIG.actions.sellScoreThreshold) {
    return 'SELL';
  }
  if (position.longShares > 0 && score < SIGNAL_CONFIG.actions.longExitScoreThreshold) {
    return 'SELL';
  }
  return 'HOLD';
}

export function deriveConfidence(score: number, risk: RiskAssessment): number {
  const base = Math.abs(score) * SIGNAL_CONFIG.confidence.scoreWeight;
  const riskBonus = risk.riskScore * SIGNAL_CONFIG.confidence.riskWeight;
  return clamp(base + riskBonus, 0, 100);
}
