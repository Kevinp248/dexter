import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  bestHoldoutRowBySharpe,
  buildSma20HoldoutValidationReport,
  finalHoldoutVerdict,
  pairHoldoutRows,
  splitArtifactByWindow,
  validateSma20HoldoutConfig,
  type Sma20HoldoutRow,
} from '../research/sma20-holdout-validation.js';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';

function makeDate(offset: number): string {
  const d = new Date('2024-12-28T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRow(ticker: string, index: number, price: number, feature = index): PriceFeatureLabelRow {
  return {
    ticker,
    date: makeDate(index),
    close: price,
    adjustedClose: price,
    priceUsed: price,
    priceSource: 'adjusted_close',
    open: price,
    high: price,
    low: price,
    volume: 1_000_000,
    range_pct: feature,
    ret_1d: feature,
    ret_5d: feature,
    ret_20d: feature,
    sma_20_gap: feature,
    sma_50_gap: feature,
    vol_20d: feature,
    drawdown_252d: feature,
    fwd_ret_1d: null,
    fwd_ret_5d: null,
    fwd_ret_10d: null,
    fwd_ret_20d: null,
    fwd_ret_after_cost_1d: null,
    fwd_ret_after_cost_5d: null,
    fwd_ret_after_cost_10d: null,
    fwd_ret_after_cost_20d: null,
    label_available_1d: false,
    label_available_5d: false,
    label_available_10d: false,
    label_available_20d: false,
  };
}

function makeArtifact(rows: PriceFeatureLabelRow[]): PriceFeatureLabelArtifact {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const tickers = Array.from(new Set(sorted.map((row) => row.ticker))).sort((a, b) => a.localeCompare(b));
  return {
    lane: 'research_only',
    datasetType: 'price_features_and_forward_labels',
    schemaVersion: 'price_feature_label_v1',
    vendor: 'yahoo',
    generatedAt: '2026-04-26T00:00:00.000Z',
    sourceArtifactPath: '/tmp/source.json',
    sourceArtifactProvenance: {
      generatedAt: '2026-04-26T00:00:00.000Z',
      assembledAt: '2026-04-26T00:00:00.000Z',
      sourceFetchedAt: '2026-04-26T00:00:00.000Z',
      sourceFetchedAtMin: '2026-04-26T00:00:00.000Z',
      sourceFetchedAtMax: '2026-04-26T00:00:00.000Z',
    },
    priceBasis: {
      requested: 'adjusted_close_if_available_else_close',
      applied: 'adjusted_close_if_available_else_close',
      notes: ['test fixture'],
    },
    labelBasis: 'selected_price_to_selected_price',
    labelCostAssumption: {
      roundTripCostBps: 10,
      roundTripCostDecimal: 0.001,
      notes: ['test fixture'],
    },
    features: {
      included: [
        'ret_1d',
        'ret_5d',
        'ret_20d',
        'sma_20_gap',
        'sma_50_gap',
        'vol_20d',
        'drawdown_252d',
        'range_pct',
      ],
    },
    labels: {
      included: [
        'fwd_ret_1d',
        'fwd_ret_5d',
        'fwd_ret_10d',
        'fwd_ret_20d',
        'fwd_ret_after_cost_1d',
        'fwd_ret_after_cost_5d',
        'fwd_ret_after_cost_10d',
        'fwd_ret_after_cost_20d',
        'label_available_1d',
        'label_available_5d',
        'label_available_10d',
        'label_available_20d',
      ],
    },
    summary: {
      rowCount: sorted.length,
      firstDate: sorted[0]?.date ?? null,
      lastDate: sorted[sorted.length - 1]?.date ?? null,
      tickers,
      tickerCoverage: tickers.map((ticker) => {
        const tickerRows = sorted.filter((row) => row.ticker === ticker);
        return {
          ticker,
          rowCount: tickerRows.length,
          firstDate: tickerRows[0]?.date ?? null,
          lastDate: tickerRows[tickerRows.length - 1]?.date ?? null,
        };
      }),
      usableLabelCounts: { '1d': 0, '5d': 0, '10d': 0, '20d': 0 },
      nullFeatureCounts: {
        ret_1d: 0,
        ret_5d: 0,
        ret_20d: 0,
        sma_20_gap: 0,
        sma_50_gap: 0,
        vol_20d: 0,
        drawdown_252d: 0,
        range_pct: 0,
      },
    },
    warnings: [],
    rows: sorted,
  };
}

function holdoutRow(overrides: Partial<Sma20HoldoutRow> = {}): Sma20HoldoutRow {
  return {
    windowId: 'holdout',
    startDate: '2025-01-01',
    endDate: '2026-04-24',
    topN: 2,
    costBps: 0,
    totalReturn: 0,
    CAGR: 0,
    Sharpe: 0,
    maxDrawdown: -0.2,
    Calmar: 0,
    numberOfTrades: 20,
    turnover: 1,
    winRate: 0.5,
    benchmarkRelativeReturn: 0,
    benchmarkRelativeMaxDrawdown: 0,
    profitVerdict: 'reject',
    ...overrides,
  };
}

describe('research SMA20 holdout validation', () => {
  test('date split keeps rows inside each window only', () => {
    const rows = [
      makeRow('AAPL', 0, 100),
      makeRow('AAPL', 1, 101),
      makeRow('AAPL', 2, 102),
      makeRow('MSFT', 2, 102),
    ];

    const split = splitArtifactByWindow(makeArtifact(rows), {
      windowId: 'research',
      startDate: '2024-12-29',
      endDate: '2024-12-30',
    });

    expect(split.rows.map((row) => row.date)).toEqual(['2024-12-29', '2024-12-30', '2024-12-30']);
    expect(split.summary.rowCount).toBe(3);
    expect(split.summary.tickers).toEqual(['AAPL', 'MSFT']);
  });

  test('paired rows align by topN and costBps', () => {
    const pairs = pairHoldoutRows([
      holdoutRow({ windowId: 'research', topN: 2, costBps: 0, profitVerdict: 'research_candidate', totalReturn: 1 }),
      holdoutRow({ windowId: 'holdout', topN: 2, costBps: 0, profitVerdict: 'weak', totalReturn: 0.5 }),
      holdoutRow({ windowId: 'research', topN: 4, costBps: 10, profitVerdict: 'reject', totalReturn: -0.1 }),
      holdoutRow({ windowId: 'holdout', topN: 4, costBps: 10, profitVerdict: 'research_candidate', totalReturn: 1.2 }),
    ]);

    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ topN: 2, costBps: 0, verdictTransition: 'candidate_to_weak' });
    expect(pairs[1]).toMatchObject({ topN: 4, costBps: 10, verdictTransition: 'reject_to_candidate' });
  });

  test('final verdict works for pass, fragile, and fail fixtures', () => {
    const passRows = [
      holdoutRow({ windowId: 'research', topN: 6, costBps: 10, profitVerdict: 'research_candidate' }),
      holdoutRow({ windowId: 'holdout', topN: 6, costBps: 10, profitVerdict: 'research_candidate' }),
    ];
    expect(finalHoldoutVerdict(passRows, pairHoldoutRows(passRows))).toBe('holdout_pass');

    const fragileRows = [
      holdoutRow({ windowId: 'research', profitVerdict: 'research_candidate' }),
      holdoutRow({ windowId: 'holdout', profitVerdict: 'weak' }),
    ];
    expect(finalHoldoutVerdict(fragileRows, pairHoldoutRows(fragileRows))).toBe('holdout_fragile');

    const failRows = [
      holdoutRow({ windowId: 'research', profitVerdict: 'research_candidate' }),
      holdoutRow({ windowId: 'holdout', profitVerdict: 'reject' }),
    ];
    expect(finalHoldoutVerdict(failRows, pairHoldoutRows(failRows))).toBe('holdout_fail');
  });

  test('best-row selection is deterministic', () => {
    const rows = [
      holdoutRow({ topN: 6, costBps: 0, Sharpe: 1 }),
      holdoutRow({ topN: 2, costBps: 0, Sharpe: 1 }),
    ];

    expect(bestHoldoutRowBySharpe(rows)?.topN).toBe(2);
  });

  test('invalid date window rejects clearly', () => {
    expect(() =>
      validateSma20HoldoutConfig({
        researchWindow: {
          startDate: '2025-01-01',
          endDate: '2024-12-31',
        },
      }),
    ).toThrow('Invalid research window: startDate 2025-01-01 is after endDate 2024-12-31.');
  });

  test('overlapping windows are rejected', () => {
    expect(() =>
      validateSma20HoldoutConfig({
        researchWindow: {
          startDate: '2021-01-04',
          endDate: '2025-06-30',
        },
        holdoutWindow: {
          startDate: '2025-01-01',
          endDate: '2026-04-24',
        },
      }),
    ).toThrow('Invalid holdout split: research endDate 2025-06-30 must be before holdout startDate 2025-01-01.');
  });

  test('adjacent valid windows are accepted', () => {
    expect(() =>
      validateSma20HoldoutConfig({
        researchWindow: {
          startDate: '2021-01-04',
          endDate: '2024-12-31',
        },
        holdoutWindow: {
          startDate: '2025-01-01',
          endDate: '2026-04-24',
        },
      }),
    ).not.toThrow();
  });

  test('default config remains valid', () => {
    expect(() => validateSma20HoldoutConfig({})).not.toThrow();
  });

  test('builds 9 rows per window from fixture artifact', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 90; i += 1) {
      rows.push(makeRow('AAPL', i, 100 + i, i));
      rows.push(makeRow('MSFT', i, 100 + i * 0.5, i + 1));
      rows.push(makeRow('NVDA', i, 100 + i * 1.5, i + 2));
    }

    const report = buildSma20HoldoutValidationReport(makeArtifact(rows), {
      researchWindow: { startDate: '2024-12-28', endDate: '2025-01-31' },
      holdoutWindow: { startDate: '2025-02-01', endDate: '2025-03-27' },
      minTradesForCandidate: 1,
    });

    expect(report.rows.filter((row) => row.windowId === 'research')).toHaveLength(9);
    expect(report.rows.filter((row) => row.windowId === 'holdout')).toHaveLength(9);
    expect(report.pairedComparisons).toHaveLength(9);
  });

  test('production signal entrypoints do not import holdout module', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/sma20-holdout-validation');
    expect(indexSource).not.toContain('./research/sma20-holdout-validation');
    expect(dailyScanSource).not.toContain('signal-engine/research/sma20-holdout-validation');
    expect(dailyScanSource).not.toContain('./research/sma20-holdout-validation');
  });
});
