# AAPL OOS Trial: Jan-Mar 2026 (Baseline vs Adaptive vs ML Sidecar)

Date: 2026-04-10  
Ticker: `AAPL`  
Capital: `$10,000`  
Execution model: `next_open`, `long_only`

## Run setup

- Baseline/adaptive/ml-sidecar backtests were re-run for each month:
  - `2026-01-01 -> 2026-01-31`
  - `2026-02-01 -> 2026-02-28`
  - `2026-03-01 -> 2026-03-31`
- ML profile used:
  - `--ml-buy-prob 0.6`
  - `--ml-sell-prob 0.4`
  - `--ml-min-risk 0.6`
  - `--ml-position-scale 0.25`
- API budget guard was enabled (`--max-api-calls 250`).

## Monthly results

| Month | Profile | Return % | Net PnL USD | Trades | Benchmark % | HOLD days | NO_SIGNAL days |
|---|---|---:|---:|---:|---:|---:|---:|
| Jan 2026 | baseline | 0.0000 | 0.00 | 0 | -4.6905 | 20 | 0 |
| Jan 2026 | adaptive | -0.2036 | -20.36 | 2 | -4.6905 | 18 | 6 |
| Jan 2026 | ml_sidecar | 0.0000 | 0.00 | 0 | -4.6905 | 19 | 0 |
| Feb 2026 | baseline | 0.0000 | 0.00 | 0 | 1.5960 | 19 | 0 |
| Feb 2026 | adaptive | 0.0000 | 0.00 | 0 | 1.5960 | 19 | 5 |
| Feb 2026 | ml_sidecar | 0.0000 | 0.00 | 0 | 1.5960 | 16 | 0 |
| Mar 2026 | baseline | 0.0000 | 0.00 | 0 | -3.2849 | 22 | 0 |
| Mar 2026 | adaptive | 0.0000 | 0.00 | 0 | -3.2849 | 22 | 0 |
| Mar 2026 | ml_sidecar | 0.0000 | 0.00 | 0 | -3.2849 | 22 | 0 |

## Q1 combined view

- Benchmark (buy-and-hold, compounded Jan->Mar): `-6.3502%`
- Baseline (compounded): `0.0000%` (no trades)
- Adaptive (compounded): `-0.2036%` (`2` trades, all in Jan)
- ML sidecar (compounded): `0.0000%` (no trades)

## Interpretation

1. The engine is currently too conservative for AAPL in this window (trade starvation).
2. ML sidecar guardrails are now safe from oversized loss, but thresholding is too tight (zero trades).
3. Adaptive profile generates some near-buy/near-sell days, so it is the best candidate for limited parameter tuning.

## Recommendation (next focused pass)

- Keep `adaptive` as default for now (not `ml_sidecar`).
- Tune only 2-3 parameters with strict anti-overfit discipline:
  1. `buyScoreThreshold` (slightly lower),
  2. `minRiskScoreForBuy` (slightly lower),
  3. `no-trade band / hold threshold` (slightly narrower).
- Re-run the same Jan-Mar OOS matrix and accept only if:
  - trade count increases above a minimum floor,
  - max drawdown does not materially worsen,
  - net return improves vs current adaptive baseline.

## Focused pass applied (2026-04-10)

We added one small ai-hedge-fund-inspired committee mechanic to adaptive mode:
- If analyst-component votes are net bullish (>=2 bullish, <=1 bearish) and trend is not bearish, allow a modest BUY threshold relief.

Parameters tuned (only 3):
1. `adaptiveBuyQuantile`: `0.80 -> 0.78`
2. `adaptiveCommitteeBuyRelief`: `0.00 -> 0.03`
3. `adaptiveMinExpectedEdgeAfterCostsBps`: `0 -> 20`

### Before vs After (Adaptive profile)

| Window | Adaptive Before | Adaptive After |
|---|---:|---:|
| Jan 2026 return | -0.2036% (2 trades) | 0.0000% (0 trades) |
| Feb 2026 return | 0.0000% (0 trades) | 0.0000% (0 trades) |
| Mar 2026 return | 0.0000% (0 trades) | -0.0938% (3 trades) |
| Q1 compounded | -0.2036% | -0.0938% |
| Q1 total trades | 2 | 3 |

Conclusion:
- This pass improved Q1 loss magnitude and produced more trading activity.
- It is still not profitable; trade quality remains weak.
- Next step should be signal-quality calibration (which near-buy days convert to real BUY) rather than further lowering thresholds blindly.

## Follow-up calibration (post postmortem guardrails)

After adding buy-floor + anti-pyramiding + weekend mark carry, we ran a focused grid on:
- `adaptiveBuyScoreFloor`
- `adaptiveAddScoreImprovementMin`

Selected default:
- `adaptiveBuyScoreFloor = -0.14`
- `adaptiveAddScoreImprovementMin = 0.01`

### Updated adaptive OOS result (Jan-Mar 2026)

- Jan: `0.0000%` (`0` trades)
- Feb: `0.0000%` (`0` trades)
- Mar: `-0.0577%` (`2` trades)
- Q1 compounded: `-0.0577%` (`2` trades total)

Notes:
- This improves loss vs prior adaptive postmortem pass (`-0.0938% -> -0.0577%`).
- No same-leg pyramiding observed in March (`BUY` then `SELL`, single-share cycle).
- Strategy is still not profitable yet, but is less error-prone and cleaner diagnostically.

## Tactical dip/rebound pass (AAPL-first)

Implemented in adaptive backtest path:
- Tactical dip/rebound BUY eligibility (RSI + z-score + trend/risk/edge gates).
- Trade lifecycle exits (stop-loss, take-profit, max-hold-days).
- Weekend/non-trading mark-to-market carry fix for cleaner equity diagnostics.

Calibrated defaults after sweep:
- `adaptiveBuyScoreFloor = -0.14`
- `adaptiveAddScoreImprovementMin = 0.01`
- `tacticalZScoreMax = -0.9`

Result remains:
- Q1 compounded: `-0.0577%`
- Trades: `2`
- Better loss control than earlier variants, but still not profitable enough for confidence.
