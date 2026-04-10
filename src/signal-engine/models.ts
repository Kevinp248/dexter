import { RiskAssessment } from '../risk/risk.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';
import { AnalysisContext } from '../agents/analysis/types.js';

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

export interface PositionStateInput {
  longShares: number;
  shortShares: number;
  longCostBasis: number;
  shortCostBasis: number;
  realizedPnlUsd: number;
  totalFeesUsd: number;
  lastTradeAt: string | null;
}

export interface ScanOptions {
  tickers?: string[];
  analysisContext?: AnalysisContext;
  positions?: Record<string, PositionContext>;
  positionStatesByTicker?: Record<string, PositionStateInput>;
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

export interface PositionPerformance {
  hasOpenPosition: boolean;
  isCostBasisAvailable: boolean;
  markPrice: number;
  longShares: number;
  shortShares: number;
  longCostBasis: number | null;
  shortCostBasis: number | null;
  longMarketValueUsd: number;
  shortMarketValueUsd: number;
  netExposureUsd: number;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number | null;
  totalPnlUsd: number | null;
  notes: string[];
}

export interface DataCompleteness {
  score: number;
  status: 'pass' | 'warn' | 'fail';
  missingCritical: string[];
  notes: string[];
}

export interface SignalPayload {
  ticker: string;
  action: SignalAction;
  confidence: number;
  finalAction: SignalAction;
  qualityGuard?: {
    suppressed: boolean;
    reason: string | null;
    fallbackRatio: number;
  };
  dataCompleteness: DataCompleteness;
  delta: SignalDelta;
  regionalMarketCheck: RegionalMarketCheck;
  positionContext: PositionContext;
  positionPerformance: PositionPerformance;
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
