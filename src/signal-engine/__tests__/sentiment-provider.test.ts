import { runSentimentAnalysis } from '../../agents/analysis/sentiment.js';
import { api } from '../../tools/finance/api.js';

describe('sentiment provider abstraction', () => {
  const originalFallback = process.env.SIGNAL_SENTIMENT_LLM_FALLBACK;

  beforeEach(() => {
    delete process.env.SIGNAL_SENTIMENT_LLM_FALLBACK;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFallback === undefined) {
      delete process.env.SIGNAL_SENTIMENT_LLM_FALLBACK;
    } else {
      process.env.SIGNAL_SENTIMENT_LLM_FALLBACK = originalFallback;
    }
  });

  test('uses structured provider sentiment when score fields are available', async () => {
    jest.spyOn(api, 'get').mockResolvedValue({
      data: {
        news: [
          {
            title: 'AAPL raises guidance after strong iPhone cycle',
            source: 'Reuters',
            url: 'https://example.com/1',
            publish_date: '2026-03-30',
            sentiment_score: 0.8,
            relevance_score: 0.9,
            sentiment_confidence: 0.85,
          },
          {
            title: 'AAPL faces weak demand in one region',
            source: 'Bloomberg',
            url: 'https://example.com/2',
            publish_date: '2026-03-29',
            sentiment_score: -0.4,
            relevance_score: 0.8,
            sentiment_confidence: 0.7,
          },
        ],
      },
      url: 'mock://news',
    });

    const signal = await runSentimentAnalysis('AAPL', {
      asOfDate: '2026-03-31',
      companyName: 'Apple Inc.',
    });

    expect(signal.provider).toBe('structured_news');
    expect(signal.usedArticleCount).toBe(2);
    expect(signal.score).toBeGreaterThan(0);
    expect(signal.evidence.length).toBeGreaterThan(0);
  });

  test('deduplicates repeated headlines and filters irrelevant stories', async () => {
    jest.spyOn(api, 'get').mockResolvedValue({
      data: {
        news: [
          {
            title: 'AAPL launches new enterprise features',
            source: 'Reuters',
            url: 'https://example.com/aapl-launch',
            publish_date: '2026-03-30',
            sentiment_score: 0.5,
            relevance_score: 0.92,
          },
          {
            title: 'AAPL launches new enterprise features',
            source: 'Reuters',
            url: 'https://example.com/aapl-launch',
            publish_date: '2026-03-30',
            sentiment_score: 0.5,
            relevance_score: 0.92,
          },
          {
            title: 'Crude oil markets rally on OPEC headlines',
            source: 'WSJ',
            url: 'https://example.com/oil',
            publish_date: '2026-03-29',
            sentiment_score: 0.9,
            relevance_score: 0.1,
          },
        ],
      },
      url: 'mock://news',
    });

    const signal = await runSentimentAnalysis('AAPL', {
      asOfDate: '2026-03-31',
      companyName: 'Apple Inc.',
    });

    expect(signal.articleCount).toBe(3);
    expect(signal.usedArticleCount).toBe(1);
    expect(signal.ignoredArticleCount).toBeGreaterThanOrEqual(1);
    expect(signal.score).toBeGreaterThan(0);
  });

  test('falls back to neutral when structured sentiment is unavailable', async () => {
    jest.spyOn(api, 'get').mockResolvedValue({
      data: {
        news: [{ title: 'AAPL updates product roadmap', url: 'https://example.com/no-score' }],
      },
      url: 'mock://news',
    });

    const signal = await runSentimentAnalysis('AAPL', {
      asOfDate: '2026-03-31',
      companyName: 'Apple Inc.',
    });

    expect(signal.provider).toBe('neutral_fallback');
    expect(signal.score).toBe(0);
    expect(signal.usedArticleCount).toBe(0);
  });
});
