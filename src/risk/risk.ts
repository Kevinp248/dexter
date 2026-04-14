import { FundamentalSignal } from '../agents/analysis/fundamentals.js';
import { TechnicalSignal } from '../agents/analysis/technical.js';
import { SIGNAL_CONFIG } from '../signal-engine/config.js';

export interface RiskAssessment {
  ticker: string;
  riskScore: number; // 0=high risk, 1=low risk
  maxAllocation: number; // 0..1 of portfolio
  basePositionLimitPct: number;
  correlationMultiplier: number;
  combinedLimitPct: number;
  annualizedVolatility: number;
  averageCorrelation: number | null;
  checks: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function calculateVolatilityAdjustedLimit(annualizedVolatility: number): number {
  const baseLimit = SIGNAL_CONFIG.risk.baseLimit;
  let multiplier = 1.0;
  if (annualizedVolatility < SIGNAL_CONFIG.risk.lowVolThreshold) multiplier = 1.25;
  else if (annualizedVolatility < SIGNAL_CONFIG.risk.mediumVolThreshold)
    multiplier =
      1.0 -
      (annualizedVolatility - SIGNAL_CONFIG.risk.lowVolThreshold) * 0.5;
  else if (annualizedVolatility < SIGNAL_CONFIG.risk.highVolThreshold)
    multiplier =
      0.75 -
      (annualizedVolatility - SIGNAL_CONFIG.risk.mediumVolThreshold) * 0.5;
  else multiplier = 0.5;
  multiplier = clamp(
    multiplier,
    SIGNAL_CONFIG.risk.minLimitMultiplier,
    SIGNAL_CONFIG.risk.maxLimitMultiplier,
  );
  return baseLimit * multiplier;
}

function correlationMultiplier(avgCorrelation: number): number {
  const bands = SIGNAL_CONFIG.risk.correlationBands;
  const multipliers = SIGNAL_CONFIG.risk.correlationMultipliers;
  if (avgCorrelation >= bands.veryHigh) return multipliers.veryHigh;
  if (avgCorrelation >= bands.high) return multipliers.high;
  if (avgCorrelation >= bands.medium) return multipliers.medium;
  if (avgCorrelation >= bands.low) return multipliers.low;
  return multipliers.veryLow;
}

export function reviewRisk(
  technical: TechnicalSignal,
  fundamental: FundamentalSignal,
  averageCorrelation?: number | null,
): RiskAssessment {
  const volatility = clamp(technical.volatility, 0, 2);
  const volatilityScore = clamp(1 - volatility / SIGNAL_CONFIG.risk.riskVolScale, 0, 1);
  const debtToEquity = fundamental.metrics.debtToEquity ?? 1;
  const debtPenalty = clamp(
    (debtToEquity - 1) / SIGNAL_CONFIG.risk.debtPenaltyScale,
    0,
    0.3,
  );
  const corrMult =
    averageCorrelation === null || averageCorrelation === undefined
      ? SIGNAL_CONFIG.risk.correlationUnavailableMultiplier
      : correlationMultiplier(averageCorrelation);
  const baseLimit = calculateVolatilityAdjustedLimit(volatility);
  const combinedLimitPct = baseLimit * corrMult;
  const minCorrMult = SIGNAL_CONFIG.risk.correlationMultipliers.veryHigh;
  const maxCorrMult = SIGNAL_CONFIG.risk.correlationMultipliers.veryLow;
  const riskScore =
    clamp(volatilityScore - debtPenalty, 0, 1) * clamp(corrMult, minCorrMult, maxCorrMult);
  const maxAllocation = clamp(
    combinedLimitPct,
    SIGNAL_CONFIG.risk.maxAllocationMin,
    SIGNAL_CONFIG.risk.maxAllocationMax,
  );
  const checks: string[] = [];
  if (volatility > SIGNAL_CONFIG.risk.volatilityCheckThreshold)
    checks.push('Elevated annualized volatility');
  if (debtToEquity > 2) checks.push('High debt-to-equity');
  if (
    fundamental.metrics.peRatio &&
    fundamental.metrics.peRatio > SIGNAL_CONFIG.risk.expensivePeThreshold
  )
    checks.push('Expensive valuation');
  if (
    (averageCorrelation ?? 0) > SIGNAL_CONFIG.risk.concentrationCorrelationThreshold
  )
    checks.push('High correlation to existing basket');
  if (averageCorrelation === null || averageCorrelation === undefined) {
    checks.push('Correlation unavailable; conservative diversification cap applied');
  }

  return {
    ticker: technical.ticker,
    riskScore,
    maxAllocation,
    basePositionLimitPct: baseLimit,
    correlationMultiplier: corrMult,
    combinedLimitPct,
    annualizedVolatility: volatility,
    averageCorrelation: averageCorrelation ?? null,
    checks,
  };
}
