import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  appendFillAndRebuild,
  loadFills,
  loadPositionContexts,
  rebuildPositionsFromFills,
} from '../portfolio-ledger.js';

describe('portfolio ledger', () => {
  test('rebuilds long/short state and realized pnl deterministically', () => {
    const snapshot = rebuildPositionsFromFills([
      {
        id: '1',
        executedAt: '2026-04-01T10:00:00.000Z',
        ticker: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 100,
        feeUsd: 1,
        source: 'manual',
        note: '',
      },
      {
        id: '2',
        executedAt: '2026-04-02T10:00:00.000Z',
        ticker: 'AAPL',
        side: 'BUY',
        quantity: 10,
        price: 120,
        feeUsd: 1,
        source: 'manual',
        note: '',
      },
      {
        id: '3',
        executedAt: '2026-04-03T10:00:00.000Z',
        ticker: 'AAPL',
        side: 'SELL',
        quantity: 5,
        price: 130,
        feeUsd: 1,
        source: 'manual',
        note: '',
      },
      {
        id: '4',
        executedAt: '2026-04-04T10:00:00.000Z',
        ticker: 'MSFT',
        side: 'SHORT',
        quantity: 8,
        price: 200,
        feeUsd: 2,
        source: 'manual',
        note: '',
      },
      {
        id: '5',
        executedAt: '2026-04-05T10:00:00.000Z',
        ticker: 'MSFT',
        side: 'COVER',
        quantity: 3,
        price: 180,
        feeUsd: 1,
        source: 'manual',
        note: '',
      },
    ]);

    expect(snapshot.positions.AAPL.longShares).toBe(15);
    expect(snapshot.positions.AAPL.longCostBasis).toBe(110.1);
    expect(snapshot.positions.AAPL.realizedPnlUsd).toBe(98.5);

    expect(snapshot.positions.MSFT.shortShares).toBe(5);
    expect(snapshot.positions.MSFT.shortCostBasis).toBe(200);
    expect(snapshot.positions.MSFT.realizedPnlUsd).toBe(57);
  });

  test('append/load flow persists fills and contexts', async () => {
    const baseDir = await mkdtemp(path.join(os.tmpdir(), 'dexter-ledger-'));

    await appendFillAndRebuild(
      {
        executedAt: '2026-04-01T10:00:00.000Z',
        ticker: 'NVDA',
        side: 'BUY',
        quantity: 12,
        price: 90,
        feeUsd: 1.5,
      },
      baseDir,
    );
    await appendFillAndRebuild(
      {
        executedAt: '2026-04-02T10:00:00.000Z',
        ticker: 'NVDA',
        side: 'SELL',
        quantity: 2,
        price: 100,
        feeUsd: 1,
      },
      baseDir,
    );

    const fills = await loadFills(baseDir);
    expect(fills).toHaveLength(2);

    const contexts = await loadPositionContexts(baseDir);
    expect(contexts.NVDA.longShares).toBe(10);
    expect(contexts.NVDA.shortShares).toBe(0);
  });
});
