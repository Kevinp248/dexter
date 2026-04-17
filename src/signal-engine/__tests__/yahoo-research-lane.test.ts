import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  fetchYahooHistoryToCache,
  persistYahooRawArtifact,
  type YahooHistoryFetchDeps,
} from '../research/yahoo-history-fetch.js';
import {
  normalizeYahooRawArtifact,
  persistYahooNormalizedArtifact,
} from '../research/yahoo-normalize.js';

function makeYahooChartPayload(
  timestamps: number[],
  values: Array<{ open: number; high: number; low: number; close: number; volume: number; adj?: number }>,
): unknown {
  return {
    chart: {
      result: [
        {
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: values.map((value) => value.open),
                high: values.map((value) => value.high),
                low: values.map((value) => value.low),
                close: values.map((value) => value.close),
                volume: values.map((value) => value.volume),
              },
            ],
            adjclose: [
              {
                adjclose: values.map((value) => value.adj ?? value.close),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

describe('yahoo research price lane', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'yahoo-research-lane-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('normalization is deterministic and includes explicit metadata fields', async () => {
    const raw = {
      vendor: 'yahoo' as const,
      lane: 'research_only' as const,
      fetchedAt: '2026-04-17T00:00:00.000Z',
      requested: {
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        interval: '1d' as const,
        includeAdjustedClose: true,
      },
      tickers: [
        {
          ticker: 'MSFT',
          status: 'success' as const,
          source: 'network' as const,
          cachePath: path.join(tmpDir, 'msft.json'),
          fetchedAt: '2026-04-17T00:00:00.000Z',
          response: makeYahooChartPayload(
            [1704326400, 1704412800],
            [
              { open: 10, high: 12, low: 9, close: 11, volume: 1000, adj: 10.8 },
              { open: 11, high: 13, low: 10, close: 12, volume: 1200, adj: 11.7 },
            ],
          ),
          warning: null,
        },
      ],
      warnings: [],
    };

    const normalizedA = normalizeYahooRawArtifact(raw, new Date('2026-04-17T01:00:00.000Z'));
    const normalizedB = normalizeYahooRawArtifact(raw, new Date('2026-04-17T01:00:00.000Z'));

    expect(normalizedA).toEqual(normalizedB);
    expect(normalizedA.rows[0]).toMatchObject({
      ticker: 'MSFT',
      vendor: 'yahoo',
      fetchedAt: '2026-04-17T00:00:00.000Z',
      requested: {
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        interval: '1d',
      },
      priceBasis: {
        closeField: 'close',
        adjustedCloseField: 'adjustedClose',
        defaultResearchBasis: 'adjusted_close_if_available_else_close',
      },
    });
    expect(normalizedA.assembledAt).toBe('2026-04-17T00:00:00.000Z');
    expect(normalizedA.sourceFetchedAtMin).toBe('2026-04-17T00:00:00.000Z');
    expect(normalizedA.sourceFetchedAtMax).toBe('2026-04-17T00:00:00.000Z');
    expect(normalizedA.sourceFetchedAt).toBe('2026-04-17T00:00:00.000Z');
  });

  test('fetch/cache writes local artifacts and uses cache on subsequent runs', async () => {
    let calls = 0;
    let nowCallCount = 0;
    const deps: YahooHistoryFetchDeps = {
      fetchFn: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify(
              makeYahooChartPayload([1704326400], [
                { open: 10, high: 11, low: 9, close: 10.5, volume: 1000, adj: 10.4 },
              ]),
            ),
        };
      },
      nowFn: () => {
        nowCallCount += 1;
        return nowCallCount <= 3
          ? new Date('2026-04-17T00:00:00.000Z')
          : new Date('2026-04-18T00:00:00.000Z');
      },
    };

    const cacheDir = path.join(tmpDir, 'cache');
    const rawA = await fetchYahooHistoryToCache(
      {
        tickers: ['AAPL'],
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        cacheDir,
      },
      deps,
    );
    expect(calls).toBe(1);

    const rawB = await fetchYahooHistoryToCache(
      {
        tickers: ['AAPL'],
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        cacheDir,
      },
      deps,
    );
    expect(calls).toBe(1);
    expect(rawA.tickers[0].cachePath).toBe(rawB.tickers[0].cachePath);
    expect(rawB.tickers[0].source).toBe('cache');
    expect(rawA.tickers[0].fetchedAt).toBe('2026-04-17T00:00:00.000Z');
    expect(rawB.tickers[0].fetchedAt).toBe('2026-04-17T00:00:00.000Z');
    expect(rawA.assembledAt).toBe('2026-04-17T00:00:00.000Z');
    expect(rawB.assembledAt).toBe('2026-04-18T00:00:00.000Z');
    expect(rawA.sourceFetchedAtMin).toBe('2026-04-17T00:00:00.000Z');
    expect(rawB.sourceFetchedAtMin).toBe('2026-04-17T00:00:00.000Z');
    expect(rawB.sourceFetchedAtMax).toBe('2026-04-17T00:00:00.000Z');

    const rawOut = path.join(tmpDir, 'raw-output.json');
    const normalizedOut = path.join(tmpDir, 'normalized-output.json');
    const rawPath = await persistYahooRawArtifact(rawB, rawOut);
    const normalizedPath = await persistYahooNormalizedArtifact(
      normalizeYahooRawArtifact(rawB, new Date('2026-04-17T00:00:00.000Z')),
      normalizedOut,
    );

    expect(rawPath).toBe(path.resolve(rawOut));
    expect(normalizedPath).toBe(path.resolve(normalizedOut));
    const rawSaved = JSON.parse(await readFile(rawPath, 'utf8'));
    const normalizedSaved = JSON.parse(await readFile(normalizedPath, 'utf8'));
    expect(rawSaved.vendor).toBe('yahoo');
    expect(normalizedSaved.vendor).toBe('yahoo');
    expect(normalizedSaved.assembledAt).toBe('2026-04-18T00:00:00.000Z');
    expect(normalizedSaved.sourceFetchedAt).toBe('2026-04-17T00:00:00.000Z');
    expect(normalizedSaved.sourceFetchedAtMin).toBe('2026-04-17T00:00:00.000Z');
    expect(normalizedSaved.sourceFetchedAtMax).toBe('2026-04-17T00:00:00.000Z');

    const perTickerCache = JSON.parse(await readFile(rawA.tickers[0].cachePath, 'utf8'));
    expect(perTickerCache).toMatchObject({
      vendor: 'yahoo',
      ticker: 'AAPL',
      requested: {
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        interval: '1d',
        includeAdjustedClose: true,
      },
      fetchedAt: '2026-04-17T00:00:00.000Z',
    });
    expect(perTickerCache.response).toBeDefined();
  });

  test('handles partial/empty ticker results without crashing', async () => {
    const deps: YahooHistoryFetchDeps = {
      fetchFn: async (url: string) => {
        if (url.includes('/AAPL?')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify(
                makeYahooChartPayload([1704326400], [
                  { open: 20, high: 22, low: 19, close: 21, volume: 2000, adj: 20.9 },
                ]),
              ),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ chart: { result: [], error: null } }),
        };
      },
      nowFn: () => new Date('2026-04-17T00:00:00.000Z'),
    };

    const raw = await fetchYahooHistoryToCache(
      {
        tickers: ['AAPL', 'MSFT'],
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        cacheDir: path.join(tmpDir, 'cache-partial'),
      },
      deps,
    );
    const normalized = normalizeYahooRawArtifact(raw, new Date('2026-04-17T00:00:00.000Z'));

    expect(raw.tickers.find((item) => item.ticker === 'AAPL')?.status).toBe('success');
    expect(raw.tickers.find((item) => item.ticker === 'MSFT')?.status).toBe('empty');
    expect(normalized.rows.filter((row) => row.ticker === 'AAPL')).toHaveLength(1);
    expect(normalized.rows.filter((row) => row.ticker === 'MSFT')).toHaveLength(0);
    expect(
      normalized.tickerSummaries.find((item) => item.ticker === 'MSFT')?.rowCount,
    ).toBe(0);
  });

  test('production signal entrypoints do not import yahoo research lane', async () => {
    const indexSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'),
      'utf8',
    );
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/yahoo');
    expect(indexSource).not.toContain('./research/yahoo');
    expect(dailyScanSource).not.toContain('signal-engine/research/yahoo');
    expect(dailyScanSource).not.toContain('./research/yahoo');
  });

  test('legacy bare-payload cache files still load and normalize with clear provenance', async () => {
    const cacheDir = path.join(tmpDir, 'legacy-cache');
    const legacyCachePath = path.join(cacheDir, 'AAPL-2026-01-01-2026-01-05-1d.json');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      legacyCachePath,
      `${JSON.stringify(
        makeYahooChartPayload([1704326400], [
          { open: 30, high: 31, low: 29, close: 30.5, volume: 3000, adj: 30.4 },
        ]),
        null,
        2,
      )}\n`,
      'utf8',
    );

    const raw = await fetchYahooHistoryToCache(
      {
        tickers: ['AAPL'],
        startDate: '2026-01-01',
        endDate: '2026-01-05',
        cacheDir,
      },
      {
        nowFn: () => new Date('2026-04-18T00:00:00.000Z'),
        fetchFn: async () => {
          throw new Error('network fetch should not run for legacy cache hit');
        },
      },
    );

    expect(raw.tickers[0].source).toBe('cache');
    expect(raw.tickers[0].response).not.toBeNull();
    expect(raw.tickers[0].warning).toContain('Legacy cache payload detected');
    expect(raw.warnings.some((warning) => warning.includes('Legacy cache payload detected'))).toBe(true);

    const normalized = normalizeYahooRawArtifact(raw, new Date('2026-04-18T00:00:00.000Z'));
    expect(normalized.rows).toHaveLength(1);
    expect(normalized.rows[0].ticker).toBe('AAPL');
    // Legacy bare payload has no original fetch timestamp, so source falls back safely.
    expect(normalized.sourceFetchedAt).toBe('2026-04-18T00:00:00.000Z');
  });
});
