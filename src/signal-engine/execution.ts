import { RiskAssessment } from '../risk/risk.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';
import { PositionContext, SignalAction, type ExecutionCostEstimate } from './models.js';

type CostInputs = {
  action: SignalAction;
  watchlist: WatchlistEntry;
  position: PositionContext;
  confidence: number;
  aggregateScore: number;
  notionalUsd: number;
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
    return { spreadBps: 7, slippageBps: 10, feeBps: 1.5, borrowDailyBps: 2.5 };
  }
  return { spreadBps: 5, slippageBps: 7, feeBps: 1, borrowDailyBps: 2 };
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

  const confidenceScale = clamp(confidence / 100, 0.1, 1);
  const riskBudget = portfolioValue * risk.maxAllocation;
  return riskBudget * confidenceScale;
}

export function estimateExecutionCosts(inputs: CostInputs): ExecutionCostEstimate {
  const { spreadBps, slippageBps, feeBps, borrowDailyBps } = getRegionCostBps(inputs.watchlist.region);
  const oneWayCostBps = spreadBps + slippageBps + feeBps;
  const holdingDays = 5; // default weekly hold assumption for daily scanner signals
  const borrowBps = inputs.action === 'COVER' || inputs.position.shortShares > 0
    ? borrowDailyBps * holdingDays
    : 0;
  const roundTripCostBps = oneWayCostBps * 2 + borrowBps;

  const expectedEdgeBps = Math.abs(inputs.aggregateScore) * 250 + inputs.confidence * 0.6;
  const expectedEdgeAfterCostsBps = expectedEdgeBps - roundTripCostBps;
  const estimatedRoundTripCostUsd = (inputs.notionalUsd * roundTripCostBps) / 10000;

  return {
    oneWayCostBps,
    roundTripCostBps,
    estimatedRoundTripCostUsd,
    expectedEdgeBps,
    expectedEdgeAfterCostsBps,
    isTradeableAfterCosts: expectedEdgeAfterCostsBps > 0,
  };
}
