import { logger } from '../utils/logger.js';
import { getDefaultWatchlist } from '../watchlists/watchlists.js';
import { runTechnicalAnalysis } from '../agents/analysis/technical.js';
import { runFundamentalAnalysis } from '../agents/analysis/fundamentals.js';
import { runSentimentAnalysis } from '../agents/analysis/sentiment.js';
import { reviewRisk } from '../risk/risk.js';
import { resolveAction, deriveConfidence } from './rules.js';
import { SignalComponent, SignalPayload } from './models.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function safeRun<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`Signal component ${label} failed: ${error}`);
    return fallback;
  }
}

export async function runDailyScan(): Promise<{ generatedAt: string; alerts: SignalPayload[] }> {
  const generatedAt = new Date().toISOString();
  const watchlist = getDefaultWatchlist();
  const alerts: SignalPayload[] = [];

  for (const entry of watchlist) {
    const technical = await safeRun(
      () => runTechnicalAnalysis(entry.ticker),
      {
        ticker: entry.ticker,
        score: 0,
        shortMA: 0,
        longMA: 0,
        momentum: 0,
        volatility: 0,
        bars: [],
        summary: 'Technical data unavailable',
      },
      'technical',
    );

    const fundamental = await safeRun(
      () => runFundamentalAnalysis(entry.ticker),
      {
        ticker: entry.ticker,
        score: 0,
        metrics: {},
        summary: 'Fundamental data unavailable',
      },
      'fundamental',
    );

    const sentiment = await safeRun(
      () => runSentimentAnalysis(entry.ticker),
      {
        ticker: entry.ticker,
        score: 0,
        summary: 'Sentiment data unavailable',
        positive: 0,
        negative: 0,
      },
      'sentiment',
    );

    const aggregateScore = clamp(
      technical.score * 0.4 + fundamental.score * 0.4 + sentiment.score * 0.2,
      -1,
      1,
    );

    const risk = reviewRisk(technical, fundamental);
    const action = resolveAction(aggregateScore, risk);
    const confidence = deriveConfidence(aggregateScore, risk);

    const components: SignalComponent[] = [
      {
        name: 'Technical',
        score: technical.score,
        details: {
          summary: technical.summary,
          shortMA: technical.shortMA,
          longMA: technical.longMA,
          momentum: technical.momentum,
        },
      },
      {
        name: 'Fundamental',
        score: fundamental.score,
        details: {
          summary: fundamental.summary,
          metrics: fundamental.metrics,
        },
      },
      {
        name: 'Sentiment',
        score: sentiment.score,
        details: {
          summary: sentiment.summary,
          positive: sentiment.positive,
          negative: sentiment.negative,
        },
      },
    ];

    const payload: SignalPayload = {
      ticker: entry.ticker,
      action,
      confidence,
      reasoning: {
        components,
        risk,
        aggregateScore,
      },
      watchlist: entry,
      generatedAt,
    };

    logger.info(`Generated signal for ${entry.ticker}`, payload);
    alerts.push(payload);
  }

  return { generatedAt, alerts };
}
