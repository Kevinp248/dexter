import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PositionContext } from './models.js';

export type TradeSide = 'BUY' | 'SELL' | 'SHORT' | 'COVER';

export interface FillInput {
  executedAt?: string;
  ticker: string;
  side: TradeSide;
  quantity: number;
  price: number;
  feeUsd?: number;
  source?: 'manual' | 'signal';
  note?: string;
}

export interface FillRecord {
  id: string;
  executedAt: string;
  ticker: string;
  side: TradeSide;
  quantity: number;
  price: number;
  feeUsd: number;
  source: 'manual' | 'signal';
  note: string;
}

export interface TickerPositionState {
  longShares: number;
  shortShares: number;
  longCostBasis: number;
  shortCostBasis: number;
  realizedPnlUsd: number;
  totalFeesUsd: number;
  lastTradeAt: string | null;
}

export interface PositionStateSnapshot {
  generatedAt: string;
  fillsCount: number;
  positions: Record<string, TickerPositionState>;
  totals: {
    realizedPnlUsd: number;
    totalFeesUsd: number;
    openLongCount: number;
    openShortCount: number;
  };
}

type LedgerPaths = {
  baseDir: string;
  fillsPath: string;
  positionsPath: string;
};

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeSide(value: string): TradeSide {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === 'BUY' ||
    normalized === 'SELL' ||
    normalized === 'SHORT' ||
    normalized === 'COVER'
  ) {
    return normalized;
  }
  throw new Error(`Unsupported side: ${value}`);
}

function resolvePaths(baseDir = path.join(process.cwd(), '.dexter', 'signal-engine')): LedgerPaths {
  return {
    baseDir,
    fillsPath: path.join(baseDir, 'fills.jsonl'),
    positionsPath: path.join(baseDir, 'positions.json'),
  };
}

function emptyTickerState(): TickerPositionState {
  return {
    longShares: 0,
    shortShares: 0,
    longCostBasis: 0,
    shortCostBasis: 0,
    realizedPnlUsd: 0,
    totalFeesUsd: 0,
    lastTradeAt: null,
  };
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function validateFillInput(fill: FillInput): FillRecord {
  const quantity = Math.floor(clampNonNegative(fill.quantity));
  const price = clampNonNegative(fill.price);
  if (!fill.ticker || !fill.ticker.trim()) {
    throw new Error('ticker is required');
  }
  if (quantity <= 0) {
    throw new Error('quantity must be > 0');
  }
  if (price <= 0) {
    throw new Error('price must be > 0');
  }

  const executedAt = fill.executedAt ?? new Date().toISOString();
  return {
    id: randomUUID(),
    executedAt,
    ticker: normalizeTicker(fill.ticker),
    side: normalizeSide(fill.side),
    quantity,
    price,
    feeUsd: clampNonNegative(fill.feeUsd ?? 0),
    source: fill.source ?? 'manual',
    note: fill.note?.trim() ?? '',
  };
}

function getOrCreateState(
  positions: Record<string, TickerPositionState>,
  ticker: string,
): TickerPositionState {
  const normalized = normalizeTicker(ticker);
  positions[normalized] = positions[normalized] ?? emptyTickerState();
  return positions[normalized];
}

function applyFill(
  positions: Record<string, TickerPositionState>,
  fill: FillRecord,
): void {
  const state = getOrCreateState(positions, fill.ticker);
  state.lastTradeAt = fill.executedAt;
  state.totalFeesUsd = round4(state.totalFeesUsd + fill.feeUsd);

  if (fill.side === 'BUY') {
    const totalCost = state.longCostBasis * state.longShares + fill.price * fill.quantity + fill.feeUsd;
    state.longShares += fill.quantity;
    state.longCostBasis = state.longShares > 0 ? round4(totalCost / state.longShares) : 0;
    return;
  }

  if (fill.side === 'SELL') {
    const qty = Math.min(fill.quantity, state.longShares);
    if (qty <= 0) return;
    const realized = (fill.price - state.longCostBasis) * qty - fill.feeUsd;
    state.realizedPnlUsd = round4(state.realizedPnlUsd + realized);
    state.longShares -= qty;
    if (state.longShares === 0) state.longCostBasis = 0;
    return;
  }

  if (fill.side === 'SHORT') {
    const totalOpenValue =
      state.shortCostBasis * state.shortShares + fill.price * fill.quantity;
    state.shortShares += fill.quantity;
    state.shortCostBasis =
      state.shortShares > 0 ? round4(totalOpenValue / state.shortShares) : 0;
    // Opening fees reduce realized PnL immediately.
    state.realizedPnlUsd = round4(state.realizedPnlUsd - fill.feeUsd);
    return;
  }

  if (fill.side === 'COVER') {
    const qty = Math.min(fill.quantity, state.shortShares);
    if (qty <= 0) return;
    const realized = (state.shortCostBasis - fill.price) * qty - fill.feeUsd;
    state.realizedPnlUsd = round4(state.realizedPnlUsd + realized);
    state.shortShares -= qty;
    if (state.shortShares === 0) state.shortCostBasis = 0;
  }
}

export function rebuildPositionsFromFills(fills: FillRecord[]): PositionStateSnapshot {
  const ordered = fills
    .map((fill, index) => ({ fill, index }))
    .sort((a, b) => {
      const aTs = Date.parse(a.fill.executedAt);
      const bTs = Date.parse(b.fill.executedAt);
      if (Number.isNaN(aTs) && Number.isNaN(bTs)) return a.index - b.index;
      if (Number.isNaN(aTs)) return 1;
      if (Number.isNaN(bTs)) return -1;
      if (aTs === bTs) return a.index - b.index;
      return aTs - bTs;
    })
    .map((row) => row.fill);

  const positions: Record<string, TickerPositionState> = {};
  for (const fill of ordered) {
    applyFill(positions, fill);
  }

  const totals = Object.values(positions).reduce(
    (acc, state) => {
      acc.realizedPnlUsd += state.realizedPnlUsd;
      acc.totalFeesUsd += state.totalFeesUsd;
      if (state.longShares > 0) acc.openLongCount += 1;
      if (state.shortShares > 0) acc.openShortCount += 1;
      return acc;
    },
    {
      realizedPnlUsd: 0,
      totalFeesUsd: 0,
      openLongCount: 0,
      openShortCount: 0,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    fillsCount: ordered.length,
    positions,
    totals: {
      realizedPnlUsd: round4(totals.realizedPnlUsd),
      totalFeesUsd: round4(totals.totalFeesUsd),
      openLongCount: totals.openLongCount,
      openShortCount: totals.openShortCount,
    },
  };
}

export async function loadFills(baseDir?: string): Promise<FillRecord[]> {
  const paths = resolvePaths(baseDir);
  try {
    const raw = await readFile(paths.fillsPath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const fills: FillRecord[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as FillRecord;
        if (
          typeof parsed?.ticker === 'string' &&
          typeof parsed?.side === 'string' &&
          Number.isFinite(parsed?.quantity) &&
          Number.isFinite(parsed?.price)
        ) {
          fills.push({
            id: typeof parsed.id === 'string' ? parsed.id : randomUUID(),
            executedAt:
              typeof parsed.executedAt === 'string'
                ? parsed.executedAt
                : new Date().toISOString(),
            ticker: normalizeTicker(parsed.ticker),
            side: normalizeSide(parsed.side),
            quantity: Math.floor(clampNonNegative(parsed.quantity)),
            price: clampNonNegative(parsed.price),
            feeUsd: clampNonNegative(parsed.feeUsd ?? 0),
            source: parsed.source === 'signal' ? 'signal' : 'manual',
            note: typeof parsed.note === 'string' ? parsed.note : '',
          });
        }
      } catch {
        // Skip malformed rows to keep ledger robust.
      }
    }
    return fills;
  } catch {
    return [];
  }
}

export async function savePositionState(
  snapshot: PositionStateSnapshot,
  baseDir?: string,
): Promise<void> {
  const paths = resolvePaths(baseDir);
  await mkdir(paths.baseDir, { recursive: true });
  await writeFile(paths.positionsPath, JSON.stringify(snapshot, null, 2), 'utf8');
}

export async function loadPositionState(baseDir?: string): Promise<PositionStateSnapshot | null> {
  const paths = resolvePaths(baseDir);
  try {
    const raw = await readFile(paths.positionsPath, 'utf8');
    return JSON.parse(raw) as PositionStateSnapshot;
  } catch {
    return null;
  }
}

export async function appendFillAndRebuild(
  fill: FillInput,
  baseDir?: string,
): Promise<{ fill: FillRecord; snapshot: PositionStateSnapshot }> {
  const paths = resolvePaths(baseDir);
  const validated = validateFillInput(fill);
  await mkdir(paths.baseDir, { recursive: true });
  await appendFile(paths.fillsPath, `${JSON.stringify(validated)}\n`, 'utf8');
  const fills = await loadFills(baseDir);
  const snapshot = rebuildPositionsFromFills(fills);
  await savePositionState(snapshot, baseDir);
  return { fill: validated, snapshot };
}

export async function rebuildAndPersistPositionState(baseDir?: string): Promise<PositionStateSnapshot> {
  const fills = await loadFills(baseDir);
  const snapshot = rebuildPositionsFromFills(fills);
  await savePositionState(snapshot, baseDir);
  return snapshot;
}

export async function loadPositionContexts(baseDir?: string): Promise<Record<string, PositionContext>> {
  const snapshot = await loadPositionState(baseDir);
  if (!snapshot) return {};
  return Object.fromEntries(
    Object.entries(snapshot.positions).map(([ticker, state]) => [
      ticker,
      { longShares: state.longShares, shortShares: state.shortShares },
    ]),
  );
}

