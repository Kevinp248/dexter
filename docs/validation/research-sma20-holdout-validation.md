# Research SMA20 Holdout Validation

This workflow adds a fixed time-split validation gate for the
`sma20_gap_reversion` strategy family. It follows the strategy-family comparison
run, where `sma20_gap_reversion` was the only `family_research_candidate`, but
the result still had cost sensitivity and no holdout evidence.

The purpose of this lane is to test whether the same simple family survives a
true research-window and holdout-window split before any deeper research
continues.

## Scope

This is research-only historical simulation.

- No production signal logic changes
- No model training
- No policy tuning
- No auto-trading
- No `runDailyScan` behavior changes
- No live provider calls
- Uses existing local price-feature artifacts only

## Time Split

The default split is:

- Research window: `2021-01-04` through `2024-12-31`
- Holdout window: `2025-01-01` through `2026-04-24`

The split is applied directly to the local price-feature artifact. Trades are
simulated separately inside each window, so entries and exits must exist within
the selected window.

## Strategy And Grid

The tested strategy family is:

- Family: `sma20_gap_reversion`
- Feature: `sma_20_gap`
- Rank direction: ascending
- Hold period: `20` trading days
- Rebalance frequency: weekly

The default grid is:

- `topN`: `2`, `4`, `6`
- `costBps`: `0`, `10`, `25`

This creates `9` rows in the research window and `9` rows in the holdout
window.

## Output

Each row reports:

- `windowId`
- `startDate`
- `endDate`
- `topN`
- `costBps`
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
- `profitVerdict`

The report also pairs matching `topN` and `costBps` rows across research and
holdout windows, with transitions such as `candidate_to_candidate`,
`candidate_to_reject`, and `stable_reject`.

## Verdict Rules

Final holdout verdict:

- `holdout_pass`: at least one holdout `research_candidate`, at least one
  matching `research_candidate` to holdout `research_candidate` pair, and at
  least one holdout candidate survives `10 bps`.
- `holdout_fragile`: at least one holdout `weak` or `research_candidate` row,
  but the pass rules are not met.
- `holdout_fail`: all holdout rows are `reject`.

Final recommendation:

- `continue_sma20_research` when the verdict is `holdout_pass`
- `rethink_sma20_parameters` when the verdict is `holdout_fragile`
- `stop_sma20_family` when the verdict is `holdout_fail`

## Interpretation Limits

Passing this gate is not production evidence. It is one holdout split on one
expanded universe. Results can still be regime-dependent, cost-sensitive, and
unstable under different rebalance assumptions.

No result from this workflow should be used for live trading, production policy
tuning, or model training without broader universe validation and additional
holdout checks.

## Example

```sh
npm run -s research:sma20-holdout -- \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```

If `npm` cannot find `bun`, run the equivalent local CLI:

```sh
npx tsx src/signal-engine/research/sma20-holdout-validation.cli.ts \
  --in .dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json
```
