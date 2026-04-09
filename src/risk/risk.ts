import { FundamentalSignal } from '../agents/analysis/fundamentals.js';
import { TechnicalSignal } from '../agents/analysis/technical.js';

export interface RiskAssessment {
  ticker: string;
  riskScore: number; // 0=high risk, 1=low risk
  maxAllocation: number; // 0..1 of portfolio
  checks: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function reviewRisk(
  technical: TechnicalSignal,
  fundamental: FundamentalSignal,
): RiskAssessment {
  const volatility = clamp(technical.volatility, 0, 2);
  const volatilityScore = clamp(1 - volatility, 0, 1);
  const debtToEquity = fundamental.metrics.debtToEquity ?? 1;
  const debtPenalty = clamp((debtToEquity - 1) / 3, 0, 0.3);
  const riskScore = clamp(volatilityScore - debtPenalty, 0, 1);
  const maxAllocation = clamp(0.05 + riskScore * 0.25, 0.05, 0.3);
  const checks: string[] = [];
  if (volatility > 1.2) checks.push('Elevated price volatility');
  if (debtToEquity > 2) checks.push('High debt-to-equity');
  if (fundamental.metrics.peRatio && fundamental.metrics.peRatio > 40)
    checks.push('Expensive valuation');

  return {
    ticker: technical.ticker,
    riskScore,
    maxAllocation,
    checks,
  };
}
