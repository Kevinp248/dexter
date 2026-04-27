# Expanded-Universe Profit Test

This note preserves the first expanded-universe profit test for the research-only
`sma20_gap_reversion` strategy family. The goal was to check whether the earlier
8-ticker result survived a broader, sector-balanced universe before considering
any deeper research gates.

This is descriptive research only. It does not change production signal logic,
train a model, tune policy, enable auto-trading, change `runDailyScan`, or use
live paid provider APIs.

## Universe And Date Range

The run used 31 liquid US tickers:

`AAPL, MSFT, GOOGL, AMZN, NVDA, META, JPM, BAC, GS, V, MA, XOM, CVX, UNH, JNJ, MRK, ABBV, PG, KO, PEP, COST, WMT, HD, MCD, NKE, CAT, GE, HON, AVGO, ORCL, CRM`

Date range:

- Start: `2021-01-01`
- End: `2026-04-24`

The end date was selected because `2026-04-26` was a Sunday, making
`2026-04-24` the last completed regular US market session.

## Artifact Paths

- Raw Yahoo history:
  `.dexter/signal-engine/research/yahoo/raw/yahoo-history-expanded-universe-2026-04-26.json`
- Normalized Yahoo history:
  `.dexter/signal-engine/research/yahoo/normalized/yahoo-normalized-expanded-universe-2026-04-26.json`
- Price features:
  `.dexter/signal-engine/research/price-features/price-features-expanded-universe-2026-04-26.json`
- Profit backtest:
  `.dexter/signal-engine/research/analysis/profit-backtest-expanded-universe-2026-04-26.json`
- Robustness grid:
  `.dexter/signal-engine/research/analysis/profit-robustness-grid-expanded-universe-2026-04-26.json`

## Artifact Health

The expanded universe data was structurally healthy:

- Tickers: `31`
- Total rows: `41,323`
- Rows per ticker: `1,333`
- First date: `2021-01-04`
- Last date: `2026-04-24`
- Adjusted-close coverage: full for every ticker
- Yahoo normalized warnings: `0`
- Price-feature warnings: `0`

Usable label coverage was consistent across tickers:

- `5d`: `1,328` usable labels per ticker
- `20d`: `1,313` usable labels per ticker

Feature null counts matched expected warmup windows:

- `ret_1d`: `31`
- `ret_5d`: `155`
- `ret_20d`: `620`
- `sma_20_gap`: `589`
- `sma_50_gap`: `1,519`
- `vol_20d`: `620`
- `drawdown_252d`: `7,781`
- `range_pct`: `0`

## Profit Backtest Summary

| Strategy | Verdict | Total Return | CAGR | Sharpe | Max Drawdown | Calmar | Trades | Turnover | Win Rate | Benchmark Relative Return | Benchmark Relative Max Drawdown |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `equal_weight_buy_hold` | `research_candidate` | `2.0244` | `0.2329` | `1.3216` | `-0.2117` | `1.1004` | `31` | `4.0264` | `0.9355` | `0.0000` | `0.0000` |
| `drawdown_reversal_20d` | `reject` | `0.0279` | `0.0052` | `0.1716` | `-0.4600` | `0.0114` | `102` | `109.5925` | `0.4608` | `-1.9964` | `-0.2483` |
| `ret_1d_reversal_5d` | `reject` | `-0.0231` | `-0.0044` | `0.1220` | `-0.4387` | `-0.0101` | `442` | `418.7084` | `0.4932` | `-2.0475` | `-0.2270` |
| `sma20_gap_reversion_20d` | `reject` | `1.9342` | `0.2259` | `0.8786` | `-0.2549` | `0.8862` | `124` | `236.7221` | `0.5161` | `-0.0902` | `-0.0432` |

The default `sma20_gap_reversion_20d` result degraded from the original
8-ticker `research_candidate` result to `reject` in the expanded universe.
Equal-weight buy-and-hold beat the default strategy on total return, Sharpe, and
max drawdown.

## Robustness Grid Summary

The robustness grid tested `sma20_gap_reversion` across hold period, `topN`, and
cost assumptions.

- Total grid rows: `64`
- `reject`: `52`
- `weak`: `11`
- `research_candidate`: `1`
- `expand_universe`: `0`
- Final robustness verdict: `fragile_candidate`

The only `research_candidate` row required:

- `holdDays: 20`
- `topN: 4`
- `costBps: 0`
- `rebalanceFrequency: weekly`
- `totalReturn: 3.2420`
- `CAGR: 0.3144`
- `Sharpe: 1.3686`
- `maxDrawdown: -0.1847`
- `Calmar: 1.7025`
- `numberOfTrades: 248`
- `turnover: 296.5259`
- `winRate: 0.5927`
- `benchmarkRelativeReturn: 1.2115`
- `profitVerdict: research_candidate`

No row survived `25 bps` or `50 bps` costs as `research_candidate`.

## Concentration Notes

For default `sma20_gap_reversion_20d`, the strategy held exactly two names per
rebalance. NVDA remained a meaningful contributor, but non-tech names also
appeared in the selected trades.

Top approximate PnL contributors:

- `NVDA`: 7 trades, about `+75.8k`
- `AVGO`: 4 trades, about `+39.8k`
- `GS`: 2 trades, about `+30.5k`
- `PEP`: 4 trades, about `+25.8k`
- `AAPL`: 5 trades, about `+24.2k`

Worst approximate contributors:

- `NKE`: 11 trades, about `-41.6k`
- `ORCL`: 3 trades, about `-25.2k`
- `BAC`: 4 trades, about `-13.7k`

Technology and growth-platform names contributed more profit than non-tech
names, but the expanded run was not exclusively driven by NVDA or GOOGL. GOOGL
did not appear among the default strategy trades.

## Interpretation

The expanded 31-ticker data was healthy, but the strategy result did not
generalize cleanly. The default `sma20_gap_reversion_20d` strategy was rejected,
equal-weight buy-and-hold beat it, and the robustness grid remained fragile.

The only surviving grid candidate depended on `holdDays=20`, `topN=4`, and
`0 bps` costs. That is too parameter-sensitive to support training, production
tuning, or live trading. The result is useful because it shows the original
8-ticker signal was likely too dependent on a small large-cap and growth-heavy
sample.

## Scope Guardrails

- No production signal logic changes
- No model training
- No policy tuning
- No auto-trading
- No `runDailyScan` behavior changes
- No live provider changes
- Historical simulation only

## Final Recommendation

`expanded_universe_fragile_rethink_strategy_before_training`
