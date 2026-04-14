import { parsePaperTradeCsv, summarizeWeeklyReview } from '../weekly-review.js';

describe('weekly review', () => {
  test('parses csv and computes summary metrics', () => {
    const csv = [
      'Date,Ticker,action,finalAction,Decision,Direction,Result (%),Reason for Override,Fallback Had Fallback,Fallback Reason,Fallback Retry Suggestion',
      '2026-04-03,AAPL,BUY,BUY,trade,long,2.5,,false,,',
      '2026-04-04,MSFT,BUY,HOLD,skip,none,,Cost gate respected,true,Fundamentals failed,Retry after market close',
      '2026-04-05,SHOP,SELL,SELL,trade,exit long,-1.2,,false,,',
      '2026-04-06,NVDA,COVER,COVER,trade,cover short,0.0,,false,,',
    ].join('\n');

    const rows = parsePaperTradeCsv(csv);
    expect(rows).toHaveLength(4);

    const summary = summarizeWeeklyReview(rows, {
      days: 7,
      asOf: new Date('2026-04-09T00:00:00.000Z'),
    });

    expect(summary.recordsInWindow).toBe(4);
    expect(summary.closedTrades).toBe(3);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.breakeven).toBe(1);
    expect(summary.winRatePct).toBe(33.33);
    expect(summary.averageResultPct).toBe(0.43);
    expect(summary.medianResultPct).toBe(0);
    expect(summary.fallbackCount).toBe(1);
    expect(summary.fallbackMissingRetryCount).toBe(0);
    expect(summary.finalActionBreakdown.BUY).toBe(1);
    expect(summary.finalActionBreakdown.HOLD).toBe(2);
    expect(summary.finalActionBreakdown.SELL).toBe(1);
    expect(summary.finalActionBreakdown.COVER).toBeUndefined();
  });

  test('tracks missing fallback retry guidance', () => {
    const csv = [
      'Date,Ticker,action,finalAction,Decision,Direction,Result (%),Reason for Override,Fallback Had Fallback,Fallback Reason,Fallback Retry Suggestion',
      '2026-04-08,TD,BUY,HOLD,skip,none,,Operator caution,true,Sentiment API failed,',
    ].join('\n');

    const rows = parsePaperTradeCsv(csv);
    const summary = summarizeWeeklyReview(rows, {
      days: 7,
      asOf: new Date('2026-04-09T00:00:00.000Z'),
    });

    expect(summary.fallbackCount).toBe(1);
    expect(summary.fallbackMissingRetryCount).toBe(1);
    expect(summary.checklist.some((item) => item.status === 'warn')).toBe(true);
  });
});
