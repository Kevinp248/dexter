# Signal Quality Dashboard

Last updated: 2026-04-09

Use this to evaluate signal quality by action and confidence bucket.

## 1) Prerequisite

- Keep `.dexter/signal-engine/paper-trade-log.csv` current.
- Include `Confidence` column from scan output (recommended).

## 2) Run dashboard

```bash
bun run quality:signals
```

Optional:

```bash
bun run quality:signals --days 60
bun run quality:signals --json
bun run quality:signals --log /custom/path/paper-trade-log.csv
```

## 3) Metrics returned

- Overall hit rate on closed traded rows.
- Hit rate and average result by final action (`BUY/SELL/HOLD/COVER`).
- Hit rate and average result by confidence bucket:
  - `LOW` (<40)
  - `MEDIUM` (40-69.99)
  - `HIGH` (>=70)
  - `UNKNOWN` (missing confidence)

## 4) How to use it

- If `HIGH` bucket underperforms `MEDIUM`, your confidence mapping likely needs recalibration.
- If `BUY` underperforms while `SELL`/`COVER` perform, reduce long aggressiveness.
- If `UNKNOWN` count is high, fix logging discipline before trusting diagnostics.
