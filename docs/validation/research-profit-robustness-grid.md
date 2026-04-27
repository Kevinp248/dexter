# Research Profit Robustness Grid

## Purpose

This workflow stress tests a profitable-looking research strategy across simple parameter changes.

The first profit backtest smoke run found one candidate, `sma20_gap_reversion_20d`. This grid asks whether that result survives changes to holding period, basket size, and transaction costs.

## Scope

- Research-only.
- Historical simulation only.
- Consumes existing local `price_features_and_forward_labels` artifacts.
- Does not fetch data.
- Does not train a model.
- Does not tune policy.
- Does not alter production signal logic.
- Does not change `runDailyScan`.
- Does not imply live-trading readiness.

## Grid

V1 runs only the `sma20_gap_reversion` strategy family:

- feature: `sma_20_gap`
- rank direction: ascending
- rebalance frequency: weekly by default

Default grid:

- `holdDays`: `5,10,20,40`
- `topN`: `1,2,3,4`
- `costBps`: `0,10,25,50`
- `rebalanceFrequency`: `weekly`

Optional CLI overrides can narrow or expand the grid, including `--rebalance daily,weekly`.

## Output

Each row reports:

- strategy id
- hold days
- topN
- cost bps
- rebalance frequency
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

The summary reports:

- total grid rows
- count by profit verdict
- best row by Sharpe
- best row by benchmark-relative return
- lowest-drawdown profitable row
- average result by holdDays
- average result by topN
- average result by costBps
- final robustness verdict

## Robustness Verdict

V1 verdicts:

- `robust_candidate`: at least 25% of grid rows are `research_candidate`, at least one candidate survives 25 bps or 50 bps costs, and the best Sharpe row is not only `topN=1`.
- `fragile_candidate`: at least one `research_candidate` exists, but the result depends heavily on a parameter.
- `reject_candidate`: no `research_candidate` rows exist.

These are research triage labels, not trading recommendations.

## CLI Usage

```bash
npm run research:profit-robustness -- \
  --in .dexter/signal-engine/research/price-features/price-features-first-multiticker-2026-04-26.json
```

Optional flags:

- `--out <path>`
- `--hold-days <csv>`
- `--top-ns <csv>`
- `--cost-bps <csv>`
- `--rebalance daily|weekly|daily,weekly`
- `--initial-capital <number>`
- `--min-trades <number>`
- `--json`

## Interpretation Guardrails

Passing this grid is not enough for production.

The next required research step is a larger universe and separate holdout periods. Do not train a model, tune production policy, or make trading decisions unless evidence survives broader universe testing and holdout validation.
