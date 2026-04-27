# Research-Only Yahoo Price Lane (v1)

This lane is for cheap historical price research only.

## What it is

- A research-only workflow to fetch/cache Yahoo daily OHLCV history.
- A deterministic normalizer that produces a Dexter-compatible research price artifact.
- A low-cost input lane for later offline calibration/parity work.

## What it is not

- Not used in production `runDailyScan`.
- Not used for live alert decisions.
- Not a full Dexter row-level replay generator.
- Not an alpha-feature extension.
- Not an auto-trading workflow.

## Scope constraints (v1)

- Daily OHLCV only.
- No Yahoo fundamentals/news/earnings/sentiment ingestion.
- Research artifact output under `.dexter/signal-engine/research/`.
- Keep adjusted vs raw price basis explicit in output metadata.

## Output shape highlights

Normalized rows include:

- `ticker`
- `date`
- `open`, `high`, `low`, `close`
- `adjustedClose` (when available)
- `volume`
- `vendor = yahoo`
- `fetchedAt`
- requested params (`startDate`, `endDate`, `interval`)
- explicit price-basis metadata

Top-level provenance includes:

- `assembledAt`: when the raw/normalized artifact was assembled locally
- `sourceFetchedAtMin` / `sourceFetchedAtMax`: source fetch-time range across ticker payloads
- `sourceFetchedAt`: stable source provenance field used for downstream research summaries

This distinction prevents cache-backed runs from appearing freshly source-fetched.

## Usage

Fetch + cache + normalize:

```bash
npm run research:yahoo:fetch -- --tickers AAPL,MSFT --start 2025-01-01 --end 2025-12-31
```

Normalize from an existing raw artifact:

```bash
npm run research:yahoo:normalize -- --normalize-from .dexter/signal-engine/research/yahoo/raw/yahoo-history-<stamp>.json
```

## Guardrails

- Research-only, non-production lane.
- Vendor parity and augmentation are required in a later step before calibration conclusions are treated as production-relevant.
- Avoid ticker-specific overfitting by default.
- Start with global or bucketed calibration before any ticker-specific tuning.
