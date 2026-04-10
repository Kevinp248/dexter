# Position Ledger (Persistent Trade Tracking)

Last updated: 2026-04-09

## What this solves

- Stores every manual/paper fill in an append-only ledger.
- Rebuilds deterministic position state (long/short shares, cost basis, realized P&L).
- Lets daily scan auto-load current positions on the next run.
- Enables per-alert mark-to-market P&L output in `positionPerformance`.

## Files

- `.dexter/signal-engine/fills.jsonl` (append-only raw fills)
- `.dexter/signal-engine/positions.json` (derived state snapshot)

## Commands

Record a fill:

```bash
bun run trade:ledger record --ticker AAPL --side BUY --qty 10 --price 200 --fee 1
```

Record another stock fill (example):

```bash
bun run trade:ledger record --ticker MSFT --side BUY --qty 5 --price 410 --fee 1
```

Sell part/all of a position:

```bash
bun run trade:ledger record --ticker AAPL --side SELL --qty 10 --price 260 --fee 1
```

Show current positions:

```bash
bun run trade:ledger show
```

Rebuild position state from ledger:

```bash
bun run trade:ledger rebuild
```

## Notes

- Supported sides: `BUY`, `SELL`, `SHORT`, `COVER`.
- `SELL` and `COVER` are clamped to available shares to prevent negative inventory.
- Opening short fees are counted immediately in realized P&L.
