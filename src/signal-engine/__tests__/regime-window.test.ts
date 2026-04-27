import { regimeSpyCalendarWindowDays } from '../index.js';

describe('regime SPY calendar window sizing', () => {
  test('provides a sufficiently buffered window for SMA200 fetches', () => {
    const windowDays = regimeSpyCalendarWindowDays(200);
    expect(windowDays).toBe(350);
    expect(windowDays).toBeGreaterThan(200);
  });

  test('handles small lookbacks deterministically', () => {
    expect(regimeSpyCalendarWindowDays(1)).toBeGreaterThanOrEqual(31);
  });
});
