# Research SMA20 Walk-Forward Decision Report

## Purpose

This workflow combines the SMA20 evidence trail into one larger research-only
decision gate. Earlier work found that `sma20_gap_reversion` was the strongest
simple price-only family, but it failed holdout as a `research_candidate`.
Risk controls improved the holdout profile, but the result remained fragile.

This report asks whether SMA20 risk-controlled research should continue, pivot
to new features, or stop as a price-only path.

## Scope

- Research-only historical simulation.
- Uses an existing local price-feature artifact only.
- No production signal logic changes.
- No `runDailyScan` behavior changes.
- No model training.
- No policy tuning.
- No live provider usage.
- No auto-trading or live trading.

## Grid

The decision grid evaluates:

- `topN`: `4`, `6`, `8`
- `costBps`: `0`, `10`, `25`
- `deepPullbackThreshold`: `-0.06`, `-0.08`, `-0.10`, `-0.12`, `-0.15`
- `sectorCap`: `none`, `one_per_sector`
- `cooldownLossThreshold`: `none`, `-0.08`
- `cooldownDays`: `20` when cooldown is enabled

Variants included:

- `baseline`
- `avoid_deep_pullback`
- `sector_cap_one`
- `avoid_deep_pullback_plus_sector_cap`
- `avoid_deep_pullback_plus_cooldown`

The high-volatility skip is intentionally not part of the default decision
grid because the regime/risk diagnostic did not identify it as the main
failure mode.

## Walk-Forward Discipline

Each walk-forward period selects the best config using only the train window.
The selected config is then evaluated unchanged on the test window.

Walk-forward windows:

| Window | Train | Test |
| --- | --- | --- |
| `wf_2023` | `2021-01-04` to `2022-12-31` | `2023-01-01` to `2023-12-31` |
| `wf_2024` | `2021-01-04` to `2023-12-31` | `2024-01-01` to `2024-12-31` |
| `wf_2025` | `2021-01-04` to `2024-12-31` | `2025-01-01` to `2025-12-31` |
| `wf_2026_ytd` | `2021-01-04` to `2025-12-31` | `2026-01-01` to `2026-04-24` |

Train selection ranks by:

1. profit verdict
2. Sharpe descending
3. absolute max drawdown ascending
4. benchmark-relative return descending
5. cost bps descending
6. topN descending

## Benchmarks

V1 compares selected test results against:

- equal-weight buy-and-hold from the existing profit backtest lane
- baseline SMA20 with the same selected `topN` and `costBps`

Equal-weight weekly rebalance and topN=6 buy-and-hold baskets are not
implemented in v1.

## Decision Rules

`continue_sma20_research` requires:

- at least 2 of 4 test windows are `research_candidate`
- at least 3 of 4 are `weak` or better
- average test benchmark-relative return is positive
- every selected test max drawdown is no worse than the equal-weight benchmark
- at least one selected config uses `costBps >= 10`

`pivot_to_new_features` means fewer than 2 test windows are
`research_candidate`, but at least 2 are `weak` or better and average
benchmark-relative return remains positive.

`stop_sma20_price_only` means fewer than 2 test windows are `weak` or better,
average benchmark-relative return is not positive, or drawdown remains worse
than benchmark.

## Usage

```sh
npm run -s research:sma20-decision -- \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```

If `npm` cannot find `bun`, run the equivalent local CLI:

```sh
npx tsx src/signal-engine/research/sma20-walkforward-decision-report.cli.ts \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```

## Limitations

- Historical simulation only.
- Same 31-ticker expanded universe.
- Yahoo-derived local research artifact only.
- Short partial-year 2026 test window.
- No survivorship-bias control beyond the chosen liquid universe.
- Simplified fixed transaction costs.
- No production, training, policy, or live-trading use.
