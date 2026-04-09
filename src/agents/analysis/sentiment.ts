import { fetchCompanyNews } from '../../data/market.js';

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

export async function runSentimentAnalysis(ticker: string): Promise<SentimentSignal> {
  const articles = await fetchCompanyNews(ticker, 5);
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
