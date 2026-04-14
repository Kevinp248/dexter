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

function buildBars(length: number, start = 100, step = 0.8): OverrideBar[] {
  const bars: OverrideBar[] = [];
  for (let i = 0; i < length; i += 1) {
    const date = new Date('2025-01-01T00:00:00.000Z');
    date.setUTCDate(date.getUTCDate() + i);
    const close = start + i * step;
    bars.push({
      date: date.toISOString().slice(0, 10),
      open: close - 0.5,
      high: close + 0.8,
      low: close - 0.8,
      close,
      adjustedClose: close,
      volume: 1_000_000 + i * 1000,
    });
  }
  return bars;
}

describe('technical MACD signal', () => {
  test('includes deterministic MACD metrics in output', async () => {
    const technical = await runTechnicalAnalysis('AAPL', {
      priceHistoryOverride: buildBars(120),
    });

    expect(technical.subSignals.macd).toBeDefined();
    expect(Number.isFinite(technical.subSignals.macd.metrics.macdLine)).toBe(true);
    expect(Number.isFinite(technical.subSignals.macd.metrics.signalLine)).toBe(true);
    expect(Number.isFinite(technical.subSignals.macd.metrics.histogram)).toBe(true);
    expect(Number.isFinite(technical.subSignals.macd.metrics.histogramSlope)).toBe(true);
    expect(technical.summary).toContain('MACD');
  });

  test('uses adjusted-close series for MACD sensitivity', async () => {
    const bars = buildBars(120, 100, 0.4).map((bar, idx) => ({
      ...bar,
      // Simulate a corporate action impact in raw close while adjusted close stays smooth.
      close: idx > 90 ? bar.close * 1.08 : bar.close,
    }));

    const technical = await runTechnicalAnalysis('AAPL', {
      priceHistoryOverride: bars,
    });

    expect(Math.abs(technical.subSignals.macd.metrics.histogram)).toBeLessThan(0.5);
  });
});
