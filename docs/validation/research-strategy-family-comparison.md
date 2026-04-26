# Research Strategy Family Comparison

This workflow compares simple, explainable, long-only price-feature strategy
families using the existing research profit backtest lane. It was added after
the expanded-universe `sma20_gap_reversion` run showed fragility: the default
strategy degraded to `reject`, equal-weight buy-and-hold beat it, and only one
of 64 robustness-grid rows remained `research_candidate`.

The goal is to stop over-tuning one fragile SMA20 variant and instead identify
which broad strategy family, if any, deserves deeper research.

## Scope

This is research-only historical simulation.

- No production signal logic changes
- No model training
- No policy tuning
- No auto-trading
- No `runDailyScan` behavior changes
- No live provider calls
- Uses existing local price-feature artifacts only

## Families Tested

The default comparison runs six strategy families:

| Family | Feature | Rank | Hold | Rebalance |
| --- | --- | --- | ---: | --- |
| `sma20_gap_reversion` | `sma_20_gap` | ascending | 20 trading days | weekly |
| `sma50_gap_reversion` | `sma_50_gap` | ascending | 20 trading days | weekly |
| `ret_5d_reversal` | `ret_5d` | ascending | 5 trading days | weekly |
| `ret_20d_momentum` | `ret_20d` | descending | 20 trading days | weekly |
| `low_vol_20d` | `vol_20d` | ascending | 20 trading days | weekly |
| `drawdown_recovery` | `drawdown_252d` | ascending | 20 trading days | weekly |

For each family, the grid tests:

- `topN`: `2`, `4`, `6`
- `costBps`: `0`, `10`, `25`
- `rebalanceFrequency`: `weekly`

The default grid therefore produces `54` rows.

## Metrics Compared

Each row reports the same core profit metrics as the research profit backtest:

- `profitVerdict`
- `totalReturn`
- `CAGR`
- `Sharpe`
- `maxDrawdown`
- `Calmar`
- `numberOfTrades`
- `turnover`
- `winRate`
- `benchmarkRelativeReturn`
- `benchmarkRelativeMaxDrawdown`

The report also summarizes best rows by Sharpe, benchmark-relative return, and
lowest drawdown among profitable rows.

## Family Verdicts

Each family receives a deterministic verdict:

- `family_research_candidate`: at least two `research_candidate` rows, at
  least one `research_candidate` row survives `10 bps`, and average
  benchmark-relative return is positive.
- `family_fragile`: at least one `research_candidate` or `weak` row, but the
  family does not meet the research-candidate threshold.
- `family_reject`: no `research_candidate` rows and average benchmark-relative
  return is not positive.

The overall recommendation is:

- `continue_family_research` if at least one family is
  `family_research_candidate`
- `rethink_features` if only fragile families exist
- `stop_price_only_research` if all families reject

## Interpretation

A passing family is not production evidence. It only means the family deserves
the next research gate. The next required step after a family passes is a
holdout test, followed by broader universe and rebalancing validation.

Results from this workflow must not be used for live trading, production policy
tuning, or model training without those later gates.

## Example

```sh
npm run -s research:strategy-family-comparison -- \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```

If `npm` cannot find `bun`, run the equivalent local CLI:

```sh
npx tsx src/signal-engine/research/strategy-family-comparison.cli.ts \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```
