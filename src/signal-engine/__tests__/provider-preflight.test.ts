import { afterEach, describe, expect, test } from '@jest/globals';
import { PriceBar } from '../../data/market.js';
import { loadUniverseManifest } from '../validation/parity-walk-forward.js';
import {
  DEFAULT_SMOKE_MANIFEST_PATH,
  runProviderPreflight,
} from '../validation/provider-preflight.js';

function makeBars(count: number, startDate = '2026-01-01'): PriceBar[] {
  const out: PriceBar[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  for (let i = 0; i < count; i += 1) {
    const close = 100 + i;
    out.push({
      date: cursor.toISOString().slice(0, 10),
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      adjustedClose: close,
      volume: 100_000 + i,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const originalApiKey = process.env.FINANCIAL_DATASETS_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.FINANCIAL_DATASETS_API_KEY;
  } else {
    process.env.FINANCIAL_DATASETS_API_KEY = originalApiKey;
  }
});

describe('provider preflight', () => {
  test('smoke manifest loads and excludes unsupported .TO and ETF tickers', async () => {
    const manifest = await loadUniverseManifest(DEFAULT_SMOKE_MANIFEST_PATH);
    expect(manifest.tickers.length).toBeGreaterThanOrEqual(5);
    expect(manifest.tickers.length).toBeLessThanOrEqual(8);
    expect(manifest.tickers.some((item) => item.ticker.endsWith('.TO'))).toBe(false);
    expect(manifest.tickers.some((item) => ['SPY', 'QQQ'].includes(item.ticker))).toBe(false);
  });

  test('preflight groups warnings/errors by endpoint and ticker', async () => {
    process.env.FINANCIAL_DATASETS_API_KEY = 'test-key';
    const report = await runProviderPreflight(
      {
        tickers: ['AAPL', 'MSFT'],
        asOfDate: '2026-03-15',
      },
      {
        loadUniverseManifestFn: async () => ({
          name: 'test',
          tickers: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }],
        }),
        fetchHistoricalPricesFn: async (ticker) => {
          if (ticker === 'MSFT') return makeBars(8);
          if (ticker === 'SPY' || ticker === 'VIXY') return makeBars(20);
          return makeBars(8);
        },
        fetchKeyRatiosFn: async (ticker) => {
          if (ticker === 'MSFT') throw new Error('401 Unauthorized');
          return { pe_ratio: 20 };
        },
        fetchCashFlowStatementsFn: async () => [],
        fetchIncomeStatementsFn: async () => [{}],
        fetchCompanyNewsFn: async () => [],
        fetchUpcomingEarningsDateFn: async () => null,
      },
    );

    const fundamentals = report.byEndpoint.find((row) => row.key === 'fundamentals');
    expect(fundamentals).toBeDefined();
    expect((fundamentals?.warn ?? 0) + (fundamentals?.fail ?? 0)).toBeGreaterThan(0);

    const msft = report.byTicker.find((row) => row.key === 'MSFT');
    expect(msft).toBeDefined();
    expect((msft?.warn ?? 0) + (msft?.fail ?? 0)).toBeGreaterThan(0);
  });

  test('missing API key produces a clear warning', async () => {
    delete process.env.FINANCIAL_DATASETS_API_KEY;
    const report = await runProviderPreflight(
      {
        tickers: ['AAPL'],
        asOfDate: '2026-03-15',
      },
      {
        loadUniverseManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
        fetchHistoricalPricesFn: async () => makeBars(10),
        fetchKeyRatiosFn: async () => ({ pe_ratio: 21 }),
        fetchCashFlowStatementsFn: async () => [{}],
        fetchIncomeStatementsFn: async () => [{}],
        fetchCompanyNewsFn: async () => [{}],
        fetchUpcomingEarningsDateFn: async () => '2026-04-30',
      },
    );
    expect(report.apiKeyPresent).toBe(false);
    expect(
      report.warnings.some((warning) =>
        warning.includes('FINANCIAL_DATASETS_API_KEY is missing'),
      ),
    ).toBe(true);
  });

  test('no usable prices triggers hard failure', async () => {
    await expect(
      runProviderPreflight(
        {
          tickers: ['AAPL', 'MSFT'],
          asOfDate: '2026-03-15',
        },
        {
          loadUniverseManifestFn: async () => ({
            name: 'test',
            tickers: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }],
          }),
          fetchHistoricalPricesFn: async () => [],
          fetchKeyRatiosFn: async () => ({}),
          fetchCashFlowStatementsFn: async () => [],
          fetchIncomeStatementsFn: async () => [],
          fetchCompanyNewsFn: async () => [],
          fetchUpcomingEarningsDateFn: async () => null,
        },
      ),
    ).rejects.toThrow('no usable price coverage');
  });

  test('partial fundamentals/earnings failures return warnings without crash', async () => {
    process.env.FINANCIAL_DATASETS_API_KEY = 'test-key';
    const report = await runProviderPreflight(
      {
        tickers: ['AAPL'],
        asOfDate: '2026-03-15',
      },
      {
        loadUniverseManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
        fetchHistoricalPricesFn: async (ticker) => {
          if (ticker === 'SPY' || ticker === 'VIXY') return makeBars(20);
          return makeBars(10);
        },
        fetchKeyRatiosFn: async () => ({}),
        fetchCashFlowStatementsFn: async () => [],
        fetchIncomeStatementsFn: async () => [],
        fetchCompanyNewsFn: async () => [],
        fetchUpcomingEarningsDateFn: async () => null,
      },
    );

    expect(report.usablePriceTickers).toEqual(['AAPL']);
    expect(report.warnings.some((warning) => warning.includes('[fundamentals] AAPL'))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('[earnings] AAPL'))).toBe(true);
  });
});
