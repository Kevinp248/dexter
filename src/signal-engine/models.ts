import { RiskAssessment } from '../risk/risk.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'COVER';

export interface SignalComponent<T = Record<string, unknown>> {
  name: string;
  score: number;
  details: T;
}

export interface FallbackEvent {
  component: string;
  fallbackUsed: boolean;
  reason: string;
  retrySuggestion: string;
  attempts: number;
  lastError: string | null;
}

export interface PositionContext {
  longShares: number;
  shortShares: number;
}

export interface ScanOptions {
  tickers?: string[];
  positions?: Record<string, PositionContext>;
  portfolioValue?: number;
  previousSignalsByTicker?: Record<string, PreviousSignalSnapshot>;
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

export interface RegionalMarketCheck {
  isTradeableInRegion: boolean;
  checks: string[];
  averageDollarVolume20d: number | null;
}

export interface PreviousSignalSnapshot {
  generatedAt: string;
  action: SignalAction;
  finalAction: SignalAction;
  confidence: number;
  aggregateScore: number;
  weightedInputs: Record<string, number>;
}

export interface SignalDelta {
  hasPrevious: boolean;
  previousGeneratedAt: string | null;
  actionChanged: boolean;
  finalActionChanged: boolean;
  confidenceChange: number;
  aggregateScoreChange: number;
  weightedInputChanges: Record<string, number>;
  topDrivers: string[];
}

export interface SignalPayload {
  ticker: string;
  action: SignalAction;
  confidence: number;
  finalAction: SignalAction;
  delta: SignalDelta;
  regionalMarketCheck: RegionalMarketCheck;
  positionContext: PositionContext;
  executionPlan: ExecutionPlan;
  fallbackPolicy: {
    hadFallback: boolean;
    events: FallbackEvent[];
  };
  reasoning: {
    components: SignalComponent[];
    risk: RiskAssessment;
    aggregateScore: number;
    weightedInputs: Record<string, number>;
  };
  watchlist: WatchlistEntry;
  generatedAt: string;
}
