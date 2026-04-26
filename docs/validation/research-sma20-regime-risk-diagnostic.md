# Research SMA20 Regime And Risk Diagnostic

This workflow diagnoses why `sma20_gap_reversion` weakened in the 2025-2026
holdout after looking strong in the 2021-2024 research window.

It follows the holdout validation gate. The holdout result was
`holdout_fragile`, with no holdout row reaching `research_candidate`. This lane
does not change the strategy. It explains where the historical simulation
worked or failed and proposes hypotheses for a later research step.

## Scope

This is research-only historical analysis.

- No production signal logic changes
- No model training
- No policy tuning
- No auto-trading
- No `runDailyScan` behavior changes
- No live provider calls
- Uses existing local price-feature artifacts only

## Focus Configs

The diagnostic inspects `sma20_gap_reversion`:

- Feature: `sma_20_gap`
- Rank direction: ascending
- Hold period: `20` trading days
- Rebalance frequency: weekly

Default focus configs:

- `topN=6`, `costBps=0`
- `topN=6`, `costBps=10`
- `topN=4`, `costBps=0`
- `topN=4`, `costBps=10`

## Diagnostics

The report breaks trades down by:

- calendar year
- calendar quarter
- research versus holdout window
- trailing 20-day equal-weight market trend
- equal-weight average `vol_20d` tercile
- universe breadth, measured as percent above SMA20
- selected basket pullback severity
- ticker
- sector-like bucket

Sector buckets are hardcoded for the expanded 31-ticker universe. They are used
only for research concentration diagnostics.

## Interpretation

The output proposes filter hypotheses such as avoiding weak breadth, high
volatility, market-down regimes, or deep pullbacks. These are hypotheses only.
They are not implemented as strategy changes and must be tested in a separate
research step before any further conclusion.

Passing this diagnostic is not production evidence. No result from this lane
should be used for live trading, production policy tuning, or model training.

## Example

```sh
npm run -s research:sma20-regime-risk -- \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```

If `npm` cannot find `bun`, run the equivalent local CLI:

```sh
npx tsx src/signal-engine/research/sma20-regime-risk-diagnostic.cli.ts \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```
