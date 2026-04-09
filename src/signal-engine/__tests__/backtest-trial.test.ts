import { PriceBar } from '../../data/market.js';
import { runTrialBacktest } from '../backtest-trial.js';

function weekdayBars(startDate: string, endDate: string): PriceBar[] {
  const out: PriceBar[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  let price = 100;
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push({
        date: cursor.toISOString().slice(0, 10),
        open: price,
        high: price + 1,
        low: price - 1,
        close: price + 0.5,
        volume: 1_000_000,
      });
      price += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

describe('trial backtest', () => {
  test('uses signal date then executes at next trading day open (no lookahead)', async () => {
    const bars = weekdayBars('2026-01-01', '2026-01-12');
    const tradingDates = bars.map((bar) => bar.date);
    const signalDates: string[] = [];

    const report = await runTrialBacktest(
      {
        ticker: 'AAPL',
        startDate: '2026-01-01',
        endDate: '2026-01-12',
        initialCapitalUsd: 10_000,
      },
      {
        getBars: async () => bars,
        runSignal: async ({ asOfDate }) => {
          signalDates.push(asOfDate);
          return {
            finalAction: asOfDate === tradingDates[0] ? 'BUY' : 'HOLD',
            fallbackUsed: false,
            targetNotionalUsd: 5_000,
            oneWayCostBps: 10,
          };
        },
      },
    );

    expect(signalDates).toEqual(tradingDates);
    const firstExec = report.executionRows[0];
    expect(firstExec.signalDate).toBe(tradingDates[0]);
    expect(firstExec.executionDate).toBe(tradingDates[1]);
    expect(firstExec.fillPrice).toBe(bars[1].open);
  });

  test('maps COVER to HOLD in long-only mode', async () => {
    const bars = weekdayBars('2026-01-01', '2026-01-05');
    const report = await runTrialBacktest(
      {
        ticker: 'AAPL',
        startDate: '2026-01-01',
        endDate: '2026-01-05',
      },
      {
        getBars: async () => bars,
        runSignal: async () => ({
          finalAction: 'COVER',
          fallbackUsed: false,
          targetNotionalUsd: 0,
          oneWayCostBps: 10,
        }),
      },
    );

    expect(report.executionRows).toHaveLength(0);
    expect(report.dailyRecords.some((row) => row.actionNote.includes('COVER mapped to HOLD'))).toBe(
      true,
    );
  });

  test('equity reconciliation holds for all daily rows', async () => {
    const bars = weekdayBars('2026-01-01', '2026-01-10');
    const report = await runTrialBacktest(
      {
        ticker: 'AAPL',
        startDate: '2026-01-01',
        endDate: '2026-01-10',
      },
      {
        getBars: async () => bars,
        runSignal: async ({ asOfDate }) => ({
          finalAction: asOfDate === bars[0].date ? 'BUY' : asOfDate === bars[3].date ? 'SELL' : 'HOLD',
          fallbackUsed: false,
          targetNotionalUsd: 4_000,
          oneWayCostBps: 10,
        }),
      },
    );

    for (const row of report.dailyRecords) {
      expect(Math.abs(row.cashUsd + row.positionValueUsd - row.equityUsd)).toBeLessThan(0.01);
    }
  });

  test('january report includes 31 calendar rows', async () => {
    const bars = weekdayBars('2026-01-01', '2026-01-31');
    const report = await runTrialBacktest(
      {
        ticker: 'AAPL',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      {
        getBars: async () => bars,
        runSignal: async () => ({
          finalAction: 'HOLD',
          fallbackUsed: false,
          targetNotionalUsd: 0,
          oneWayCostBps: 10,
        }),
      },
    );
    expect(report.dailyRecords).toHaveLength(31);
  });
});
