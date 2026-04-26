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

## Evidence Report Gate

After generating the separation artifact, run the evidence report before considering any training work:

```bash
npm run research:multiticker-evidence -- \
  --in .dexter/signal-engine/research/analysis/multiticker-separation-<stamp>.json
```

The evidence report is still descriptive research only. It consumes the local separation JSON and applies deterministic gates; it does not fetch data, train a model, tune policy, change production signals, or change any backtest/walk-forward behavior.

Default evidence thresholds:

- ticker agreement ratio for broad agreement: `0.75`
- minimum stable ticker count: `5`
- ticker-specific maximum agreement ratio: `0.50`
- non-trivial pooled spread: `0.002`
- very small pooled spread: `0.002`

Evidence classifications:

- `research_candidate`: broad ticker agreement, at least 5 stable tickers, no pooled-vs-majority sign mismatch, no weak pooled spread, and no pooled half sign flip. This means it passed a descriptive research gate only; it is not training-ready or production-ready.
- `watchlist`: broad ticker agreement and at least 5 stable tickers, but weak pooled spread or pooled half sign flip keeps it research-only.
- `misleading_pooled`: pooled direction disagrees with the majority ticker direction.
- `unstable`: pooled half sign flip or unstable ticker count is at least the stable ticker count.
- `ticker_specific`: low ticker agreement with a non-trivial pooled spread.
- `weak`: weak or very small pooled spread.

Training readiness values are gates, not approvals:

- `no_train`: not suitable for training consideration.
- `expand_universe`: inspect more tickers/time periods before interpretation hardens.
- `research_only_candidate`: acceptable for deeper research discussion only, still not production.

Pooled results can hide ticker disagreement. Always review `misleading_pooled`, `tickerAgreementCount`, `tickerDisagreementCount`, and `unstableTickerCount` before treating a pooled spread as useful evidence.
