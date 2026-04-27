import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildMultiTickerEvidenceReport,
  type EvidenceClassification,
} from '../research/multiticker-evidence-report.js';
import { parseEvidenceReportCliArgs } from '../research/multiticker-evidence-report.cli.js';
import {
  type FeatureConsistencySummary,
  type MultiTickerSeparationReport,
  type SeparationFeature,
  type SeparationHorizon,
} from '../research/multiticker-separation-analysis.js';

function rankingItem(
  feature: SeparationFeature,
  horizon: SeparationHorizon,
  overrides: Partial<FeatureConsistencySummary> = {},
): FeatureConsistencySummary {
  const tickerCountWithSignal = overrides.tickerCountWithSignal ?? 8;
  const agreementWithPooledCount = overrides.agreementWithPooledCount ?? 6;
  const unstableTickerCount = overrides.unstableTickerCount ?? 2;
  return {
    feature,
    horizon,
    tickerCountWithSignal,
    positiveSpreadTickers: overrides.positiveSpreadTickers ?? agreementWithPooledCount,
    negativeSpreadTickers: overrides.negativeSpreadTickers ?? tickerCountWithSignal - agreementWithPooledCount,
    zeroSpreadTickers: overrides.zeroSpreadTickers ?? 0,
    majorityTickerSign: overrides.majorityTickerSign ?? 1,
    pooledSign: overrides.pooledSign ?? 1,
    pooledSpread: overrides.pooledSpread ?? 0.01,
    agreementWithPooledCount,
    agreementRatio: overrides.agreementRatio ?? agreementWithPooledCount / tickerCountWithSignal,
    unstableTickerCount,
    instabilityFlags: overrides.instabilityFlags ?? [],
  };
}

function fixtureReport(items: FeatureConsistencySummary[]): MultiTickerSeparationReport {
  return {
    generatedAt: '2026-04-26T00:00:00.000Z',
    lane: 'research_only',
    reportType: 'multiticker_price_feature_separation',
    schemaVersion: 'multiticker_separation_v1',
    config: {
      directories: [],
      files: ['/tmp/separation.json'],
      features: [
        'ret_1d',
        'ret_5d',
        'ret_20d',
        'sma_20_gap',
        'sma_50_gap',
        'vol_20d',
        'drawdown_252d',
        'range_pct',
      ],
      horizons: ['5d', '20d'],
      weakSpreadThreshold: 0.002,
      quantiles: 5,
    },
    datasetCoverage: {
      datasetsLoaded: 8,
      filesScanned: ['/tmp/separation.json'],
      totalRows: 800,
      tickers: ['AAPL', 'AMZN', 'GOOGL', 'JPM', 'META', 'MSFT', 'NVDA', 'XOM'],
      firstDate: '2021-01-04',
      lastDate: '2026-04-24',
    },
    perTicker: [],
    pooled: {
      rowCount: 800,
      featureCoverage: {
        ret_1d: 800,
        ret_5d: 800,
        ret_20d: 800,
        sma_20_gap: 800,
        sma_50_gap: 800,
        vol_20d: 800,
        drawdown_252d: 800,
        range_pct: 800,
      },
      labelCoverage: { '5d': 800, '20d': 800 },
      featureAnalyses: [],
    },
    featureConsistencyRanking: items,
    instabilityFlags: items
      .filter((item) => item.instabilityFlags.includes('pooled_half_sign_flip' as never))
      .map((item) => ({
        feature: item.feature,
        horizon: item.horizon,
        reason: 'pooled_half_sign_flip' as const,
      })),
    conclusions: {
      promising: [],
      weakNoisy: [],
      unstable: [],
      insufficientData: [],
    },
    warnings: [],
  };
}

function classes(report: ReturnType<typeof buildMultiTickerEvidenceReport>): Record<string, EvidenceClassification> {
  return Object.fromEntries(
    report.rows.map((row) => [`${row.feature}|${row.horizon}`, row.classification]),
  ) as Record<string, EvidenceClassification>;
}

describe('multiticker evidence report', () => {
  test('classifies deterministic evidence gates from separation ranking rows', () => {
    const report = buildMultiTickerEvidenceReport(
      fixtureReport([
        rankingItem('sma_50_gap', '20d', {
          agreementWithPooledCount: 6,
          agreementRatio: 0.75,
          unstableTickerCount: 1,
          pooledSpread: 0.01,
        }),
        rankingItem('sma_20_gap', '20d', {
          agreementWithPooledCount: 6,
          agreementRatio: 0.75,
          unstableTickerCount: 1,
          pooledSpread: 0.001,
          instabilityFlags: ['weak_pooled_spread'],
        }),
        rankingItem('vol_20d', '20d', {
          agreementWithPooledCount: 3,
          agreementRatio: 0.375,
          unstableTickerCount: 1,
          pooledSpread: 0.008,
          majorityTickerSign: -1,
          pooledSign: 1,
          instabilityFlags: ['pooled_sign_differs_majority_ticker_sign'],
        }),
        rankingItem('range_pct', '20d', {
          agreementWithPooledCount: 5,
          agreementRatio: 0.625,
          unstableTickerCount: 4,
          pooledSpread: 0.006,
        }),
        rankingItem('ret_20d', '5d', {
          agreementWithPooledCount: 5,
          agreementRatio: 0.625,
          unstableTickerCount: 1,
          pooledSpread: 0.0005,
          instabilityFlags: ['weak_pooled_spread'],
        }),
        rankingItem('ret_5d', '5d', {
          agreementWithPooledCount: 4,
          agreementRatio: 0.5,
          unstableTickerCount: 1,
          pooledSpread: 0.006,
        }),
      ]),
    );

    expect(classes(report)).toMatchObject({
      'sma_50_gap|20d': 'research_candidate',
      'sma_20_gap|20d': 'watchlist',
      'vol_20d|20d': 'misleading_pooled',
      'range_pct|20d': 'unstable',
      'ret_20d|5d': 'weak',
      'ret_5d|5d': 'ticker_specific',
    });
    expect(report.summary.countByClassification.research_candidate).toBe(1);
    expect(report.thresholds.broadAgreementRatio).toBe(0.75);
    expect('agreementRatioPromising' in report.thresholds).toBe(false);
    expect(report.summary.finalRecommendation).toBe('expand_universe');
  });

  test('keeps broad drawdown agreement with pooled half flip out of research_candidate', () => {
    const item = rankingItem('drawdown_252d', '20d', {
      agreementWithPooledCount: 7,
      agreementRatio: 0.875,
      unstableTickerCount: 1,
      pooledSpread: -0.004,
      pooledSign: -1,
      majorityTickerSign: -1,
      instabilityFlags: ['pooled_half_sign_flip' as never],
    });

    const report = buildMultiTickerEvidenceReport(fixtureReport([item]));
    const row = report.rows[0];

    expect(row.classification).toBe('watchlist');
    expect(row.trainReadiness).toBe('expand_universe');
    expect(row.classification).not.toBe('research_candidate');
  });

  test.each([
    '--agreement-threshold',
    '--min-stable-tickers',
    '--non-trivial-spread',
    '--very-small-spread',
  ])('CLI rejects invalid numeric value for %s clearly', (flag) => {
    expect(() =>
      parseEvidenceReportCliArgs([
        '--in',
        '/tmp/not-needed-for-parse-error.json',
        flag,
        'abc',
        '--json',
      ]),
    ).toThrow(`Invalid numeric value for ${flag}: abc`);
  });

  test('production signal entrypoints do not import multiticker evidence report', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/multiticker-evidence-report');
    expect(indexSource).not.toContain('./research/multiticker-evidence-report');
    expect(dailyScanSource).not.toContain('signal-engine/research/multiticker-evidence-report');
    expect(dailyScanSource).not.toContain('./research/multiticker-evidence-report');
  });
});
