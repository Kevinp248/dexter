import { resolveRetryEndDateForInvalidProviderDate } from '../market.js';

describe('market end-date retry resolver', () => {
  test('returns provider-today date when Invalid end_date error includes provider date', () => {
    const retry = resolveRetryEndDateForInvalidProviderDate(
      '2026-04-14',
      '2026-01-01',
      'request failed: 400 Bad Request (end_date must be today (2026-04-13) or older)',
    );
    expect(retry).toBe('2026-04-13');
  });

  test('falls back to previous day when provider date is unavailable', () => {
    const retry = resolveRetryEndDateForInvalidProviderDate(
      '2026-04-14',
      '2026-01-01',
      'request failed: 400 Bad Request (Invalid end_date)',
    );
    expect(retry).toBe('2026-04-13');
  });

  test('returns null for non end-date errors', () => {
    const retry = resolveRetryEndDateForInvalidProviderDate(
      '2026-04-14',
      '2026-01-01',
      'request failed: 402 Payment Required',
    );
    expect(retry).toBeNull();
  });

  test('returns null when retry would be before startDate', () => {
    const retry = resolveRetryEndDateForInvalidProviderDate(
      '2026-01-01',
      '2026-01-01',
      'request failed: 400 Bad Request (Invalid end_date)',
    );
    expect(retry).toBeNull();
  });
});
