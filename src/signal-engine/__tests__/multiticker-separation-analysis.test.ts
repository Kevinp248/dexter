import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildMultiTickerSeparationReport,
  persistMultiTickerSeparationReport,
} from '../research/multiticker-separation-analysis.js';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';

type RowBuilder = (index: number) => {
  feature: number;
  label5: number;
  label20: number;
};

function makeDate(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(start.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRows(ticker: string, count: number, builder: RowBuilder): PriceFeatureLabelRow[] {
  const start = new Date('2020-01-01T00:00:00.000Z');
  const rows: PriceFeatureLabelRow[] = [];

  for (let i = 0; i < count; i += 1) {
    const built = builder(i);
    rows.push({
      ticker,
      date: makeDate(start, i),
      close: 100 + i,
      adjustedClose: 100 + i,
      priceUsed: 100 + i,
      priceSource: 'adjusted_close',
      open: 99 + i,
      high: 101 + i,
      low: 98 + i,
      volume: 1_000_000 + i,
      range_pct: built.feature,
      ret_1d: built.feature,
      ret_5d: built.feature,
      ret_20d: built.feature,
      sma_20_gap: built.feature,
      sma_50_gap: built.feature,
      vol_20d: built.feature,
      drawdown_252d: built.feature,
      fwd_ret_1d: built.label5,
      fwd_ret_5d: built.label5,
      fwd_ret_10d: built.label20,
      fwd_ret_20d: built.label20,
      fwd_ret_after_cost_1d: built.label5 - 0.001,
      fwd_ret_after_cost_5d: built.label5 - 0.001,
      fwd_ret_after_cost_10d: built.label20 - 0.001,
      fwd_ret_after_cost_20d: built.label20 - 0.001,
      label_available_1d: true,
      label_available_5d: true,
      label_available_10d: true,
      label_available_20d: true,
    });
  }

  return rows;
}

function makeDatasetArtifact(ticker: string, rows: PriceFeatureLabelRow[]): PriceFeatureLabelArtifact {
  return {
    lane: 'research_only',
    datasetType: 'price_features_and_forward_labels',
    schemaVersion: 'price_feature_label_v1',
    vendor: 'yahoo',
    generatedAt: '2026-04-19T00:00:00.000Z',
    sourceArtifactPath: `/tmp/${ticker.toLowerCase()}-source.json`,
    sourceArtifactProvenance: {
      generatedAt: '2026-04-19T00:00:00.000Z',
      assembledAt: '2026-04-19T00:00:00.000Z',
      sourceFetchedAt: '2026-04-19T00:00:00.000Z',
      sourceFetchedAtMin: '2026-04-19T00:00:00.000Z',
      sourceFetchedAtMax: '2026-04-19T00:00:00.000Z',
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
      rowCount: rows.length,
      firstDate: rows[0]?.date ?? null,
      lastDate: rows[rows.length - 1]?.date ?? null,
      tickers: [ticker],
      tickerCoverage: [
        {
          ticker,
          rowCount: rows.length,
          firstDate: rows[0]?.date ?? null,
          lastDate: rows[rows.length - 1]?.date ?? null,
        },
      ],
      usableLabelCounts: {
        '1d': rows.length,
        '5d': rows.length,
        '10d': rows.length,
        '20d': rows.length,
      },
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
    rows,
  };
}

async function writeDataset(filePath: string, artifact: PriceFeatureLabelArtifact): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

describe('multiticker separation analysis', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'multiticker-separation-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('computes quantile bucketing, spread math, and hit-rate math', async () => {
    const file = path.join(tmpDir, 'aapl.json');
    const rows = makeRows('AAPL', 100, (i) => {
      const feature = i / 100;
      const centered = (i - 50) / 100;
      return {
        feature,
        label5: centered,
        label20: centered * 1.5,
      };
    });
    await writeDataset(file, makeDatasetArtifact('AAPL', rows));

    const report = await buildMultiTickerSeparationReport({ files: [file] });
    const item = report.perTicker[0].featureAnalyses.find(
      (entry) => entry.feature === 'ret_1d' && entry.horizon === '5d',
    );

    expect(item?.separation).not.toBeNull();
    expect(item?.separation?.buckets).toHaveLength(5);
    expect(item?.separation?.buckets[0].count).toBe(20);
    expect(item?.separation?.buckets[4].count).toBe(20);
    expect((item?.separation?.q5MinusQ1MeanSpread ?? 0) > 0).toBe(true);
    expect((item?.separation?.q5MinusQ1HitRateSpread ?? 0) > 0).toBe(true);
  });

  test('computes pooled aggregation and deterministic ordering', async () => {
    const bFile = path.join(tmpDir, 'z-msft.json');
    const aFile = path.join(tmpDir, 'a-aapl.json');

    await writeDataset(
      bFile,
      makeDatasetArtifact(
        'MSFT',
        makeRows('MSFT', 80, (i) => ({ feature: i / 100, label5: i / 200, label20: i / 150 })),
      ),
    );
    await writeDataset(
      aFile,
      makeDatasetArtifact(
        'AAPL',
        makeRows('AAPL', 60, (i) => ({ feature: i / 90, label5: i / 180, label20: i / 120 })),
      ),
    );

    const report = await buildMultiTickerSeparationReport({ files: [bFile, aFile] });

    expect(report.datasetCoverage.totalRows).toBe(140);
    expect(report.perTicker.map((item) => item.ticker)).toEqual(['AAPL', 'MSFT']);
    expect(report.datasetCoverage.filesScanned).toEqual([aFile, bFile]);

    const outputPath = path.join(tmpDir, 'report.json');
    const saved = await persistMultiTickerSeparationReport(report, outputPath);
    const parsed = JSON.parse(await readFile(saved, 'utf8'));
    expect(parsed.perTicker[0].ticker).toBe('AAPL');
  });

  test('splits multi-ticker input artifact rows to correct tickers', async () => {
    const file = path.join(tmpDir, 'multi.json');
    const aaplRows = makeRows('AAPL', 40, (i) => ({ feature: i / 100, label5: i / 200, label20: i / 150 }));
    const msftRows = makeRows('MSFT', 30, (i) => ({ feature: i / 120, label5: i / 210, label20: i / 170 }));
    const mixedRows = [...aaplRows, ...msftRows];

    const mixedArtifact = {
      ...makeDatasetArtifact('AAPL', mixedRows),
      summary: {
        ...makeDatasetArtifact('AAPL', mixedRows).summary,
        tickers: ['AAPL', 'MSFT'],
        tickerCoverage: [
          { ticker: 'AAPL', rowCount: 40, firstDate: aaplRows[0].date, lastDate: aaplRows[aaplRows.length - 1].date },
          { ticker: 'MSFT', rowCount: 30, firstDate: msftRows[0].date, lastDate: msftRows[msftRows.length - 1].date },
        ],
      },
    } as PriceFeatureLabelArtifact;

    await writeDataset(file, mixedArtifact);

    const report = await buildMultiTickerSeparationReport({ files: [file] });
    expect(report.perTicker.map((item) => item.ticker)).toEqual(['AAPL', 'MSFT']);
    expect(report.perTicker.find((item) => item.ticker === 'AAPL')?.rowCount).toBe(40);
    expect(report.perTicker.find((item) => item.ticker === 'MSFT')?.rowCount).toBe(30);
    expect(report.datasetCoverage.totalRows).toBe(70);
    expect(report.warnings.some((warning) => warning.includes('Multi-ticker dataset file detected and split by ticker'))).toBe(true);
  });

  test('flags sign flip instability between first and second halves', async () => {
    const file = path.join(tmpDir, 'flip.json');
    const rows = makeRows('AAPL', 120, (i) => {
      const feature = i / 120;
      const half = i < 60;
      return {
        feature,
        label5: half ? feature : -feature,
        label20: half ? feature : -feature,
      };
    });
    await writeDataset(file, makeDatasetArtifact('AAPL', rows));

    const report = await buildMultiTickerSeparationReport({ files: [file] });
    const analysis = report.perTicker[0].featureAnalyses.find(
      (item) => item.feature === 'ret_5d' && item.horizon === '5d',
    );

    expect(analysis?.stability.signFlip).toBe(true);
    expect(
      report.perTicker[0].instabilityFlags.some(
        (flag) => flag.feature === 'ret_5d' && flag.horizon === '5d' && flag.reason === 'half_sign_flip',
      ),
    ).toBe(true);
  });

  test('flags pooled-majority sign mismatch and weak pooled spread', async () => {
    const aFile = path.join(tmpDir, 'a.json');
    const bFile = path.join(tmpDir, 'b.json');
    const cFile = path.join(tmpDir, 'c.json');

    await writeDataset(
      aFile,
      makeDatasetArtifact(
        'AAPL',
        makeRows('AAPL', 80, (i) => {
          const feature = i / 100;
          return { feature, label5: feature * 0.1, label20: feature * 0.2 };
        }),
      ),
    );

    await writeDataset(
      bFile,
      makeDatasetArtifact(
        'MSFT',
        makeRows('MSFT', 80, (i) => {
          const feature = i / 100;
          return { feature, label5: feature * 0.1, label20: feature * 0.2 };
        }),
      ),
    );

    // More rows with stronger inverse relation so pooled sign can differ from majority ticker sign.
    await writeDataset(
      cFile,
      makeDatasetArtifact(
        'NVDA',
        makeRows('NVDA', 220, (i) => {
          const feature = i / 100;
          return { feature, label5: -feature * 0.8, label20: -feature };
        }),
      ),
    );

    const report = await buildMultiTickerSeparationReport({
      files: [aFile, bFile, cFile],
      weakSpreadThreshold: 10,
    });

    const drawdown20 = report.featureConsistencyRanking.find(
      (item) => item.feature === 'drawdown_252d' && item.horizon === '20d',
    );
    expect(drawdown20).toBeDefined();
    expect(drawdown20?.instabilityFlags.includes('pooled_sign_differs_majority_ticker_sign')).toBe(true);

    const weakFlagExists = report.featureConsistencyRanking.some((item) =>
      item.instabilityFlags.includes('weak_pooled_spread'),
    );
    expect(weakFlagExists).toBe(true);
  });

  test('production signal entrypoints do not import multiticker research analysis', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/multiticker-separation-analysis');
    expect(indexSource).not.toContain('./research/multiticker-separation-analysis');
    expect(dailyScanSource).not.toContain('signal-engine/research/multiticker-separation-analysis');
    expect(dailyScanSource).not.toContain('./research/multiticker-separation-analysis');
  });
});
