import { RiskAssessment } from '../risk/risk.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';
import { AnalysisContext } from '../agents/analysis/types.js';
import {
  CanonicalSignalAction,
  ExtendedSignalAction,
} from './action-normalization.js';

export type SignalAction = CanonicalSignalAction;
export type RawSignalAction = ExtendedSignalAction;

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
    assumptionVersion?: string;
  };
  earningsConfig?: {
    enabled?: boolean;
    blackoutTradingDays?: number;
    missingCoveragePolicy?: 'warn_only' | 'suppress_buy';
    maxCoverageAgeDays?: number;
  };
  regimeConfig?: {
    enabled?: boolean;
    strictBuyGateInRiskOff?: boolean;
    buyScoreThresholdAddRiskOff?: number;
    confidenceCapRiskOff?: number;
    maxAllocationMultiplierRiskOff?: number;
    confidenceCapUnknown?: number;
    maxAllocationMultiplierUnknown?: number;
    vixRiskOffThreshold?: number;
    spySmaLookbackDays?: number;
  };
  portfolioContext?: {
    grossExposurePct?: number;
    sectorExposurePct?: Record<string, number>;
    maxGrossExposurePct?: number;
    maxSectorExposurePct?: number;
  };
}

export interface ExecutionCostEstimate {
  expectedEdgePreCostBps: number;
  oneWayCostBps: number;
  roundTripCostBps: number;
  costBreakdownBps: {
    spread: number;
    slippage: number;
    fee: number;
    borrow: number;
    oneWay: number;
    roundTrip: number;
  };
  estimatedRoundTripCostUsd: number;
  expectedEdgeBps: number;
  expectedEdgePostCostBps: number;
  expectedEdgeAfterCostsBps: number;
  minEdgeThresholdBps: number;
  isTradeableAfterCosts: boolean;
  costChangedAction: boolean;
  assumptionSource: 'default' | 'override';
  assumptionVersion: string;
  assumptionSnapshotId: string;
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

export interface ConfidenceMetadata {
  agreement: number;
  evidenceBreadth: number;
  dataQuality: number;
  riskSupport: number;
  divergence: number;
  direction: 'bullish' | 'bearish' | 'neutral';
}

export interface EarningsRiskAssessment {
  nextEarningsDate: string | null;
  tradingDaysToEarnings: number | null;
  coverageStatus: 'covered' | 'missing' | 'stale';
  inBlackoutWindow: boolean;
  policyApplied:
    | 'none'
    | 'warn_only'
    | 'buy_suppressed_to_hold_blackout'
    | 'buy_suppressed_to_hold_missing_coverage';
  reasonCode:
    | 'EARNINGS_POLICY_DISABLED'
    | 'EARNINGS_BLACKOUT_BUY_SUPPRESSED'
    | 'EARNINGS_COVERAGE_WARN'
    | 'EARNINGS_MISSING_COVERAGE_SUPPRESSED'
    | 'EARNINGS_COVERAGE_STALE'
    | 'EARNINGS_COVERAGE_OK';
}

export interface MarketRegimeAssessment {
  state: 'risk_on' | 'risk_off' | 'regime_unknown';
  reasonCode:
    | 'REGIME_RISK_ON'
    | 'REGIME_RISK_OFF_SPY_BELOW_SMA_OR_VIX_HIGH'
    | 'REGIME_UNKNOWN_MISSING_SPY'
    | 'REGIME_UNKNOWN_MISSING_VIX'
    | 'REGIME_UNKNOWN_INSUFFICIENT_HISTORY';
  inputs: {
    asOfDate: string;
    spyClose: number | null;
    spySma: number | null;
    vixClose: number | null;
    lookbackDays: number;
  };
  policyAdjustmentsApplied: {
    buyThresholdAdd: number;
    confidenceCap: number | null;
    maxAllocationMultiplier: number;
    strictBuyGate: boolean;
  };
}

export interface SignalPayload {
  ticker: string;
  action: SignalAction;
  confidence: number;
  confidenceMetadata?: ConfidenceMetadata;
  finalAction: SignalAction;
  rawAction: RawSignalAction;
  rawFinalAction: RawSignalAction;
  actionNormalizationNote: string | null;
  qualityGuard?: {
    suppressed: boolean;
    reason: string | null;
    fallbackRatio: number;
  };
  earningsRisk: EarningsRiskAssessment;
  marketRegime: MarketRegimeAssessment;
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
