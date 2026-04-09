import { fetchHistoricalPrices } from '../../data/market.js';

export interface TechnicalSignal {
  ticker: string;
  score: number; // normalized -1..1
  shortMA: number;
  longMA: number;
  momentum: number;
  volatility: number;
  bars: { date: string; close: number }[];
  summary: string;
}

function average(values: number[]): number {
  const cleaned = values.filter((value) => Number.isFinite(value));
  if (!cleaned.length) return 0;
  return cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export async function runTechnicalAnalysis(ticker: string): Promise<TechnicalSignal> {
  const history = await fetchHistoricalPrices(ticker, 40);
  const closes = history.map((bar) => bar.close).filter(Number.isFinite);

  const shortWindow = closes.slice(-5);
  const longWindow = closes.slice(-20);
  const shortMA = average(shortWindow);
  const longMA = average(longWindow);
  const momentum = longMA ? (shortMA - longMA) / longMA : 0;
  const volatility = closes.length
    ? (Math.max(...closes) - Math.min(...closes)) / (average(closes) || 1)
    : 0;
  const score = clamp(momentum * 2, -1, 1);

  const summary = `5d MA ${shortMA.toFixed(2)} vs 20d MA ${longMA.toFixed(2)}; momentum ${(momentum * 100).toFixed(
    1
  )}%`;

  return {
    ticker,
    score,
    shortMA,
    longMA,
    momentum,
    volatility,
    bars: history.map((bar) => ({ date: bar.date, close: bar.close })),
    summary,
  };
}
