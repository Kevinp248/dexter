import { RiskAssessment } from '../risk/risk.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';
import { SIGNAL_CONFIG } from './config.js';
import { PositionContext, SignalAction, type ExecutionCostEstimate } from './models.js';

type CostInputs = {
  action: SignalAction;
  watchlist: WatchlistEntry;
  position: PositionContext;
  confidence: number;
  aggregateScore: number;
  notionalUsd: number;
  config?: {
    costMultiplier?: number;
    minimumEdgeAfterCostsBps?: number;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getRegionCostBps(region: WatchlistEntry['region']): {
  spreadBps: number;
  slippageBps: number;
  feeBps: number;
  borrowDailyBps: number;
} {
  if (region === 'CA') {
    const ca = SIGNAL_CONFIG.execution.regionCostBps.CA;
    return {
      spreadBps: ca.spread,
      slippageBps: ca.slippage,
      feeBps: ca.fee,
      borrowDailyBps: ca.borrowDaily,
    };
  }
  const us = SIGNAL_CONFIG.execution.regionCostBps.US;
  return {
    spreadBps: us.spread,
    slippageBps: us.slippage,
    feeBps: us.fee,
    borrowDailyBps: us.borrowDaily,
  };
}

function isTradeAction(action: SignalAction): boolean {
  return action === 'BUY' || action === 'SELL' || action === 'COVER';
}

export function estimateTargetNotionalUsd(
  action: SignalAction,
  risk: RiskAssessment,
  portfolioValue: number,
  confidence: number,
  position: PositionContext,
): number {
  if (action === 'SELL' && position.longShares <= 0) return 0;
  if (action === 'COVER' && position.shortShares <= 0) return 0;
  if (!isTradeAction(action)) return 0;

  const confidenceScale = clamp(confidence / 100, SIGNAL_CONFIG.execution.confidenceScaleMin, 1);
  const riskBudget = portfolioValue * risk.maxAllocation;
  return riskBudget * confidenceScale;
}

export function estimateExecutionCosts(inputs: CostInputs): ExecutionCostEstimate {
  const { spreadBps, slippageBps, feeBps, borrowDailyBps } = getRegionCostBps(inputs.watchlist.region);
  const costMultiplier = clamp(
    inputs.config?.costMultiplier ?? SIGNAL_CONFIG.execution.defaultCostMultiplier,
    SIGNAL_CONFIG.execution.costMultiplierMin,
    SIGNAL_CONFIG.execution.costMultiplierMax,
  );
  const oneWayCostBps = (spreadBps + slippageBps + feeBps) * costMultiplier;
  const holdingDays = SIGNAL_CONFIG.execution.holdingDays;
  const borrowBps = inputs.action === 'COVER' || inputs.position.shortShares > 0
    ? borrowDailyBps * holdingDays * costMultiplier
    : 0;
  const roundTripCostBps = oneWayCostBps * 2 + borrowBps;

  const expectedEdgeBps = Math.abs(inputs.aggregateScore) * 250 + inputs.confidence * 0.6;
  const expectedEdgeAfterCostsBps = expectedEdgeBps - roundTripCostBps;
  const estimatedRoundTripCostUsd = (inputs.notionalUsd * roundTripCostBps) / 10000;
  const minEdge =
    inputs.config?.minimumEdgeAfterCostsBps ??
    SIGNAL_CONFIG.execution.defaultMinimumEdgeAfterCostsBps;

  return {
    oneWayCostBps,
    roundTripCostBps,
    estimatedRoundTripCostUsd,
    expectedEdgeBps,
    expectedEdgeAfterCostsBps,
    isTradeableAfterCosts: expectedEdgeAfterCostsBps > minEdge,
  };
}
