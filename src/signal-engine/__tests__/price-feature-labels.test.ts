import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildPriceFeatureLabelArtifact,
  loadNormalizedYahooArtifactFromFile,
  persistPriceFeatureLabelArtifact,
} from '../research/price-feature-labels.js';
import { YahooNormalizedResearchArtifact } from '../research/yahoo-normalize.js';

function makeNormalizedArtifact(): YahooNormalizedResearchArtifact {
  const startDate = new Date('2026-01-01T00:00:00.000Z');
  const rows: YahooNormalizedResearchArtifact['rows'] = [];

  for (let i = 0; i < 30; i += 1) {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    const close = 100 + i;
    const adjustedClose = i % 7 === 0 ? null : close * 0.98;
    rows.push({
      ticker: 'AAPL',
      date: dateStr,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
      adjustedClose,
      volume: 1_000_000 + i,
      vendor: 'yahoo',
      fetchedAt: '2026-04-17T00:00:00.000Z',
      requested: {
        startDate: '2026-01-01',
        endDate: '2026-01-30',
        interval: '1d',
      },
      priceBasis: {
        closeField: 'close',
        adjustedCloseField: 'adjustedClose',
        defaultResearchBasis: 'adjusted_close_if_available_else_close',
      },
    });
  }

  return {
    lane: 'research_only',
    vendor: 'yahoo',
    generatedAt: '2026-04-17T01:00:00.000Z',
    assembledAt: '2026-04-17T00:59:00.000Z',
    sourceFetchedAt: '2026-04-17T00:00:00.000Z',
    sourceFetchedAtMin: '2026-04-17T00:00:00.000Z',
    sourceFetchedAtMax: '2026-04-17T00:00:00.000Z',
    requested: {
      startDate: '2026-01-01',
      endDate: '2026-01-30',
      interval: '1d',
    },
    priceBasis: {
      closeField: 'close',
      adjustedCloseField: 'adjustedClose',
      defaultResearchBasis: 'adjusted_close_if_available_else_close',
      notes: ['test fixture'],
    },
    rows,
    tickerSummaries: [
      {
        ticker: 'AAPL',
        status: 'success',
        rowCount: rows.length,
        startDate: rows[0].date,
        endDate: rows[rows.length - 1].date,
        approximateMissingWeekdays: 0,
      },
    ],
    warnings: [],
  };
}

function approx(a: number | null, b: number | null, eps = 1e-9): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= eps;
}

describe('research price feature/label lane', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'price-feature-labels-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('build is deterministic and includes required metadata', () => {
    const normalized = makeNormalizedArtifact();

    const a = buildPriceFeatureLabelArtifact(normalized, {
      sourceArtifactPath: '/tmp/source-a.json',
      roundTripCostBps: 10,
      now: new Date('2026-04-17T02:00:00.000Z'),
    });
    const b = buildPriceFeatureLabelArtifact(normalized, {
      sourceArtifactPath: '/tmp/source-a.json',
      roundTripCostBps: 10,
      now: new Date('2026-04-17T02:00:00.000Z'),
    });

    expect(a).toEqual(b);
    expect(a.lane).toBe('research_only');
    expect(a.datasetType).toBe('price_features_and_forward_labels');
    expect(a.labelBasis).toBe('selected_price_to_selected_price');
    expect(a.labelCostAssumption.roundTripCostBps).toBe(10);
    expect(a.summary.rowCount).toBe(30);
    expect(a.summary.usableLabelCounts['20d']).toBe(10);
    expect(a.features.included).toEqual([
      'ret_1d',
      'ret_5d',
      'ret_20d',
      'sma_20_gap',
      'sma_50_gap',
      'vol_20d',
      'drawdown_252d',
      'range_pct',
    ]);
  });

  test('forward-return horizon math and after-cost labels are correct', () => {
    const normalized = makeNormalizedArtifact();
    const out = buildPriceFeatureLabelArtifact(normalized, {
      roundTripCostBps: 10,
      now: new Date('2026-04-17T02:00:00.000Z'),
    });

    const row = out.rows[0];
    const p0 = 100; // adjustedClose null on i=0 -> fallback to close
    const p1 = (100 + 1) * 0.98; // i=1 uses adjustedClose
    const p5 = (100 + 5) * 0.98;
    const p10 = (100 + 10) * 0.98;
    const p20 = (100 + 20) * 0.98;

    expect(approx(row.fwd_ret_1d, p1 / p0 - 1)).toBe(true);
    expect(approx(row.fwd_ret_5d, p5 / p0 - 1)).toBe(true);
    expect(approx(row.fwd_ret_10d, p10 / p0 - 1)).toBe(true);
    expect(approx(row.fwd_ret_20d, p20 / p0 - 1)).toBe(true);
    expect(approx(row.fwd_ret_after_cost_1d, (p1 / p0 - 1) - 0.001)).toBe(true);
    expect(row.label_available_20d).toBe(true);
    // Labels are selected-price-based, not raw-close-only.
    expect(approx(row.fwd_ret_1d, (101 / 100) - 1)).toBe(false);

    const tail = out.rows[out.rows.length - 1];
    expect(tail.fwd_ret_1d).toBeNull();
    expect(tail.fwd_ret_after_cost_1d).toBeNull();
    expect(tail.label_available_1d).toBe(false);
  });

  test('features use only historical rows with clean edge null handling (no look-ahead leakage)', () => {
    const normalized = makeNormalizedArtifact();
    const out = buildPriceFeatureLabelArtifact(normalized, {
      now: new Date('2026-04-17T02:00:00.000Z'),
    });

    expect(out.rows[0].ret_1d).toBeNull();
    expect(out.rows[4].ret_5d).toBeNull();
    expect(out.rows[19].ret_20d).toBeNull();
    expect(out.rows[18].sma_20_gap).toBeNull();
    expect(out.rows[48] ?? null).toBeNull(); // dataset shorter than 50 lookback
    expect(out.rows[29].sma_50_gap).toBeNull();

    // Last row has complete historical context for ret_1d, but no future label context.
    expect(out.rows[29].ret_1d).not.toBeNull();
    expect(out.rows[29].fwd_ret_1d).toBeNull();
  });

  test('adjustedClose fallback to close is explicit when adjustedClose is unavailable', () => {
    const normalized = makeNormalizedArtifact();
    const out = buildPriceFeatureLabelArtifact(normalized, {
      now: new Date('2026-04-17T02:00:00.000Z'),
    });

    const fallbackRows = out.rows.filter((row) => row.adjustedClose === null);
    expect(fallbackRows.length).toBeGreaterThan(0);
    for (const row of fallbackRows) {
      expect(row.priceSource).toBe('close');
      expect(row.priceUsed).toBe(row.close);
    }

    const adjustedRows = out.rows.filter((row) => row.adjustedClose !== null);
    expect(adjustedRows.length).toBeGreaterThan(0);
    for (const row of adjustedRows.slice(0, 5)) {
      expect(row.priceSource).toBe('adjusted_close');
    }
  });

  test('can persist/reload and keeps deterministic sorted rows', async () => {
    const normalized = makeNormalizedArtifact();
    const shuffled = {
      ...normalized,
      rows: [...normalized.rows].reverse(),
    };

    const inputPath = path.join(tmpDir, 'normalized.json');
    await writeFile(
      inputPath,
      `${JSON.stringify(shuffled, null, 2)}\n`,
      'utf8',
    );

    const loaded = await loadNormalizedYahooArtifactFromFile(inputPath);
    const artifact = buildPriceFeatureLabelArtifact(loaded, {
      sourceArtifactPath: inputPath,
      now: new Date('2026-04-17T03:00:00.000Z'),
    });
    const outputPath = path.join(tmpDir, 'dataset.json');
    const saved = await persistPriceFeatureLabelArtifact(artifact, outputPath);
    const savedJson = JSON.parse(await readFile(saved, 'utf8'));

    expect(saved).toBe(path.resolve(outputPath));
    expect(savedJson.rows[0].date).toBe('2026-01-01');
    expect(savedJson.rows[savedJson.rows.length - 1].date).toBe('2026-01-30');
  });

  test('production signal entrypoints do not import price-feature research lane', async () => {
    const indexSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'),
      'utf8',
    );
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/price-feature-labels');
    expect(indexSource).not.toContain('./research/price-feature-labels');
    expect(dailyScanSource).not.toContain('signal-engine/research/price-feature-labels');
    expect(dailyScanSource).not.toContain('./research/price-feature-labels');
  });
});
