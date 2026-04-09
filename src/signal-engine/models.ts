import { RiskAssessment } from '../risk/risk.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD' | 'COVER';

export interface SignalComponent<T = Record<string, unknown>> {
  name: string;
  score: number;
  details: T;
}

export interface SignalPayload {
  ticker: string;
  action: SignalAction;
  confidence: number;
  reasoning: {
    components: SignalComponent[];
    risk: RiskAssessment;
    aggregateScore: number;
  };
  watchlist: WatchlistEntry;
  generatedAt: string;
}
