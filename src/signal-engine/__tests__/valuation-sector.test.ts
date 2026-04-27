import { runValuationAnalysis } from '../../agents/analysis/valuation.js';
import { api } from '../../tools/finance/api.js';

function mockValuationEndpoints(overrides?: {
  snapshot?: Record<string, unknown>;
  cashFlow?: Array<Record<string, unknown>>;
  income?: Array<Record<string, unknown>>;
}): jest.SpyInstance {
  const snapshot = {
    market_cap: 1_000_000_000_000,
    earnings_growth: 0.12,
    price_to_book_ratio: 6,
    return_on_equity: 0.25,
    pe_ratio: 30,
    ...(overrides?.snapshot ?? {}),
  };
  const cashFlow = overrides?.cashFlow ?? [
    { free_cash_flow: 100_000_000_000, capital_expenditure: -12_000_000_000 },
    { free_cash_flow: 92_000_000_000, capital_expenditure: -11_500_000_000 },
    { free_cash_flow: 85_000_000_000, capital_expenditure: -10_800_000_000 },
  ];
  const income = overrides?.income ?? [
    { net_income: 95_000_000_000, depreciation_and_amortization: 14_000_000_000 },
  ];

  return jest.spyOn(api, 'get').mockImplementation(async (endpoint: string) => {
    if (endpoint === '/financial-metrics/snapshot/') {
      return { data: { snapshot }, url: 'mock://snapshot' };
    }
    if (endpoint === '/financials/cash-flow-statements/') {
      return { data: { cash_flow_statements: cashFlow }, url: 'mock://cash-flow' };
    }
    if (endpoint === '/financials/income-statements/') {
      return { data: { income_statements: income }, url: 'mock://income' };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  });
}

describe('sector-aware valuation assumptions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses sector fair P/E table for multiples context', async () => {
    mockValuationEndpoints();
    const technology = await runValuationAnalysis('AAPL', { sector: 'Technology' });
    const financials = await runValuationAnalysis('TD', { sector: 'Financials' });

    expect(technology.context.fairPeAdjusted).toBeGreaterThan(
      financials.context.fairPeAdjusted,
    );
    expect(technology.context.sector).toBe('Technology');
    expect(financials.context.sector).toBe('Financials');
  });

  test('PEG adjustment is bounded by sector min/max assumptions', async () => {
    mockValuationEndpoints({
      snapshot: {
        earnings_growth: 0.9,
      },
    });
    const highGrowth = await runValuationAnalysis('AAPL', { sector: 'Technology' });
    expect(highGrowth.context.fairPeAdjusted).toBeLessThanOrEqual(36);

    jest.restoreAllMocks();
    mockValuationEndpoints({
      snapshot: {
        earnings_growth: -0.7,
      },
    });
    const negativeGrowth = await runValuationAnalysis('AAPL', { sector: 'Technology' });
    expect(negativeGrowth.context.fairPeAdjusted).toBeGreaterThanOrEqual(16);
  });
});
