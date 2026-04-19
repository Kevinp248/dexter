# Research Price Feature/Label Lane (Yahoo Normalized Input)

## Purpose

This lane builds a **research-only** dataset of price-derived features and forward-return labels from normalized Yahoo daily OHLCV artifacts.

It is intentionally cheap and offline.

It is **not** production signal generation, **not** full Dexter replay, and **not** live-equivalent aggregate-score reconstruction.

## Scope (v1)

- Input: normalized Yahoo research artifact JSON (no network/provider calls)
- Output: deterministic dataset artifact under `.dexter/signal-engine/research/price-features/`
- Features: price-derived only
- Labels: selected-price-to-selected-price forward returns with optional fixed-cost variants

Not included in v1:

- fundamentals, earnings, news, sentiment
- model training or auto-trading
- claims of full parity with the production signal engine

## Price Basis Policy

Default basis is explicit and fixed in metadata:

- use `adjustedClose` if available
- otherwise use `close`

Both `close` and `adjustedClose` are preserved in each output row so adjusted/raw comparisons remain possible.

## Feature Set (v1)

- `ret_1d`
- `ret_5d`
- `ret_20d`
- `sma_20_gap`
- `sma_50_gap`
- `vol_20d`
- `drawdown_252d`
- `range_pct`

No RSI/MACD/ATR in this PR.

## Label Set (v1)

- `fwd_ret_1d`, `fwd_ret_5d`, `fwd_ret_10d`, `fwd_ret_20d`
- `fwd_ret_after_cost_1d`, `fwd_ret_after_cost_5d`, `fwd_ret_after_cost_10d`, `fwd_ret_after_cost_20d`
- `label_available_1d`, `label_available_5d`, `label_available_10d`, `label_available_20d`

Label semantics:

- `labelBasis = selected_price_to_selected_price`
- selected price means `adjustedClose` when available, otherwise `close`
- after-cost labels use a simple fixed round-trip cost assumption (documented in metadata)
- these are research labels, not execution PnL

## Edge Handling

- insufficient lookback => feature `null`
- insufficient lookahead => forward labels `null` and `label_available_* = false`
- deterministic sorting by `(ticker, date)`
- no look-ahead leakage in feature computation

## Guardrails

- research-only and non-production
- no production coupling to `runDailyScan`
- no ticker-specific overfitting as default workflow
- prefer global/bucketed calibration before any ticker-specific tuning

## CLI Usage

```bash
bun run src/signal-engine/research/price-feature-labels.cli.ts \
  --in .dexter/signal-engine/research/yahoo/normalized/yahoo-normalized-<timestamp>.json
```

Optional flags:

- `--out <path>`
- `--source-ref <string>`
- `--cost-bps <number>`
- `--json`
