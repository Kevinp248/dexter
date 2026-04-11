# Parity Gap Analysis (AAPL Q1 2025)

Date: 2026-04-11

## What we verified

We implemented an exact vectorized parity runner matching the Claude-style methodology:
- warmup history before test window,
- signal shifted by one bar (`pos = signal.shift(1)`),
- net return = `pos * daily_return - turnover * commission`.

Command:
```bash
npx tsx src/signal-engine/vectorized-parity.cli.ts --ticker AAPL --start 2025-01-01 --end 2025-03-31 --capital 10000
```

Output: `.dexter/signal-engine/reports/vectorized-parity-AAPL-2025-01-01-2025-03-31.json`

## Key result

The parity runner reproduces the expected benchmark-level behavior:

| Strategy | Return | Sharpe | Max DD | Trades | Win Rate |
|---|---:|---:|---:|---:|---:|
| MACD Crossover | 5.03% | 0.71 | -11.93% | 4 | 50% |
| EMA Crossover | 0.67% | 0.08 | -12.58% | 4 | 50% |
| RSI Mean Reversion | -1.57% | -0.479 | -8.92% | 10 | 10% |
| Bollinger Bands | -7.26% | -3.271 | -8.82% | 10 | 20% |
| Stochastic | -11.27% | -2.148 | -12.96% | 27 | 25.9% |
| Ensemble | -0.94% | -0.16 | -11.28% | 16 | 25% |

## Why earlier runs diverged

1. Earlier event-driven backtest logic is not the same as vectorized parity math.
2. Earlier implementation computed indicators inside the test window only (missing warmup context).
3. Additional guardrails/position logic changed trade timing and trade count.

## Practical decision

- Use **vectorized parity** for strategy-comparison and baseline replication.
- Use **event-driven backtest** for execution realism and risk controls.
- Compare both explicitly before tuning parameters to avoid false negatives.

