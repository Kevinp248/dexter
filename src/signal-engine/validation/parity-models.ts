import { ScanOptions, SignalPayload } from '../models.js';
import { AnalysisContext } from '../../agents/analysis/types.js';

export type ParityInputProvenanceStatus = 'available' | 'unavailable' | 'error';

export interface InputProvenance {
  status: ParityInputProvenanceStatus;
  source: 'historical_provider_asof' | 'custom_provider';
  asOfDateUsed: string | null;
  warning: string | null;
}

export interface ForwardReturnLabel {
  basis: 'close_to_close';
  closeToCloseReturnPct: number | null;
  directionalReturnPct: number | null;
  directionalReturnAfterCostsPct: number | null;
  directionalAfterCostsAssumption: 'buy_round_trip' | 'sell_zero_cost_avoidance' | 'none';
  isLabelAvailable: boolean;
  isDirectionalAfterCostsLabelAvailable: boolean;
}

export interface ParityValidationRow {
  asOfDate: string;
  ticker: string;
  rawAction: SignalPayload['rawAction'];
  finalAction: SignalPayload['finalAction'];
  confidence: number;
  aggregateScore: number;
  riskScore: number;
  technicalScore: number;
  fundamentalsScore: number;
  valuationScore: number;
  sentimentScore: number;
  earningsState: SignalPayload['earningsRisk']['coverageStatus'];
  earningsReasonCode: SignalPayload['earningsRisk']['reasonCode'];
  earningsProvenance: InputProvenance;
  regimeState: SignalPayload['marketRegime']['state'];
  regimeReasonCode: SignalPayload['marketRegime']['reasonCode'];
  regimeProvenance: InputProvenance;
  expectedEdgePreCostBps: number;
  expectedEdgePostCostBps: number;
  minEdgeThresholdBps: number;
  roundTripCostBps: number;
  costChangedAction: boolean;
  costAssumptionSource: SignalPayload['executionPlan']['costEstimate']['assumptionSource'];
  costAssumptionVersion: string;
  costAssumptionSnapshotId: string;
  dataCompletenessScore: number;
  dataCompletenessStatus: SignalPayload['dataCompleteness']['status'];
  dataCompletenessMissingCritical: string[];
  fallbackHadFallback: boolean;
  fallbackEventCount: number;
  qualityGuardSuppressed: boolean;
  qualityGuardReason: string | null;
  qualityGuardFallbackRatio: number;
  forward1d: ForwardReturnLabel;
  forward5d: ForwardReturnLabel;
  forward10d: ForwardReturnLabel;
  forward20d: ForwardReturnLabel;
}

export interface ParityValidationConfig {
  tickers: string[];
  startDate: string;
  endDate: string;
  watchlistSliceSize: number;
  apiDelayMs: number;
  portfolioValue?: number;
  analysisContext?: Omit<AnalysisContext, 'asOfDate' | 'strictPointInTime'>;
  scanOptions?: Omit<
    ScanOptions,
    'tickers' | 'analysisContext' | 'portfolioValue'
  >;
}

export interface ParityValidationSummary {
  rows: number;
  tickers: number;
  asOfDates: number;
  rowsWithFallback: number;
  rowsSuppressedByQualityGuard: number;
  rowsWithUnavailableEarningsProvenance: number;
  rowsWithUnavailableRegimeProvenance: number;
}

export interface ParityValidationReport {
  generatedAt: string;
  config: ParityValidationConfig;
  summary: ParityValidationSummary;
  rows: ParityValidationRow[];
  warnings: string[];
}
