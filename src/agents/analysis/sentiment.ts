import { fetchCompanyNews } from '../../data/market.js';
import { AnalysisContext } from './types.js';

const POSITIVE = ['beat', 'upgrade', 'growth', 'surge', 'record', 'bullish', 'win', 'expansion'];
const NEGATIVE = ['miss', 'downgrade', 'loss', 'lawsuit', 'regulatory', 'cut', 'warning', 'bearish'];

export interface SentimentSignal {
  ticker: string;
  score: number;
  summary: string;
  positive: number;
  negative: number;
}

function countMatches(text: string, list: string[]): number {
  return list.reduce((count, term) => (text.includes(term) ? count + 1 : count), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function daysBefore(date: string, days: number): string {
  const dt = new Date(date);
  dt.setDate(dt.getDate() - days);
  return dt.toISOString().slice(0, 10);
}

export async function runSentimentAnalysis(
  ticker: string,
  context: AnalysisContext = {},
): Promise<SentimentSignal> {
  const endDate = context.asOfDate ?? context.endDate;
  const startDate = endDate ? daysBefore(endDate, 7) : undefined;
  const articles = await fetchCompanyNews(ticker, 5, { startDate, endDate });
  let positives = 0;
  let negatives = 0;

  for (const article of articles) {
    const headline = (article.title ?? '').toLowerCase();
    positives += countMatches(headline, POSITIVE);
    negatives += countMatches(headline, NEGATIVE);
  }

  const total = Math.max(positives + negatives, 1);
  const rawScore = (positives - negatives) / total;
  const score = clamp(rawScore, -1, 1);
  const summary = `Positives ${positives} / Negatives ${negatives}`;

  return {
    ticker,
    score,
    summary,
    positive: positives,
    negative: negatives,
  };
}
