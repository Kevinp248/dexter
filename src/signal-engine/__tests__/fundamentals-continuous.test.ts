import { runFundamentalAnalysis } from '../../agents/analysis/fundamentals.js';
import { api } from '../../tools/finance/api.js';

describe('fundamentals continuous scoring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('computes ROIC from NOPAT / invested capital when fields are available', async () => {
    jest.spyOn(api, 'get').mockResolvedValue({
      data: {
        snapshot: {
          operating_income: 1_000,
          effective_tax_rate: 0.2,
          invested_capital: 5_000,
          return_on_equity: 0.16,
          net_margin: 0.22,
          operating_margin: 0.19,
        },
      },
      url: 'mock://financial-metrics',
    });

    const signal = await runFundamentalAnalysis('AAPL', {
      asOfDate: '2026-01-31',
      endDate: '2026-01-31',
    });

    expect(signal.metrics.nopat).toBeCloseTo(800, 6);
    expect(signal.metrics.investedCapital).toBeCloseTo(5_000, 6);
    expect(signal.metrics.roic).toBeCloseTo(0.16, 6);
    expect(signal.pillars.capitalEfficiency.details).toContain('ROIC');
  });

  test('returns null ROIC when data is insufficient and keeps pipeline stable', async () => {
    jest.spyOn(api, 'get').mockResolvedValue({
      data: {
        snapshot: {
          return_on_equity: 0.12,
          net_margin: 0.1,
        },
      },
      url: 'mock://financial-metrics',
    });

    const signal = await runFundamentalAnalysis('AAPL', {
      asOfDate: '2026-01-31',
      endDate: '2026-01-31',
    });

    expect(signal.metrics.roic).toBeNull();
    expect(signal.pillars.capitalEfficiency.score).toBe(0);
    expect(Number.isFinite(signal.score)).toBe(true);
  });

  test('continuous interpolation is monotonic for improving profitability inputs', async () => {
    const spy = jest.spyOn(api, 'get');
    spy
      .mockResolvedValueOnce({
        data: {
          snapshot: {
            return_on_equity: 0.06,
            net_margin: 0.09,
            operating_margin: 0.09,
            revenue_growth: 0.03,
            earnings_growth: 0.03,
            book_value_growth: 0.03,
            current_ratio: 1.1,
            debt_to_equity: 1.4,
            pe_ratio: 30,
            price_to_book_ratio: 4,
            price_to_sales_ratio: 6,
          },
        },
        url: 'mock://financial-metrics',
      })
      .mockResolvedValueOnce({
        data: {
          snapshot: {
            return_on_equity: 0.2,
            net_margin: 0.24,
            operating_margin: 0.22,
            revenue_growth: 0.12,
            earnings_growth: 0.14,
            book_value_growth: 0.12,
            current_ratio: 1.8,
            debt_to_equity: 0.5,
            pe_ratio: 24,
            price_to_book_ratio: 2.4,
            price_to_sales_ratio: 4,
            operating_income: 500,
            effective_tax_rate: 0.2,
            invested_capital: 3_000,
          },
        },
        url: 'mock://financial-metrics',
      });

    const weaker = await runFundamentalAnalysis('AAPL');
    const stronger = await runFundamentalAnalysis('AAPL');

    expect(stronger.pillars.profitability.score).toBeGreaterThan(
      weaker.pillars.profitability.score,
    );
    expect(stronger.score).toBeGreaterThan(weaker.score);
  });
});
