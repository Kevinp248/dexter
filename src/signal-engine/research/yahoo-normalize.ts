import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  YahooRawHistoryArtifact,
  YahooRawTickerResult,
} from './yahoo-history-fetch.js';

export interface YahooResearchNormalizedRow {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number | null;
  volume: number;
  vendor: 'yahoo';
  fetchedAt: string;
  requested: {
    startDate: string;
    endDate: string;
    interval: '1d';
  };
  priceBasis: {
    closeField: 'close';
    adjustedCloseField: 'adjustedClose';
    defaultResearchBasis: 'adjusted_close_if_available_else_close';
  };
}

export interface YahooResearchTickerSummary {
  ticker: string;
  status: 'success' | 'empty' | 'error';
  rowCount: number;
  startDate: string | null;
  endDate: string | null;
  approximateMissingWeekdays: number;
}

export interface YahooNormalizedResearchArtifact {
  lane: 'research_only';
  vendor: 'yahoo';
  generatedAt: string;
  assembledAt: string | null;
  sourceFetchedAtMin: string | null;
  sourceFetchedAtMax: string | null;
  sourceFetchedAt: string;
  requested: {
    startDate: string;
    endDate: string;
    interval: '1d';
  };
  priceBasis: {
    closeField: 'close';
    adjustedCloseField: 'adjustedClose';
    defaultResearchBasis: 'adjusted_close_if_available_else_close';
    notes: string[];
  };
  rows: YahooResearchNormalizedRow[];
  tickerSummaries: YahooResearchTickerSummary[];
  warnings: string[];
}

function isIsoDateTime(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function resolveSourceProvenance(raw: YahooRawHistoryArtifact): {
  assembledAt: string | null;
  sourceFetchedAtMin: string | null;
  sourceFetchedAtMax: string | null;
  sourceFetchedAt: string;
} {
  const assembledAt =
    typeof raw.assembledAt === 'string'
      ? raw.assembledAt
      : typeof raw.fetchedAt === 'string'
        ? raw.fetchedAt
        : null;

  const fromTopMin =
    typeof raw.sourceFetchedAtMin === 'string'
      ? raw.sourceFetchedAtMin
      : null;
  const fromTopMax =
    typeof raw.sourceFetchedAtMax === 'string'
      ? raw.sourceFetchedAtMax
      : null;

  const validTickerFetchedAt = raw.tickers
    .map((ticker) => ticker.fetchedAt)
    .filter((value) => typeof value === 'string' && isIsoDateTime(value))
    .sort((a, b) => a.localeCompare(b));

  const sourceFetchedAtMin = fromTopMin ?? (validTickerFetchedAt[0] ?? null);
  const sourceFetchedAtMax =
    fromTopMax ?? (validTickerFetchedAt[validTickerFetchedAt.length - 1] ?? null);

  const sourceFetchedAt = sourceFetchedAtMax ?? sourceFetchedAtMin ?? assembledAt ?? nowIsoFallback();
  return {
    assembledAt,
    sourceFetchedAtMin,
    sourceFetchedAtMax,
    sourceFetchedAt,
  };
}

function nowIsoFallback(): string {
  return new Date().toISOString();
}

function asDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function asFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function weekdayCountInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (start > end) return 0;
  let count = 0;
  while (start <= end) {
    const day = start.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return count;
}

function extractRowsForTicker(
  tickerRow: YahooRawTickerResult,
  requested: YahooNormalizedResearchArtifact['requested'],
  warnings: string[],
): YahooResearchNormalizedRow[] {
  if (!tickerRow.response || typeof tickerRow.response !== 'object') return [];
  const chart = (tickerRow.response as Record<string, unknown>).chart;
  if (!chart || typeof chart !== 'object') return [];
  const result = (chart as Record<string, unknown>).result;
  if (!Array.isArray(result) || result.length === 0) return [];
  const first = result[0];
  if (!first || typeof first !== 'object') return [];

  const timestamps = (first as Record<string, unknown>).timestamp;
  const indicators = (first as Record<string, unknown>).indicators;
  if (!Array.isArray(timestamps) || !indicators || typeof indicators !== 'object') return [];

  const quoteList = (indicators as Record<string, unknown>).quote;
  const adjList = (indicators as Record<string, unknown>).adjclose;
  const quote = Array.isArray(quoteList) && quoteList[0] && typeof quoteList[0] === 'object'
    ? (quoteList[0] as Record<string, unknown>)
    : null;
  const adjCloseRec = Array.isArray(adjList) && adjList[0] && typeof adjList[0] === 'object'
    ? (adjList[0] as Record<string, unknown>)
    : null;
  if (!quote) return [];

  const opens = quote.open;
  const highs = quote.high;
  const lows = quote.low;
  const closes = quote.close;
  const volumes = quote.volume;
  const adjusted = adjCloseRec?.adjclose;

  if (!Array.isArray(opens) || !Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes) || !Array.isArray(volumes)) {
    return [];
  }

  const rows: YahooResearchNormalizedRow[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    const open = asFinite(opens[i]);
    const high = asFinite(highs[i]);
    const low = asFinite(lows[i]);
    const close = asFinite(closes[i]);
    const volume = asFinite(volumes[i]);
    const adjustedClose = Array.isArray(adjusted) ? asFinite(adjusted[i]) : null;

    if (open === null || high === null || low === null || close === null || volume === null) {
      warnings.push(`Dropped malformed OHLCV row for ${tickerRow.ticker} on index ${i}.`);
      continue;
    }

    rows.push({
      ticker: tickerRow.ticker,
      date: asDate(ts),
      open,
      high,
      low,
      close,
      adjustedClose,
      volume,
      vendor: 'yahoo',
      fetchedAt: tickerRow.fetchedAt,
      requested,
      priceBasis: {
        closeField: 'close',
        adjustedCloseField: 'adjustedClose',
        defaultResearchBasis: 'adjusted_close_if_available_else_close',
      },
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export function normalizeYahooRawArtifact(
  raw: YahooRawHistoryArtifact,
  now: Date = new Date(),
): YahooNormalizedResearchArtifact {
  const warnings = [...raw.warnings];
  const rows: YahooResearchNormalizedRow[] = [];
  const tickerSummaries: YahooResearchTickerSummary[] = [];

  const tickersSorted = [...raw.tickers].sort((a, b) => a.ticker.localeCompare(b.ticker));
  for (const tickerRow of tickersSorted) {
    const perTickerRows = extractRowsForTicker(tickerRow, raw.requested, warnings);
    rows.push(...perTickerRows);
    const startDate = perTickerRows[0]?.date ?? null;
    const endDate = perTickerRows[perTickerRows.length - 1]?.date ?? null;
    const expectedWeekdays =
      startDate && endDate ? weekdayCountInclusive(startDate, endDate) : 0;
    const missing = Math.max(0, expectedWeekdays - perTickerRows.length);
    tickerSummaries.push({
      ticker: tickerRow.ticker,
      status: tickerRow.status,
      rowCount: perTickerRows.length,
      startDate,
      endDate,
      approximateMissingWeekdays: missing,
    });
  }

  rows.sort((a, b) => {
    const byTicker = a.ticker.localeCompare(b.ticker);
    if (byTicker !== 0) return byTicker;
    return a.date.localeCompare(b.date);
  });

  const provenance = resolveSourceProvenance(raw);

  return {
    lane: 'research_only',
    vendor: 'yahoo',
    generatedAt: now.toISOString(),
    assembledAt: provenance.assembledAt,
    sourceFetchedAtMin: provenance.sourceFetchedAtMin,
    sourceFetchedAtMax: provenance.sourceFetchedAtMax,
    sourceFetchedAt: provenance.sourceFetchedAt,
    requested: {
      startDate: raw.requested.startDate,
      endDate: raw.requested.endDate,
      interval: raw.requested.interval,
    },
    priceBasis: {
      closeField: 'close',
      adjustedCloseField: 'adjustedClose',
      defaultResearchBasis: 'adjusted_close_if_available_else_close',
      notes: [
        'Research lane only. No production signal generation use.',
        'Adjusted and raw close are both preserved for vendor-parity analysis.',
      ],
    },
    rows,
    tickerSummaries,
    warnings: Array.from(new Set(warnings)).sort((a, b) => a.localeCompare(b)),
  };
}

function defaultNormalizedOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'research',
    'yahoo',
    'normalized',
    `yahoo-normalized-${stamp}.json`,
  );
}

export async function persistYahooNormalizedArtifact(
  artifact: YahooNormalizedResearchArtifact,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultNormalizedOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return target;
}
