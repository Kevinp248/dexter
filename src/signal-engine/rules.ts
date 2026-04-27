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

export interface ConfidenceComponentInput {
  name: string;
  score: number;
}

export interface ConfidenceInput {
  aggregateScore: number;
  risk: RiskAssessment;
  components: ConfidenceComponentInput[];
  dataCompletenessScore: number;
  fallbackRatio: number;
  pitAvailabilityMissingCount: number;
}

export interface ConfidenceBreakdown {
  confidence: number;
  agreement: number;
  evidenceBreadth: number;
  dataQuality: number;
  riskSupport: number;
  divergence: number;
  direction: 'bullish' | 'bearish' | 'neutral';
}

function scoreDirection(score: number): ConfidenceBreakdown['direction'] {
  if (score > 0.05) return 'bullish';
  if (score < -0.05) return 'bearish';
  return 'neutral';
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function deriveConfidence(input: ConfidenceInput): ConfidenceBreakdown {
  const direction = scoreDirection(input.aggregateScore);
  const activeComponents = input.components.filter((component) =>
    Number.isFinite(component.score),
  );
  const signs = activeComponents.map((component) => scoreDirection(component.score));
  const alignedCount = signs.filter((sign) => sign === direction).length;
  const neutralCount = signs.filter((sign) => sign === 'neutral').length;
  const disagreementCount = signs.length - alignedCount - neutralCount;

  const agreement =
    signs.length === 0
      ? 0
      : clamp(
          (alignedCount + neutralCount * 0.4) / signs.length - disagreementCount * 0.1,
          0,
          1,
        );
  const evidenceBreadth =
    input.components.length === 0
      ? 0
      : clamp(
          activeComponents.filter((component) => Math.abs(component.score) >= 0.05).length /
            input.components.length,
          0,
          1,
        );
  const pitPenalty = clamp(input.pitAvailabilityMissingCount * 0.08, 0, 0.35);
  const fallbackPenalty = clamp(input.fallbackRatio * 0.45, 0, 0.45);
  const dataQuality = clamp(
    input.dataCompletenessScore * (1 - pitPenalty) * (1 - fallbackPenalty),
    0,
    1,
  );
  const riskSupport = clamp(input.risk.riskScore, 0, 1);
  const divergence = clamp(stdDev(activeComponents.map((component) => component.score)), 0, 1);
  const divergencePenalty = clamp(divergence * 0.35, 0, 0.35);

  const convictionFloor = direction === 'neutral' ? 0.92 : 1;
  const confidence = clamp(
    (agreement * 0.35 +
      evidenceBreadth * 0.2 +
      dataQuality * 0.3 +
      riskSupport * 0.15 -
      divergencePenalty) *
      convictionFloor *
      100,
    0,
    100,
  );
  return {
    confidence,
    agreement,
    evidenceBreadth,
    dataQuality,
    riskSupport,
    divergence,
    direction,
  };
}
