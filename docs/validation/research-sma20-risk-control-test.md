# Research SMA20 Risk-Control Test

## Purpose

This workflow follows the SMA20 regime/risk diagnostic. The diagnostic found
that `sma20_gap_reversion` did not pass holdout as a `research_candidate`, but
that risk controls may be worth testing before stopping the family entirely.

This lane tests whether simple, deterministic controls improve the historical
holdout behavior of the SMA20 family without changing production signal logic.

## Scope

- Research-only historical simulation.
- Uses existing local price-feature artifacts only.
- No production signal logic changes.
- No `runDailyScan` behavior changes.
- No model training.
- No policy tuning.
- No live provider usage.
- No auto-trading or live-trading use.

## Baseline Strategy

All variants start from `sma20_gap_reversion`:

- feature: `sma_20_gap`
- rank direction: ascending
- hold: 20 trading days
- rebalance: weekly
- non-overlapping baskets
- adjusted close when available, else close

Default grid:

- `topN`: `4`, `6`
- `costBps`: `0`, `10`, `25`
- windows: `full`, `research`, `holdout`

The default split is:

- research: `2021-01-04` through `2024-12-31`
- holdout: `2025-01-01` through `2026-04-24`

## Controls Tested

| Variant | Control |
| --- | --- |
| `baseline` | Existing SMA20 backtest behavior with no candidate filter. |
| `avoid_deep_pullback` | Exclude candidates with `sma_20_gap <= -0.10` and fill from the next eligible names. |
| `avoid_deep_pullback_and_high_vol` | Exclude deep pullbacks and skip rebalances when universe average `vol_20d` is in the high-volatility tercile. |
| `sector_cap_one` | Select at most one name per sector-like bucket per rebalance. |
| `avoid_deep_pullback_plus_sector_cap` | Combine deep-pullback exclusion and sector cap. |
| `ticker_cooldown_after_loss` | Exclude a ticker for 20 trading days after a closed trade with `netReturn <= -0.08`. |
| `avoid_deep_pullback_plus_cooldown` | Combine deep-pullback exclusion and ticker cooldown. |

Sector buckets reuse the regime/risk diagnostic mapping.

## Metrics

Each row reports:

- total return
- CAGR
- Sharpe
- max drawdown
- Calmar
- number of trades
- turnover
- win rate
- benchmark-relative return
- benchmark-relative max drawdown
- profit verdict
- average holdings per rebalance
- skipped candidates
- skipped rebalances
- cash-drag estimate
- notes and warnings

## Verdict Rules

`risk_control_pass` requires:

- at least one controlled holdout row is `research_candidate`
- at least one controlled holdout `research_candidate` survives `10 bps`
- holdout max drawdown is no worse than baseline `topN=6 / 10 bps`
- benchmark-relative return improves versus baseline `topN=6 / 10 bps`

`risk_control_fragile` means no pass, but at least one controlled holdout row is
`weak` and controlled rows improve at least two of Sharpe, max drawdown, and
benchmark-relative return versus baseline `topN=6 / 10 bps`.

`risk_control_fail` means no controlled variant improves enough to matter.

Final recommendation mapping:

- `risk_control_pass` -> `continue_sma20_with_risk_controls`
- `risk_control_fragile` -> `rethink_or_expand_controls`
- `risk_control_fail` -> `stop_sma20_research`

## Usage

```sh
npm run -s research:sma20-risk-control -- \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```

If `npm` cannot find `bun`, run the equivalent local CLI:

```sh
npx tsx src/signal-engine/research/sma20-risk-control-test.cli.ts \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```

## Interpretation

This workflow tests research hypotheses only. Passing this gate would not be
production, training, policy, or live-trading evidence. Any surviving variant
would still need broader validation, holdout discipline, and review before it
could inform later research.
