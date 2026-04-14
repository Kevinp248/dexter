import { runTechnicalAnalysis } from '../../agents/analysis/technical.js';

type OverrideBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number;
  volume: number;
};

function buildBars(): OverrideBar[] {
  const bars: OverrideBar[] = [];
  for (let i = 0; i < 90; i += 1) {
    const dt = new Date('2025-01-01T00:00:00.000Z');
    dt.setUTCDate(dt.getUTCDate() + i);
    const close = 100 + i * 0.4;
    bars.push({
      date: dt.toISOString().slice(0, 10),
      open: close - 0.6,
      high: close + 1.2,
      low: close - 1.1,
      close,
      adjustedClose: close * 0.99,
      volume: 1_000_000 + i * 1000,
    });
  }

  // Malformed bars: missing effective high/low/close/volume (as NaN)
  bars[10].high = Number.NaN;
  bars[21].low = Number.NaN;
  bars[35].close = Number.NaN;
  bars[67].volume = Number.NaN;
  return bars;
}

describe('OHLCV alignment regression', () => {
  test('filters malformed bars at object-level and keeps derived series synchronized', async () => {
    const overrideBars = buildBars();
    const expectedDates = overrideBars
      .filter(
        (bar) =>
          Number.isFinite(bar.open) &&
          Number.isFinite(bar.high) &&
          Number.isFinite(bar.low) &&
          Number.isFinite(bar.close) &&
          Number.isFinite(bar.adjustedClose) &&
          Number.isFinite(bar.volume),
      )
      .map((bar) => bar.date);

    const technical = await runTechnicalAnalysis('AAPL', {
      priceHistoryOverride: overrideBars as any,
    });

    expect(technical.bars.map((bar) => bar.date)).toEqual(expectedDates);
    expect(technical.bars.length).toBe(expectedDates.length);
    expect(technical.returns.length).toBe(Math.max(technical.bars.length - 1, 0));

    for (const bar of technical.bars) {
      expect(Number.isFinite(bar.close)).toBe(true);
      expect(Number.isFinite(bar.rawClose)).toBe(true);
      expect(Number.isFinite(bar.volume)).toBe(true);
    }

    // Indicator outputs should remain numeric and stable (no silent index-shift/desync).
    expect(Number.isFinite(technical.subSignals.trend.metrics.ema8)).toBe(true);
    expect(Number.isFinite(technical.subSignals.trend.metrics.ema21)).toBe(true);
    expect(Number.isFinite(technical.subSignals.trend.metrics.ema55)).toBe(true);
    expect(Number.isFinite(technical.subSignals.trend.metrics.adxProxy)).toBe(true);
  });
});
