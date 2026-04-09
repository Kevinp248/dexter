import { formatDailyOperatorSummary } from '../daily-operator.js';

describe('daily operator summary formatter', () => {
  test('prints all required operational sections', () => {
    const lines = formatDailyOperatorSummary(
      {
        generatedAt: '2026-04-09T12:00:00.000Z',
        alertsGenerated: 2,
        csv: { rowsAppended: 2, rowsSkipped: 0 },
        weekly: { closedTrades: 4, winRatePct: 50 },
        quality: { overallHitRatePct: 52.5 },
        incidentsWritten: 1,
        nextActions: ['AAPL: HOLD', 'MSFT: consider manual BUY'],
      },
      true,
    );

    const output = lines.join('\n');
    expect(output).toContain('Generated alerts: 2');
    expect(output).toContain('CSV appended: 2, skipped: 0');
    expect(output).toContain('Weekly closed trades: 4, win rate: 50%');
    expect(output).toContain('30d hit rate: 52.5%');
    expect(output).toContain('Postmortem incidents written: 1');
    expect(output).toContain('Today next actions:');
    expect(output).toContain('- AAPL: HOLD');
  });
});
