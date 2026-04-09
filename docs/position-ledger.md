# Position Ledger (Persistent Trade Tracking)

Last updated: 2026-04-09

## What this solves

- Stores every manual/paper fill in an append-only ledger.
- Rebuilds deterministic position state (long/short shares, cost basis, realized P&L).
- Lets daily scan auto-load current positions on the next run.

## Files

- `.dexter/signal-engine/fills.jsonl` (append-only raw fills)
- `.dexter/signal-engine/positions.json` (derived state snapshot)

## Commands

Record a fill:

```bash
bun run trade:ledger record --ticker AAPL --side BUY --qty 10 --price 200 --fee 1
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
