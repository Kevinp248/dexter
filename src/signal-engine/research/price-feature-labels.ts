import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { YahooNormalizedResearchArtifact, YahooResearchNormalizedRow } from './yahoo-normalize.js';

export type ResearchPriceBasis = 'adjusted_close_if_available_else_close';
export type ResearchLabelBasis = 'selected_price_to_selected_price';

export interface PriceFeatureLabelBuilderConfig {
  sourceArtifactPath?: string;
  priceBasis?: ResearchPriceBasis;
  labelBasis?: ResearchLabelBasis;
  roundTripCostBps?: number;
  schemaVersion?: string;
  now?: Date;
}

export interface PriceFeatureLabelRow {
  ticker: string;
  date: string;
  close: number;
  adjustedClose: number | null;
  priceUsed: number;
  priceSource: 'adjusted_close' | 'close';
  open: number;
  high: number;
  low: number;
  volume: number;
  range_pct: number | null;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_20d: number | null;
  sma_20_gap: number | null;
  sma_50_gap: number | null;
  vol_20d: number | null;
  drawdown_252d: number | null;
  fwd_ret_1d: number | null;
  fwd_ret_5d: number | null;
  fwd_ret_10d: number | null;
  fwd_ret_20d: number | null;
  fwd_ret_after_cost_1d: number | null;
  fwd_ret_after_cost_5d: number | null;
  fwd_ret_after_cost_10d: number | null;
  fwd_ret_after_cost_20d: number | null;
  label_available_1d: boolean;
  label_available_5d: boolean;
  label_available_10d: boolean;
  label_available_20d: boolean;
}

export interface PriceFeatureLabelSummary {
  rowCount: number;
  firstDate: string | null;
  lastDate: string | null;
  tickers: string[];
  tickerCoverage: Array<{
    ticker: string;
    rowCount: number;
    firstDate: string | null;
    lastDate: string | null;
  }>;
  usableLabelCounts: {
    '1d': number;
    '5d': number;
    '10d': number;
    '20d': number;
  };
  nullFeatureCounts: {
    ret_1d: number;
    ret_5d: number;
    ret_20d: number;
    sma_20_gap: number;
    sma_50_gap: number;
    vol_20d: number;
    drawdown_252d: number;
    range_pct: number;
  };
}

export interface PriceFeatureLabelArtifact {
  lane: 'research_only';
  datasetType: 'price_features_and_forward_labels';
  schemaVersion: string;
  vendor: 'yahoo';
  generatedAt: string;
  sourceArtifactPath: string | null;
  sourceArtifactProvenance: {
    generatedAt: string;
    assembledAt: string | null;
    sourceFetchedAt: string;
    sourceFetchedAtMin: string | null;
    sourceFetchedAtMax: string | null;
  };
  priceBasis: {
    requested: ResearchPriceBasis;
    applied: ResearchPriceBasis;
    notes: string[];
  };
  labelBasis: ResearchLabelBasis;
  labelCostAssumption: {
    roundTripCostBps: number;
    roundTripCostDecimal: number;
    notes: string[];
  };
  features: {
    included: Array<
      | 'ret_1d'
      | 'ret_5d'
      | 'ret_20d'
      | 'sma_20_gap'
      | 'sma_50_gap'
      | 'vol_20d'
      | 'drawdown_252d'
      | 'range_pct'
    >;
  };
  labels: {
    included: Array<
      | 'fwd_ret_1d'
      | 'fwd_ret_5d'
      | 'fwd_ret_10d'
      | 'fwd_ret_20d'
      | 'fwd_ret_after_cost_1d'
      | 'fwd_ret_after_cost_5d'
      | 'fwd_ret_after_cost_10d'
      | 'fwd_ret_after_cost_20d'
      | 'label_available_1d'
      | 'label_available_5d'
      | 'label_available_10d'
      | 'label_available_20d'
    >;
  };
  summary: PriceFeatureLabelSummary;
  warnings: string[];
  rows: PriceFeatureLabelRow[];
}

const LOOKBACK_SMA20 = 20;
const LOOKBACK_SMA50 = 50;
const LOOKBACK_VOL20 = 20;
const LOOKBACK_DRAWDOWN252 = 252;

const DEFAULT_COST_BPS = 10;
const DEFAULT_SCHEMA_VERSION = 'price_feature_label_v1';

function toDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function mean(values: number[]): number {
  if (!values.length) return Number.NaN;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function stdDev(values: number[]): number {
  if (!values.length) return Number.NaN;
  const avg = mean(values);
  let varSum = 0;
  for (const value of values) {
    const diff = value - avg;
    varSum += diff * diff;
  }
  return Math.sqrt(varSum / values.length);
}

function defaultDatasetOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'research',
    'price-features',
    `price-feature-labels-${stamp}.json`,
  );
}

function usablePrice(row: YahooResearchNormalizedRow): {
  price: number;
  source: 'adjusted_close' | 'close';
} {
  if (typeof row.adjustedClose === 'number' && Number.isFinite(row.adjustedClose)) {
    return { price: row.adjustedClose, source: 'adjusted_close' };
  }
  return { price: row.close, source: 'close' };
}

function rollingSma(prices: number[], i: number, window: number): number | null {
  if (i < window - 1) return null;
  const slice = prices.slice(i - window + 1, i + 1);
  return mean(slice);
}

function computeForwardReturn(prices: number[], i: number, horizon: number): number | null {
  if (i + horizon >= prices.length) return null;
  const base = prices[i];
  const future = prices[i + horizon];
  if (!Number.isFinite(base) || !Number.isFinite(future) || base === 0) return null;
  return future / base - 1;
}

function analyzeTickerRows(
  ticker: string,
  rows: YahooResearchNormalizedRow[],
  roundTripCostDecimal: number,
  warnings: string[],
): PriceFeatureLabelRow[] {
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const prices: number[] = [];
  const priceSources: Array<'adjusted_close' | 'close'> = [];
  for (const row of sortedRows) {
    const used = usablePrice(row);
    prices.push(used.price);
    priceSources.push(used.source);
  }

  const out: PriceFeatureLabelRow[] = [];

  for (let i = 0; i < sortedRows.length; i += 1) {
    const row = sortedRows[i];
    const price = prices[i];

    const ret1d = i >= 1 && prices[i - 1] !== 0 ? price / prices[i - 1] - 1 : null;
    const ret5d = i >= 5 && prices[i - 5] !== 0 ? price / prices[i - 5] - 1 : null;
    const ret20d = i >= 20 && prices[i - 20] !== 0 ? price / prices[i - 20] - 1 : null;

    const sma20 = rollingSma(prices, i, LOOKBACK_SMA20);
    const sma50 = rollingSma(prices, i, LOOKBACK_SMA50);

    const sma20Gap = sma20 !== null && sma20 !== 0 ? price / sma20 - 1 : null;
    const sma50Gap = sma50 !== null && sma50 !== 0 ? price / sma50 - 1 : null;

    let vol20d: number | null = null;
    if (i >= LOOKBACK_VOL20) {
      const returns: number[] = [];
      for (let j = i - LOOKBACK_VOL20 + 1; j <= i; j += 1) {
        const prev = prices[j - 1];
        if (prev === 0) continue;
        returns.push(prices[j] / prev - 1);
      }
      if (returns.length === LOOKBACK_VOL20) {
        vol20d = stdDev(returns);
      }
    }

    let drawdown252: number | null = null;
    if (i >= LOOKBACK_DRAWDOWN252 - 1) {
      const start = i - LOOKBACK_DRAWDOWN252 + 1;
      let peak = Number.NEGATIVE_INFINITY;
      for (let j = start; j <= i; j += 1) {
        peak = Math.max(peak, prices[j]);
      }
      if (Number.isFinite(peak) && peak !== 0) {
        drawdown252 = price / peak - 1;
      }
    }

    let rangePct: number | null = null;
    if (row.close !== 0) {
      rangePct = (row.high - row.low) / row.close;
    } else {
      warnings.push(`range_pct null due to zero close for ${ticker} on ${row.date}`);
    }

    const fwd1d = computeForwardReturn(prices, i, 1);
    const fwd5d = computeForwardReturn(prices, i, 5);
    const fwd10d = computeForwardReturn(prices, i, 10);
    const fwd20d = computeForwardReturn(prices, i, 20);

    out.push({
      ticker,
      date: row.date,
      close: row.close,
      adjustedClose: row.adjustedClose,
      priceUsed: price,
      priceSource: priceSources[i],
      open: row.open,
      high: row.high,
      low: row.low,
      volume: row.volume,
      range_pct: rangePct,
      ret_1d: ret1d,
      ret_5d: ret5d,
      ret_20d: ret20d,
      sma_20_gap: sma20Gap,
      sma_50_gap: sma50Gap,
      vol_20d: vol20d,
      drawdown_252d: drawdown252,
      fwd_ret_1d: fwd1d,
      fwd_ret_5d: fwd5d,
      fwd_ret_10d: fwd10d,
      fwd_ret_20d: fwd20d,
      fwd_ret_after_cost_1d: fwd1d === null ? null : fwd1d - roundTripCostDecimal,
      fwd_ret_after_cost_5d: fwd5d === null ? null : fwd5d - roundTripCostDecimal,
      fwd_ret_after_cost_10d: fwd10d === null ? null : fwd10d - roundTripCostDecimal,
      fwd_ret_after_cost_20d: fwd20d === null ? null : fwd20d - roundTripCostDecimal,
      label_available_1d: fwd1d !== null,
      label_available_5d: fwd5d !== null,
      label_available_10d: fwd10d !== null,
      label_available_20d: fwd20d !== null,
    });
  }

  return out;
}

function buildSummary(rows: PriceFeatureLabelRow[]): PriceFeatureLabelSummary {
  const sorted = [...rows].sort((a, b) => {
    const byTicker = a.ticker.localeCompare(b.ticker);
    if (byTicker !== 0) return byTicker;
    return a.date.localeCompare(b.date);
  });

  const byTicker = new Map<string, PriceFeatureLabelRow[]>();
  for (const row of sorted) {
    const group = byTicker.get(row.ticker) ?? [];
    group.push(row);
    byTicker.set(row.ticker, group);
  }

  const tickerCoverage = Array.from(byTicker.entries())
    .map(([ticker, tickerRows]) => ({
      ticker,
      rowCount: tickerRows.length,
      firstDate: tickerRows[0]?.date ?? null,
      lastDate: tickerRows[tickerRows.length - 1]?.date ?? null,
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const countNull = (selector: (row: PriceFeatureLabelRow) => number | null): number => {
    let total = 0;
    for (const row of sorted) {
      if (selector(row) === null) total += 1;
    }
    return total;
  };

  return {
    rowCount: sorted.length,
    firstDate: sorted[0]?.date ?? null,
    lastDate: sorted[sorted.length - 1]?.date ?? null,
    tickers: tickerCoverage.map((item) => item.ticker),
    tickerCoverage,
    usableLabelCounts: {
      '1d': sorted.filter((row) => row.label_available_1d).length,
      '5d': sorted.filter((row) => row.label_available_5d).length,
      '10d': sorted.filter((row) => row.label_available_10d).length,
      '20d': sorted.filter((row) => row.label_available_20d).length,
    },
    nullFeatureCounts: {
      ret_1d: countNull((row) => row.ret_1d),
      ret_5d: countNull((row) => row.ret_5d),
      ret_20d: countNull((row) => row.ret_20d),
      sma_20_gap: countNull((row) => row.sma_20_gap),
      sma_50_gap: countNull((row) => row.sma_50_gap),
      vol_20d: countNull((row) => row.vol_20d),
      drawdown_252d: countNull((row) => row.drawdown_252d),
      range_pct: countNull((row) => row.range_pct),
    },
  };
}

export function buildPriceFeatureLabelArtifact(
  normalized: YahooNormalizedResearchArtifact,
  config: PriceFeatureLabelBuilderConfig = {},
): PriceFeatureLabelArtifact {
  const now = config.now ?? new Date();
  const schemaVersion = config.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
  const priceBasis = config.priceBasis ?? 'adjusted_close_if_available_else_close';
  const resolvedLabelBasis = config.labelBasis ?? 'selected_price_to_selected_price';
  const roundTripCostBps =
    typeof config.roundTripCostBps === 'number' && Number.isFinite(config.roundTripCostBps)
      ? config.roundTripCostBps
      : DEFAULT_COST_BPS;

  const warnings = [...normalized.warnings];

  const byTicker = new Map<string, YahooResearchNormalizedRow[]>();
  for (const row of normalized.rows) {
    const list = byTicker.get(row.ticker) ?? [];
    list.push(row);
    byTicker.set(row.ticker, list);
  }

  const rows: PriceFeatureLabelRow[] = [];
  const tickers = Array.from(byTicker.keys()).sort((a, b) => a.localeCompare(b));
  const roundTripCostDecimal = roundTripCostBps / 10_000;

  for (const ticker of tickers) {
    const tickerRows = byTicker.get(ticker) ?? [];
    rows.push(...analyzeTickerRows(ticker, tickerRows, roundTripCostDecimal, warnings));
  }

  rows.sort((a, b) => {
    const byTickerCmp = a.ticker.localeCompare(b.ticker);
    if (byTickerCmp !== 0) return byTickerCmp;
    return a.date.localeCompare(b.date);
  });

  const summary = buildSummary(rows);

  return {
    lane: 'research_only',
    datasetType: 'price_features_and_forward_labels',
    schemaVersion,
    vendor: 'yahoo',
    generatedAt: now.toISOString(),
    sourceArtifactPath: config.sourceArtifactPath ?? null,
    sourceArtifactProvenance: {
      generatedAt: normalized.generatedAt,
      assembledAt: normalized.assembledAt,
      sourceFetchedAt: normalized.sourceFetchedAt,
      sourceFetchedAtMin: normalized.sourceFetchedAtMin,
      sourceFetchedAtMax: normalized.sourceFetchedAtMax,
    },
    priceBasis: {
      requested: priceBasis,
      applied: priceBasis,
      notes: [
        'Research-only dataset. Uses adjustedClose when available, otherwise close.',
        'Raw close and adjustedClose are both retained per row for context.',
      ],
    },
    labelBasis: resolvedLabelBasis,
    labelCostAssumption: {
      roundTripCostBps,
      roundTripCostDecimal,
      notes: [
        'Simple fixed round-trip cost assumption for offline label sensitivity only.',
        'Not execution PnL and not live-equivalent trade simulation.',
      ],
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
    summary,
    warnings: Array.from(new Set(warnings)).sort((a, b) => a.localeCompare(b)),
    rows,
  };
}

export async function persistPriceFeatureLabelArtifact(
  artifact: PriceFeatureLabelArtifact,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultDatasetOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return target;
}

export async function loadNormalizedYahooArtifactFromFile(
  inputPath: string,
): Promise<YahooNormalizedResearchArtifact> {
  const absolute = path.resolve(inputPath);
  const parsed = JSON.parse(await readFile(absolute, 'utf8')) as YahooNormalizedResearchArtifact;

  if (parsed.lane !== 'research_only' || parsed.vendor !== 'yahoo' || !Array.isArray(parsed.rows)) {
    throw new Error('Input is not a valid normalized Yahoo research artifact.');
  }

  // Ensure deterministic row ordering even if source file was edited.
  parsed.rows.sort((a, b) => {
    const byTicker = a.ticker.localeCompare(b.ticker);
    if (byTicker !== 0) return byTicker;
    return a.date.localeCompare(b.date);
  });

  // Validate date format lightly to prevent accidental malformed input in offline runs.
  for (const row of parsed.rows) {
    toDate(row.date);
  }

  return parsed;
}
