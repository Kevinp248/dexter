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
}

export interface SignalPayload {
  ticker: string;
  action: SignalAction;
  confidence: number;
  positionContext: PositionContext;
  reasoning: {
    components: SignalComponent[];
    risk: RiskAssessment;
    aggregateScore: number;
    weightedInputs: Record<string, number>;
  };
  watchlist: WatchlistEntry;
  generatedAt: string;
}
