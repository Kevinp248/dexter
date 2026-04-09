import { FundamentalSignal } from '../agents/analysis/fundamentals.js';
import { TechnicalSignal } from '../agents/analysis/technical.js';

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
  const baseLimit = 0.2;
  let multiplier = 1.0;
  if (annualizedVolatility < 0.15) multiplier = 1.25;
  else if (annualizedVolatility < 0.3) multiplier = 1.0 - (annualizedVolatility - 0.15) * 0.5;
  else if (annualizedVolatility < 0.5) multiplier = 0.75 - (annualizedVolatility - 0.3) * 0.5;
  else multiplier = 0.5;
  multiplier = clamp(multiplier, 0.25, 1.25);
  return baseLimit * multiplier;
}

function correlationMultiplier(avgCorrelation: number): number {
  if (avgCorrelation >= 0.8) return 0.7;
  if (avgCorrelation >= 0.6) return 0.85;
  if (avgCorrelation >= 0.4) return 1.0;
  if (avgCorrelation >= 0.2) return 1.05;
  return 1.1;
}

export function reviewRisk(
  technical: TechnicalSignal,
  fundamental: FundamentalSignal,
  averageCorrelation?: number | null,
): RiskAssessment {
  const volatility = clamp(technical.volatility, 0, 2);
  const volatilityScore = clamp(1 - volatility / 0.8, 0, 1);
  const debtToEquity = fundamental.metrics.debtToEquity ?? 1;
  const debtPenalty = clamp((debtToEquity - 1) / 3, 0, 0.3);
  const corrMult = correlationMultiplier(averageCorrelation ?? 0.4);
  const baseLimit = calculateVolatilityAdjustedLimit(volatility);
  const combinedLimitPct = baseLimit * corrMult;
  const riskScore = clamp(volatilityScore - debtPenalty, 0, 1) * clamp(corrMult, 0.7, 1.1);
  const maxAllocation = clamp(combinedLimitPct, 0.05, 0.3);
  const checks: string[] = [];
  if (volatility > 0.45) checks.push('Elevated annualized volatility');
  if (debtToEquity > 2) checks.push('High debt-to-equity');
  if (fundamental.metrics.peRatio && fundamental.metrics.peRatio > 40)
    checks.push('Expensive valuation');
  if ((averageCorrelation ?? 0) > 0.75) checks.push('High correlation to existing basket');

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
