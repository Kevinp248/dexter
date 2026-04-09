import { RiskAssessment } from '../risk/risk.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'COVER';

export interface SignalComponent<T = Record<string, unknown>> {
  name: string;
  score: number;
  details: T;
}

export interface PositionContext {
  longShares: number;
  shortShares: number;
}

export interface ScanOptions {
  tickers?: string[];
  positions?: Record<string, PositionContext>;
  portfolioValue?: number;
  executionConfig?: {
    costMultiplier?: number;
    minimumEdgeAfterCostsBps?: number;
  };
  portfolioContext?: {
    grossExposurePct?: number;
    sectorExposurePct?: Record<string, number>;
    maxGrossExposurePct?: number;
    maxSectorExposurePct?: number;
  };
}

export interface ExecutionCostEstimate {
  oneWayCostBps: number;
  roundTripCostBps: number;
  estimatedRoundTripCostUsd: number;
  expectedEdgeBps: number;
  expectedEdgeAfterCostsBps: number;
  isTradeableAfterCosts: boolean;
}

export interface PortfolioConstraintEvaluation {
  isAllowed: boolean;
  blockedReasons: string[];
  projectedGrossExposurePct: number | null;
  projectedSectorExposurePct: number | null;
}

export interface ExecutionPlan {
  estimatedPrice: number;
  estimatedShares: number;
  notionalUsd: number;
  costEstimate: ExecutionCostEstimate;
  constraints: PortfolioConstraintEvaluation;
}

export interface SignalPayload {
  ticker: string;
  action: SignalAction;
  confidence: number;
  finalAction: SignalAction;
  positionContext: PositionContext;
  executionPlan: ExecutionPlan;
  reasoning: {
    components: SignalComponent[];
    risk: RiskAssessment;
    aggregateScore: number;
    weightedInputs: Record<string, number>;
  };
  watchlist: WatchlistEntry;
  generatedAt: string;
}
