import {
  formatEvidenceBundle,
  isTrustedSourceUrl,
} from '../grounded-research.js';

describe('grounded research guardrail', () => {
  test('accepts trusted sources and rejects non-whitelisted domains', () => {
    expect(isTrustedSourceUrl('https://www.sec.gov/ixviewer')).toBe(true);
    expect(isTrustedSourceUrl('https://www.reuters.com/markets/us/')).toBe(true);
    expect(isTrustedSourceUrl('https://random-blog.example.com/post')).toBe(false);
  });

  test('formats evidence bundle with trust tier split', () => {
    const bundle = formatEvidenceBundle(
      'AAPL had a material filing update',
      [
        {
          source: 'SEC filing',
          url: 'https://www.sec.gov/ixviewer/ix.html',
          snippet: 'Form 8-K published today',
        },
        {
          source: 'Unknown blog',
          url: 'https://random-blog.example.com/aapl-rumor',
          snippet: 'Unsourced claim',
        },
      ],
      '2026-04-09T12:00:00.000Z',
    );

    expect(bundle.accepted).toHaveLength(1);
    expect(bundle.rejected).toHaveLength(1);
    expect(bundle.accepted[0].trustTier).toBe('tier1');
    expect(bundle.rejected[0].trustTier).toBe('rejected');
    expect(bundle.accepted[0].retrievedAt).toBe('2026-04-09T12:00:00.000Z');
  });
});
