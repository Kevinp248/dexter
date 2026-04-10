# AAPL March 2026 Trade Postmortem (Adaptive Profile)

Date: 2026-04-10  
Window: `2026-03-01 -> 2026-03-31`  
Profile: `adaptive`  
Capital: `$10,000`

## What happened

- Executions:
  - `2026-03-05` BUY 1 @ `260.79`
  - `2026-03-06` BUY 1 @ `258.63`
  - `2026-03-09` SELL 2 @ `255.69`
- Trade result:
  - Average entry: `259.71`
  - Average exit: `255.69`
  - Gross PnL: `-8.04`
  - Fees: `1.34`
  - Net PnL: `-9.38`

## Root-cause findings

1. **Entry quality issue (primary)**
   - BUY signals were issued while aggregate score stayed negative (`~ -0.12`).
   - This came from adaptive thresholding + committee relief allowing buys in a weak regime.

2. **Pyramiding issue (secondary)**
   - The system added a second BUY on the next day before thesis confirmation.
   - Position size doubled during continued weakness, amplifying loss.

3. **Exit timing was reasonable, but late relative to entry**
   - SELL occurred as score moved further bearish.
   - Loss was mostly caused by poor initial entries, not missed exits.

4. **Metric artifact to fix**
   - On non-trading days, position value is carried as `0` in backtest daily rows, which inflates drawdown noise.
   - This distorts diagnostics and should be corrected in the backtest accounting layer.

## Decision

- Do **not** loosen thresholds further without guardrails.
- Next surgical fix should target **bad BUY admission** and **double-entry prevention**, not broader aggressiveness.

## Proposed surgical changes (next pass)

1. Add adaptive BUY gate:
   - Block BUY when aggregate score is below a safety floor (example: `< -0.05`), even if committee relief is active.
2. Add anti-pyramiding rule:
   - If already long, only allow add-on BUY when score has improved vs prior day and trend is not bearish.
3. Fix backtest weekend mark-to-market carry:
   - Carry last tradable close on market-closed days for realistic equity/drawdown reporting.
