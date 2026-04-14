import { parsePaperTradeCsv } from '../weekly-review.js';
import { summarizeSignalQuality } from '../signal-quality.js';

describe('signal quality dashboard', () => {
  test('computes hit rates by action and confidence bucket', () => {
    const csv = [
      'Date,Ticker,action,finalAction,Confidence,Decision,Direction,Result (%)',
      '2026-04-01,AAPL,BUY,BUY,82,trade,long,2.0',
      '2026-04-02,MSFT,BUY,BUY,78,trade,long,-1.0',
      '2026-04-03,NVDA,SELL,SELL,65,trade,exit long,1.5',
      '2026-04-04,SHOP,HOLD,HOLD,20,skip,none,',
      '2026-04-05,TD,COVER,COVER,35,trade,cover short,0.5',
      '2026-04-06,MELI,BUY,BUY,,trade,long,3.0',
    ].join('\n');

    const rows = parsePaperTradeCsv(csv);
    const summary = summarizeSignalQuality(rows, {
      days: 10,
      asOf: new Date('2026-04-09T00:00:00.000Z'),
    });

    expect(summary.closedTrades).toBe(5);
    expect(summary.overallHitRatePct).toBe(80);
    expect(summary.byAction.BUY.count).toBe(3);
    expect(summary.byAction.BUY.hitRatePct).toBe(66.67);
    expect(summary.byAction.SELL.hitRatePct).toBe(100);
    expect(summary.byAction.HOLD.hitRatePct).toBe(100);

    expect(summary.byConfidenceBucket.HIGH.count).toBe(2);
    expect(summary.byConfidenceBucket.HIGH.hitRatePct).toBe(50);
    expect(summary.byConfidenceBucket.MEDIUM.count).toBe(1);
    expect(summary.byConfidenceBucket.LOW.count).toBe(1);
    expect(summary.byConfidenceBucket.UNKNOWN.count).toBe(1);
    expect(
      summary.notes.some((note) => note.includes('missing confidence')),
    ).toBe(true);
  });
});
