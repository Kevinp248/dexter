import { runSentimentAnalysis } from '../../agents/analysis/sentiment.js';
import { fetchCompanyNews } from '../../data/market.js';
import { api } from '../../tools/finance/api.js';

describe('PIT availability filtering regression', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('excludes future-dated availability records and keeps missing with marker', async () => {
    jest.spyOn(api, 'get').mockResolvedValue({
      data: {
        news: [
          { title: 'future publish', publish_date: '2026-04-02', url: 'https://x/p' },
          { title: 'future available', available_date: '2026-04-03', url: 'https://x/a' },
          { title: 'future accepted', accepted_date: '2026-04-04', url: 'https://x/ac' },
          { title: 'future filed', filed_date: '2026-04-05', url: 'https://x/f' },
          { title: 'kept', publish_date: '2026-03-15', url: 'https://x/k' },
          { title: 'missing availability', url: 'https://x/m' },
        ],
      },
      url: 'mock://news',
    });

    const rows = await fetchCompanyNews('AAPL', 10, {
      asOfDate: '2026-03-31',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
    });

    const titles = rows.map((row) => String(row.title ?? ''));
    expect(titles).toContain('kept');
    expect(titles).toContain('missing availability');
    expect(titles).not.toContain('future publish');
    expect(titles).not.toContain('future available');
    expect(titles).not.toContain('future accepted');
    expect(titles).not.toContain('future filed');

    const missing = rows.find((row) => row.title === 'missing availability');
    expect(Boolean(missing?.__pitMissingAvailability)).toBe(true);
  });

  test('missing availability marker triggers conservative sentiment handling path', async () => {
    jest.spyOn(api, 'get').mockResolvedValue({
      data: {
        news: [{ title: 'growth beat', url: 'https://x/missing' }],
      },
      url: 'mock://news',
    });

    const sentiment = await runSentimentAnalysis('AAPL', {
      asOfDate: '2026-03-31',
      endDate: '2026-03-31',
    });

    expect(sentiment.pitAvailabilityMissing).toBe(true);
    expect(sentiment.summary).toContain('PIT availability incomplete');
    expect(sentiment.score).toBeCloseTo(0.85, 5);
  });
});
