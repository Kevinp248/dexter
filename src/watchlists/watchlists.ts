export type WatchlistRegion = 'US' | 'CA';
export type WatchlistCurrency = 'USD' | 'CAD';

export interface WatchlistEntry {
  ticker: string;
  name: string;
  region: WatchlistRegion;
  exchange: string;
  currency: WatchlistCurrency;
  sector: string;
  rationale: string;
}

const WATCHLIST: WatchlistEntry[] = [
  {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    region: 'US',
    exchange: 'NASDAQ',
    currency: 'USD',
    sector: 'Technology',
    rationale: 'Large-cap growth anchor with stable cash flow and share buybacks.',
  },
  {
    ticker: 'MSFT',
    name: 'Microsoft Corp.',
    region: 'US',
    exchange: 'NASDAQ',
    currency: 'USD',
    sector: 'Technology',
    rationale: 'Recurring enterprise revenue and strong cloud presence.',
  },
  {
    ticker: 'NVDA',
    name: 'NVIDIA Corp.',
    region: 'US',
    exchange: 'NASDAQ',
    currency: 'USD',
    sector: 'Semiconductors',
    rationale: 'AI/accelerator leader that drives high-margin growth.',
  },
  {
    ticker: 'SHOP',
    name: 'Shopify Inc.',
    region: 'CA',
    exchange: 'TSX',
    currency: 'CAD',
    sector: 'E-commerce',
    rationale: 'E-commerce platform with global expansion tailwinds.',
  },
  {
    ticker: 'TD',
    name: 'Toronto-Dominion Bank',
    region: 'CA',
    exchange: 'TSX',
    currency: 'CAD',
    sector: 'Financials',
    rationale: 'Diversified retail bank with US presence and defensive yield.',
  },
  {
    ticker: 'MELI',
    name: 'MercadoLibre, Inc.',
    region: 'US',
    exchange: 'NASDAQ',
    currency: 'USD',
    sector: 'Internet Services',
    rationale: 'Latin American e-commerce/fintech platform with secular runway.',
  },
];

export function getDefaultWatchlist(): WatchlistEntry[] {
  return [...WATCHLIST];
}
