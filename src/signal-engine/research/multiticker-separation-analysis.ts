import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from './price-feature-labels.js';

export type SeparationFeature =
  | 'ret_1d'
  | 'ret_5d'
  | 'ret_20d'
  | 'sma_20_gap'
  | 'sma_50_gap'
  | 'vol_20d'
  | 'drawdown_252d'
  | 'range_pct';

export type SeparationHorizon = '5d' | '20d';

export interface MultiTickerSeparationConfig {
  directories?: string[];
  files?: string[];
  outputPath?: string;
  weakSpreadThreshold?: number;
}

interface LoadedDataset {
  path: string;
  ticker: string;
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  rows: PriceFeatureLabelRow[];
  warnings: string[];
}

interface QuantilePoint {
  ticker: string;
  date: string;
  feature: number;
  label: number;
}

export interface QuantileBucketSummary {
  quantile: 1 | 2 | 3 | 4 | 5;
  count: number;
  featureMin: number;
  featureMax: number;
  meanForwardReturn: number;
  medianForwardReturn: number;
  hitRatePositive: number;
}

export interface FeatureHorizonSeparation {
  rowCount: number;
  buckets: QuantileBucketSummary[];
  q5MinusQ1MeanSpread: number;
  q5MinusQ1HitRateSpread: number;
}

export interface HalfStabilitySummary {
  firstHalfSpread: number | null;
  secondHalfSpread: number | null;
  signFlip: boolean;
}

export interface PerTickerFeatureSummary {
  feature: SeparationFeature;
  horizon: SeparationHorizon;
  separation: FeatureHorizonSeparation | null;
  stability: HalfStabilitySummary;
  classification: 'promising' | 'weak_noisy' | 'unstable' | 'insufficient_data';
}

export interface PerTickerSummary {
  ticker: string;
  sourceFiles: string[];
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  featureCoverage: Record<SeparationFeature, number>;
  labelCoverage: Record<SeparationHorizon, number>;
  featureAnalyses: PerTickerFeatureSummary[];
  instabilityFlags: Array<{
    feature: SeparationFeature;
    horizon: SeparationHorizon;
    reason: 'half_sign_flip' | 'insufficient_data';
  }>;
}

export interface PooledFeatureSummary {
  feature: SeparationFeature;
  horizon: SeparationHorizon;
  separation: FeatureHorizonSeparation | null;
  stability: HalfStabilitySummary;
  classification: 'promising' | 'weak_noisy' | 'unstable' | 'insufficient_data';
}

export interface FeatureConsistencySummary {
  feature: SeparationFeature;
  horizon: SeparationHorizon;
  tickerCountWithSignal: number;
  positiveSpreadTickers: number;
  negativeSpreadTickers: number;
  zeroSpreadTickers: number;
  majorityTickerSign: -1 | 0 | 1;
  pooledSign: -1 | 0 | 1;
  pooledSpread: number | null;
  agreementWithPooledCount: number;
  agreementRatio: number;
  unstableTickerCount: number;
  instabilityFlags: Array<
    | 'pooled_sign_differs_majority_ticker_sign'
    | 'weak_pooled_spread'
    | 'insufficient_data'
  >;
}

export interface MultiTickerSeparationReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'multiticker_price_feature_separation';
  schemaVersion: 'multiticker_separation_v1';
  config: {
    directories: string[];
    files: string[];
    features: SeparationFeature[];
    horizons: SeparationHorizon[];
    weakSpreadThreshold: number;
    quantiles: 5;
  };
  datasetCoverage: {
    datasetsLoaded: number;
    filesScanned: string[];
    totalRows: number;
    tickers: string[];
    firstDate: string | null;
    lastDate: string | null;
  };
  perTicker: PerTickerSummary[];
  pooled: {
    rowCount: number;
    featureCoverage: Record<SeparationFeature, number>;
    labelCoverage: Record<SeparationHorizon, number>;
    featureAnalyses: PooledFeatureSummary[];
  };
  featureConsistencyRanking: FeatureConsistencySummary[];
  instabilityFlags: Array<{
    feature: SeparationFeature;
    horizon: SeparationHorizon;
    reason:
      | 'pooled_sign_differs_majority_ticker_sign'
      | 'weak_pooled_spread'
      | 'pooled_half_sign_flip';
  }>;
  conclusions: {
    promising: Array<{ feature: SeparationFeature; horizon: SeparationHorizon }>;
    weakNoisy: Array<{ feature: SeparationFeature; horizon: SeparationHorizon }>;
    unstable: Array<{ feature: SeparationFeature; horizon: SeparationHorizon }>;
    insufficientData: Array<{ feature: SeparationFeature; horizon: SeparationHorizon }>;
  };
  warnings: string[];
}

const DEFAULT_DIRECTORIES = [
  path.join(process.cwd(), '.dexter', 'signal-engine', 'research', 'price-features'),
];

const FEATURES: SeparationFeature[] = [
  'ret_1d',
  'ret_5d',
  'ret_20d',
  'sma_20_gap',
  'sma_50_gap',
  'vol_20d',
  'drawdown_252d',
  'range_pct',
];

const HORIZONS: SeparationHorizon[] = ['5d', '20d'];

const LABEL_FIELD: Record<SeparationHorizon, keyof PriceFeatureLabelRow> = {
  '5d': 'fwd_ret_5d',
  '20d': 'fwd_ret_20d',
};

const WEAK_SPREAD_THRESHOLD = 0.002;

function round(value: number, digits = 10): number {
  return Number(value.toFixed(digits));
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function sign(value: number | null): -1 | 0 | 1 {
  if (value === null || Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : -1;
}

function classify(
  separation: FeatureHorizonSeparation | null,
  stability: HalfStabilitySummary,
  weakSpreadThreshold: number,
): 'promising' | 'weak_noisy' | 'unstable' | 'insufficient_data' {
  if (!separation) return 'insufficient_data';
  if (stability.signFlip) return 'unstable';
  if (Math.abs(separation.q5MinusQ1MeanSpread) < weakSpreadThreshold) return 'weak_noisy';
  return 'promising';
}

function parseDatasetArtifact(
  payload: Record<string, unknown>,
  filePath: string,
): LoadedDataset[] {
  if (
    payload.lane !== 'research_only' ||
    payload.datasetType !== 'price_features_and_forward_labels' ||
    !Array.isArray(payload.rows)
  ) {
    return [];
  }

  const rowsIn = payload.rows as unknown[];
  const rows: PriceFeatureLabelRow[] = [];
  for (const item of rowsIn) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.ticker !== 'string' || typeof rec.date !== 'string') continue;
    rows.push(rec as unknown as PriceFeatureLabelRow);
  }
  if (!rows.length) return [];

  const baseWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];

  const byTicker = new Map<string, PriceFeatureLabelRow[]>();
  for (const row of rows) {
    const group = byTicker.get(row.ticker) ?? [];
    group.push(row);
    byTicker.set(row.ticker, group);
  }

  const splitWarning =
    byTicker.size > 1
      ? `Multi-ticker dataset file detected and split by ticker for attribution: ${filePath}`
      : null;

  return Array.from(byTicker.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ticker, tickerRows]) => {
      const sortedRows = [...tickerRows].sort((a, b) => a.date.localeCompare(b.date));
      return {
        path: filePath,
        ticker,
        rowCount: sortedRows.length,
        firstDate: sortedRows[0]?.date ?? null,
        lastDate: sortedRows[sortedRows.length - 1]?.date ?? null,
        rows: sortedRows,
        warnings: splitWarning ? [...baseWarnings, splitWarning] : baseWarnings,
      };
    });
}

async function collectJsonFiles(directories: string[], files: string[]): Promise<string[]> {
  const out = new Set<string>();

  for (const filePath of files) {
    out.add(path.resolve(filePath));
  }

  for (const directory of directories) {
    const absolute = path.resolve(directory);
    try {
      const entries = await readdir(absolute, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        out.add(path.join(absolute, entry.name));
      }
    } catch {
      // Keep deterministic behavior; missing directories are handled via warnings later.
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

async function loadDatasets(config: MultiTickerSeparationConfig): Promise<{
  filesScanned: string[];
  datasets: LoadedDataset[];
  warnings: string[];
}> {
  const directories = config.directories?.length ? config.directories : DEFAULT_DIRECTORIES;
  const files = config.files ?? [];
  const filesScanned = await collectJsonFiles(directories, files);
  const warnings: string[] = [];
  const datasets: LoadedDataset[] = [];

  if (!filesScanned.length) {
    warnings.push('No JSON files found for analysis.');
  }

  for (const filePath of filesScanned) {
    try {
      const payload = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
      const parsed = parseDatasetArtifact(payload, filePath);
      if (!parsed.length) {
        warnings.push(`Skipped non price-feature dataset artifact: ${filePath}`);
        continue;
      }
      for (const dataset of parsed) {
        datasets.push(dataset);
        warnings.push(...dataset.warnings.map((warning) => `${dataset.ticker}: ${warning}`));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to parse ${filePath}: ${message}`);
    }
  }

  return {
    filesScanned,
    datasets: datasets.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.path.localeCompare(b.path)),
    warnings: Array.from(new Set(warnings)).sort((a, b) => a.localeCompare(b)),
  };
}

function quantileBuckets(points: QuantilePoint[]): QuantilePoint[][] {
  const sorted = [...points].sort(
    (a, b) => a.feature - b.feature || a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date),
  );
  const n = sorted.length;
  const buckets: QuantilePoint[][] = [[], [], [], [], []];

  for (let i = 0; i < n; i += 1) {
    const bucketIndex = Math.min(4, Math.floor((i * 5) / n));
    buckets[bucketIndex].push(sorted[i]);
  }
  return buckets;
}

function computeSeparation(points: QuantilePoint[]): FeatureHorizonSeparation | null {
  if (points.length < 30) return null;
  const buckets = quantileBuckets(points);
  if (buckets.some((bucket) => bucket.length === 0)) return null;

  const summaries: QuantileBucketSummary[] = buckets.map((bucket, idx) => {
    const labels = bucket.map((point) => point.label);
    const features = bucket.map((point) => point.feature);
    const meanForwardReturn = round(labels.reduce((sum, value) => sum + value, 0) / labels.length);
    const medianForwardReturn = round(median(labels));
    const hitRatePositive = round(labels.filter((value) => value > 0).length / labels.length);

    return {
      quantile: (idx + 1) as 1 | 2 | 3 | 4 | 5,
      count: bucket.length,
      featureMin: round(features[0]),
      featureMax: round(features[features.length - 1]),
      meanForwardReturn,
      medianForwardReturn,
      hitRatePositive,
    };
  });

  const q1 = summaries[0];
  const q5 = summaries[4];

  return {
    rowCount: points.length,
    buckets: summaries,
    q5MinusQ1MeanSpread: round(q5.meanForwardReturn - q1.meanForwardReturn),
    q5MinusQ1HitRateSpread: round(q5.hitRatePositive - q1.hitRatePositive),
  };
}

function pointsFor(rows: PriceFeatureLabelRow[], feature: SeparationFeature, horizon: SeparationHorizon): QuantilePoint[] {
  const labelField = LABEL_FIELD[horizon];
  const out: QuantilePoint[] = [];

  for (const row of rows) {
    const featureValue = asNumber(row[feature]);
    const labelValue = asNumber(row[labelField]);
    if (featureValue === null || labelValue === null) continue;

    out.push({
      ticker: row.ticker,
      date: row.date,
      feature: featureValue,
      label: labelValue,
    });
  }

  return out;
}

function splitHalf(points: QuantilePoint[]): { first: QuantilePoint[]; second: QuantilePoint[] } {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const mid = Math.floor(sorted.length / 2);
  return {
    first: sorted.slice(0, mid),
    second: sorted.slice(mid),
  };
}

function stabilityFor(points: QuantilePoint[]): HalfStabilitySummary {
  if (points.length < 60) {
    return { firstHalfSpread: null, secondHalfSpread: null, signFlip: false };
  }

  const halves = splitHalf(points);
  const first = computeSeparation(halves.first);
  const second = computeSeparation(halves.second);

  const firstSpread = first?.q5MinusQ1MeanSpread ?? null;
  const secondSpread = second?.q5MinusQ1MeanSpread ?? null;
  const firstSign = sign(firstSpread);
  const secondSign = sign(secondSpread);

  return {
    firstHalfSpread: firstSpread,
    secondHalfSpread: secondSpread,
    signFlip: firstSign !== 0 && secondSign !== 0 && firstSign !== secondSign,
  };
}

function emptyFeatureCoverage(): Record<SeparationFeature, number> {
  return {
    ret_1d: 0,
    ret_5d: 0,
    ret_20d: 0,
    sma_20_gap: 0,
    sma_50_gap: 0,
    vol_20d: 0,
    drawdown_252d: 0,
    range_pct: 0,
  };
}

function emptyLabelCoverage(): Record<SeparationHorizon, number> {
  return { '5d': 0, '20d': 0 };
}

function buildPerTickerSummary(
  ticker: string,
  datasets: LoadedDataset[],
  weakSpreadThreshold: number,
): PerTickerSummary {
  const rows = datasets
    .flatMap((dataset) => dataset.rows)
    .sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));

  const featureCoverage = emptyFeatureCoverage();
  const labelCoverage = emptyLabelCoverage();
  for (const row of rows) {
    for (const feature of FEATURES) {
      if (asNumber(row[feature]) !== null) featureCoverage[feature] += 1;
    }
    for (const horizon of HORIZONS) {
      if (asNumber(row[LABEL_FIELD[horizon]]) !== null) labelCoverage[horizon] += 1;
    }
  }

  const featureAnalyses: PerTickerFeatureSummary[] = [];
  const instabilityFlags: PerTickerSummary['instabilityFlags'] = [];

  for (const feature of FEATURES) {
    for (const horizon of HORIZONS) {
      const points = pointsFor(rows, feature, horizon);
      const separation = computeSeparation(points);
      const stability = stabilityFor(points);
      const classification = classify(separation, stability, weakSpreadThreshold);

      featureAnalyses.push({
        feature,
        horizon,
        separation,
        stability,
        classification,
      });

      if (stability.signFlip) {
        instabilityFlags.push({ feature, horizon, reason: 'half_sign_flip' });
      }
      if (!separation) {
        instabilityFlags.push({ feature, horizon, reason: 'insufficient_data' });
      }
    }
  }

  return {
    ticker,
    sourceFiles: datasets.map((dataset) => dataset.path).sort((a, b) => a.localeCompare(b)),
    rowCount: rows.length,
    firstDate: rows[0]?.date ?? null,
    lastDate: rows[rows.length - 1]?.date ?? null,
    featureCoverage,
    labelCoverage,
    featureAnalyses,
    instabilityFlags,
  };
}

function buildPooledSummary(
  rows: PriceFeatureLabelRow[],
  weakSpreadThreshold: number,
): MultiTickerSeparationReport['pooled'] {
  const featureCoverage = emptyFeatureCoverage();
  const labelCoverage = emptyLabelCoverage();
  for (const row of rows) {
    for (const feature of FEATURES) {
      if (asNumber(row[feature]) !== null) featureCoverage[feature] += 1;
    }
    for (const horizon of HORIZONS) {
      if (asNumber(row[LABEL_FIELD[horizon]]) !== null) labelCoverage[horizon] += 1;
    }
  }

  const featureAnalyses: PooledFeatureSummary[] = [];
  for (const feature of FEATURES) {
    for (const horizon of HORIZONS) {
      const points = pointsFor(rows, feature, horizon);
      const separation = computeSeparation(points);
      const stability = stabilityFor(points);
      featureAnalyses.push({
        feature,
        horizon,
        separation,
        stability,
        classification: classify(separation, stability, weakSpreadThreshold),
      });
    }
  }

  return {
    rowCount: rows.length,
    featureCoverage,
    labelCoverage,
    featureAnalyses,
  };
}

function buildFeatureConsistencyRanking(
  perTicker: PerTickerSummary[],
  pooled: MultiTickerSeparationReport['pooled'],
  weakSpreadThreshold: number,
): {
  ranking: FeatureConsistencySummary[];
  globalFlags: MultiTickerSeparationReport['instabilityFlags'];
} {
  const pooledMap = new Map(
    pooled.featureAnalyses.map((item) => [`${item.feature}|${item.horizon}`, item]),
  );

  const globalFlags: MultiTickerSeparationReport['instabilityFlags'] = [];
  const ranking: FeatureConsistencySummary[] = [];

  for (const horizon of HORIZONS) {
    for (const feature of FEATURES) {
      const key = `${feature}|${horizon}`;
      const pooledFeature = pooledMap.get(key);

      const tickerItems = perTicker
        .map((ticker) => ticker.featureAnalyses.find((item) => item.feature === feature && item.horizon === horizon))
        .filter((item): item is PerTickerFeatureSummary => Boolean(item));

      const spreads = tickerItems
        .map((item) => item.separation?.q5MinusQ1MeanSpread ?? null)
        .filter((value): value is number => value !== null);

      const positive = spreads.filter((value) => sign(value) === 1).length;
      const negative = spreads.filter((value) => sign(value) === -1).length;
      const zero = spreads.filter((value) => sign(value) === 0).length;
      const majority: -1 | 0 | 1 = positive > negative ? 1 : negative > positive ? -1 : 0;
      const pooledSpread = pooledFeature?.separation?.q5MinusQ1MeanSpread ?? null;
      const pooledSign = sign(pooledSpread);

      const agreementWithPooledCount = spreads.filter((value) => sign(value) === pooledSign && pooledSign !== 0).length;
      const tickerCountWithSignal = spreads.length;
      const agreementRatio = tickerCountWithSignal
        ? round(agreementWithPooledCount / tickerCountWithSignal)
        : 0;

      const unstableTickerCount = tickerItems.filter((item) => item.stability.signFlip).length;

      const instabilityFlags: FeatureConsistencySummary['instabilityFlags'] = [];
      if (tickerCountWithSignal === 0 || pooledSpread === null) {
        instabilityFlags.push('insufficient_data');
      } else {
        if (majority !== 0 && pooledSign !== 0 && majority !== pooledSign) {
          instabilityFlags.push('pooled_sign_differs_majority_ticker_sign');
          globalFlags.push({
            feature,
            horizon,
            reason: 'pooled_sign_differs_majority_ticker_sign',
          });
        }
        if (Math.abs(pooledSpread) < weakSpreadThreshold) {
          instabilityFlags.push('weak_pooled_spread');
          globalFlags.push({ feature, horizon, reason: 'weak_pooled_spread' });
        }
      }

      if (pooledFeature?.stability.signFlip) {
        globalFlags.push({ feature, horizon, reason: 'pooled_half_sign_flip' });
      }

      ranking.push({
        feature,
        horizon,
        tickerCountWithSignal,
        positiveSpreadTickers: positive,
        negativeSpreadTickers: negative,
        zeroSpreadTickers: zero,
        majorityTickerSign: majority,
        pooledSign,
        pooledSpread,
        agreementWithPooledCount,
        agreementRatio,
        unstableTickerCount,
        instabilityFlags,
      });
    }
  }

  ranking.sort((a, b) => {
    const byHorizon = a.horizon.localeCompare(b.horizon);
    if (byHorizon !== 0) return byHorizon;
    const absA = Math.abs(a.pooledSpread ?? 0);
    const absB = Math.abs(b.pooledSpread ?? 0);
    if (absA !== absB) return absB - absA;
    if (a.agreementRatio !== b.agreementRatio) return b.agreementRatio - a.agreementRatio;
    return a.feature.localeCompare(b.feature);
  });

  return {
    ranking,
    globalFlags: Array.from(
      new Map(globalFlags.map((flag) => [`${flag.feature}|${flag.horizon}|${flag.reason}`, flag])).values(),
    ).sort((a, b) =>
      a.horizon.localeCompare(b.horizon) || a.feature.localeCompare(b.feature) || a.reason.localeCompare(b.reason),
    ),
  };
}

function buildConclusions(
  pooled: MultiTickerSeparationReport['pooled'],
  ranking: FeatureConsistencySummary[],
): MultiTickerSeparationReport['conclusions'] {
  const pooledMap = new Map(
    pooled.featureAnalyses.map((item) => [`${item.feature}|${item.horizon}`, item.classification]),
  );
  const byClass: MultiTickerSeparationReport['conclusions'] = {
    promising: [],
    weakNoisy: [],
    unstable: [],
    insufficientData: [],
  };

  for (const item of ranking) {
    const key = `${item.feature}|${item.horizon}`;
    const pooledClass = pooledMap.get(key);
    if (!pooledClass || pooledClass === 'insufficient_data') {
      byClass.insufficientData.push({ feature: item.feature, horizon: item.horizon });
      continue;
    }
    if (pooledClass === 'unstable' || item.unstableTickerCount > 0) {
      byClass.unstable.push({ feature: item.feature, horizon: item.horizon });
      continue;
    }
    if (pooledClass === 'weak_noisy') {
      byClass.weakNoisy.push({ feature: item.feature, horizon: item.horizon });
      continue;
    }
    byClass.promising.push({ feature: item.feature, horizon: item.horizon });
  }

  return byClass;
}

function defaultOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'research',
    'analysis',
    `multiticker-separation-${stamp}.json`,
  );
}

export async function buildMultiTickerSeparationReport(
  config: MultiTickerSeparationConfig = {},
): Promise<MultiTickerSeparationReport> {
  const weakSpreadThreshold =
    typeof config.weakSpreadThreshold === 'number' && Number.isFinite(config.weakSpreadThreshold)
      ? config.weakSpreadThreshold
      : WEAK_SPREAD_THRESHOLD;

  const load = await loadDatasets(config);
  const grouped = new Map<string, LoadedDataset[]>();
  for (const dataset of load.datasets) {
    const arr = grouped.get(dataset.ticker) ?? [];
    arr.push(dataset);
    grouped.set(dataset.ticker, arr);
  }

  const tickers = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  const perTicker = tickers.map((ticker) =>
    buildPerTickerSummary(ticker, grouped.get(ticker) ?? [], weakSpreadThreshold),
  );

  const pooledRows = perTicker
    .flatMap((ticker) =>
      (grouped.get(ticker.ticker) ?? []).flatMap((dataset) => dataset.rows),
    )
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date));

  const pooled = buildPooledSummary(pooledRows, weakSpreadThreshold);

  const consistency = buildFeatureConsistencyRanking(perTicker, pooled, weakSpreadThreshold);
  const conclusions = buildConclusions(pooled, consistency.ranking);

  const firstDate = pooledRows[0]?.date ?? null;
  const lastDate = pooledRows[pooledRows.length - 1]?.date ?? null;

  const report: MultiTickerSeparationReport = {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'multiticker_price_feature_separation',
    schemaVersion: 'multiticker_separation_v1',
    config: {
      directories: (config.directories?.length ? config.directories : DEFAULT_DIRECTORIES).map((d) =>
        path.resolve(d),
      ),
      files: (config.files ?? []).map((filePath) => path.resolve(filePath)).sort((a, b) => a.localeCompare(b)),
      features: FEATURES,
      horizons: HORIZONS,
      weakSpreadThreshold,
      quantiles: 5,
    },
    datasetCoverage: {
      datasetsLoaded: load.datasets.length,
      filesScanned: load.filesScanned,
      totalRows: pooledRows.length,
      tickers,
      firstDate,
      lastDate,
    },
    perTicker,
    pooled,
    featureConsistencyRanking: consistency.ranking,
    instabilityFlags: consistency.globalFlags,
    conclusions,
    warnings: load.warnings,
  };

  if (!load.datasets.length) {
    report.warnings = Array.from(new Set([...report.warnings, 'No valid price-feature datasets loaded.'])).sort((a, b) =>
      a.localeCompare(b),
    );
  }

  return report;
}

export async function persistMultiTickerSeparationReport(
  report: MultiTickerSeparationReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
