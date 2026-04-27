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
    assumptionVersion?: string;
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
  return action === 'BUY' || action === 'SELL';
}

export function estimateTargetNotionalUsd(
  action: SignalAction,
  risk: RiskAssessment,
  portfolioValue: number,
  confidence: number,
  position: PositionContext,
): number {
  if (action === 'SELL' && position.longShares <= 0) return 0;
  if (!isTradeAction(action)) return 0;

  const confidenceScale = clamp(confidence / 100, SIGNAL_CONFIG.execution.confidenceScaleMin, 1);
  const riskBudget = portfolioValue * risk.maxAllocation;
  return riskBudget * confidenceScale;
}

export function estimateExecutionCosts(inputs: CostInputs): ExecutionCostEstimate {
  const { spreadBps, slippageBps, feeBps, borrowDailyBps } = getRegionCostBps(inputs.watchlist.region);
  const multiplierOverride = inputs.config?.costMultiplier;
  const minEdgeOverride = inputs.config?.minimumEdgeAfterCostsBps;
  const costMultiplier = clamp(
    multiplierOverride ?? SIGNAL_CONFIG.execution.defaultCostMultiplier,
    SIGNAL_CONFIG.execution.costMultiplierMin,
    SIGNAL_CONFIG.execution.costMultiplierMax,
  );
  const oneWayCostBps = (spreadBps + slippageBps + feeBps) * costMultiplier;
  const holdingDays = SIGNAL_CONFIG.execution.holdingDays;
  const borrowBps = inputs.position.shortShares > 0
    ? borrowDailyBps * holdingDays * costMultiplier
    : 0;
  const roundTripCostBps = oneWayCostBps * 2 + borrowBps;

  const expectedEdgePreCostBps = Math.abs(inputs.aggregateScore) * 250 + inputs.confidence * 0.6;
  const expectedEdgePostCostBps = expectedEdgePreCostBps - roundTripCostBps;
  const estimatedRoundTripCostUsd = (inputs.notionalUsd * roundTripCostBps) / 10000;
  const minEdgeThresholdBps =
    minEdgeOverride ??
    SIGNAL_CONFIG.execution.defaultMinimumEdgeAfterCostsBps;
  const assumptionSource = multiplierOverride !== undefined || minEdgeOverride !== undefined
    ? 'override'
    : 'default';
  const assumptionVersion =
    inputs.config?.assumptionVersion ?? SIGNAL_CONFIG.execution.assumptionVersion;
  const assumptionSnapshotId = [
    assumptionVersion,
    `cm=${costMultiplier.toFixed(4)}`,
    `minEdge=${minEdgeThresholdBps.toFixed(2)}`,
    `hold=${SIGNAL_CONFIG.execution.holdingDays}`,
  ].join('|');

  return {
    expectedEdgePreCostBps,
    oneWayCostBps,
    roundTripCostBps,
    costBreakdownBps: {
      spread: spreadBps * costMultiplier,
      slippage: slippageBps * costMultiplier,
      fee: feeBps * costMultiplier,
      borrow: borrowBps,
      oneWay: oneWayCostBps,
      roundTrip: roundTripCostBps,
    },
    estimatedRoundTripCostUsd,
    expectedEdgeBps: expectedEdgePreCostBps,
    expectedEdgePostCostBps,
    expectedEdgeAfterCostsBps: expectedEdgePostCostBps,
    minEdgeThresholdBps,
    isTradeableAfterCosts: expectedEdgePostCostBps > minEdgeThresholdBps,
    costChangedAction: false,
    assumptionSource,
    assumptionVersion,
    assumptionSnapshotId,
  };
}
