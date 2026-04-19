# Research Multi-Ticker Price Separation (Offline, Descriptive)

## Purpose

This workflow performs **research-only descriptive analysis** on already-built local price-feature dataset artifacts.

It does not fetch market data, does not generate new datasets, and does not modify any production signal behavior.

## Scope

- Input: one or more local `price_features_and_forward_labels` JSON artifacts.
- Output: one analysis JSON report under `.dexter/signal-engine/research/analysis/`.
- Labels analyzed: `fwd_ret_5d` and `fwd_ret_20d` only.
- Features analyzed: all existing v1 price-only feature columns.

Out of scope:

- model fitting/training
- policy tuning
- production signal logic changes
- backtest/walk-forward engine changes

## What It Computes

For each feature and each horizon:

1. 5 quantile buckets on non-null rows.
2. Per-quantile stats:
   - count
   - mean forward return
   - median forward return
   - hit rate (`% > 0` forward return)
3. Separation metrics:
   - `q5MinusQ1MeanSpread`
   - `q5MinusQ1HitRateSpread`

The report includes:

- per-ticker summaries
- pooled summary across all tickers
- first-half vs second-half stability checks
- cross-ticker consistency ranking
- explicit instability flags

## Instability Flags (v1)

Minimum deterministic flags:

- `half_sign_flip`: q5-q1 spread changes sign between first and second half.
- `pooled_sign_differs_majority_ticker_sign`: pooled spread sign disagrees with the majority ticker sign.
- `weak_pooled_spread`: absolute pooled spread below configured threshold.

## Guardrails

- Research-only and non-production.
- No production coupling to `runDailyScan`.
- No model training.
- No policy changes.
- Pooled statistics never replace ticker-level diagnostics.

## CLI Usage

```bash
bun run src/signal-engine/research/multiticker-separation-analysis.cli.ts \
  --file /tmp/aapl-price-feature-labels.json,/tmp/msft-price-feature-labels.json
```

Optional flags:

- `--dir <path[,path]>`
- `--out <path>`
- `--weak-spread-threshold <number>`
- `--json`

## Interpretation

Use output labels as descriptive buckets only:

- `promising`: stronger spread without immediate instability flags
- `weak_noisy`: spread magnitude too small
- `unstable`: sign-flip behavior or pooled/ticker disagreement

These labels are **not** claims of predictive power.

