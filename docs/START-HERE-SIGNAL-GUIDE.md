# Start Here: Stock Signal Operator Guide (Plain English)

Last updated: 2026-04-09
Audience: Human operator (manual trading workflow)

This is the **main guide** to run the strategy safely.

If commands, thresholds, or workflow change, update this file in the same PR.

## 1) What this system does

- Scans US/CA stocks and returns deterministic alerts:
  - `BUY`
  - `SELL`
  - `HOLD`
  - `COVER`
- Uses technical + fundamentals + valuation + sentiment + risk.
- Applies execution realism (cost checks) and portfolio guardrails.
- You place trades manually.

## 2) Daily workflow (in order)

1. Run the backtest/validation gate.
2. Run the signal scan.
3. Review deltas and risk notes.
4. Decide manually whether to execute.
5. Log your action for later review.

Do not skip step 1.

## 3) Step 1: Backtest/validation gate (required)

This repo currently uses a deterministic regression gate as the pre-trade quality check.

```bash
npm run typecheck
npm run test:signals
```

Pass criteria:
- Typecheck passes.
- Signal tests pass (golden scenarios + snapshot).

If either fails, do not trust fresh signals until fixed.

## 4) Step 2: Generate today’s signals

Default watchlist:
```bash
bun run scan:daily
```

Specific tickers:
```bash
bun run scan:daily --tickers AAPL,SHOP,TD
```

With current position context:
```bash
bun run scan:daily --tickers NVDA --position NVDA:short:120
```

With portfolio guardrails:
```bash
bun run scan:daily \
  --tickers AAPL,MSFT \
  --portfolio-value 150000 \
  --gross-exposure 0.78 \
  --max-gross 1.00 \
  --sector-exposure Technology:0.25,Financials:0.10 \
  --max-sector 0.35
```

## 5) Step 3: Read the output correctly

For each ticker:
- `action`: raw model action before execution filters.
- `finalAction`: final executable suggestion after cost + guardrails.
- `delta`: what changed vs previous scan (main explainability field).
- `executionPlan.costEstimate`: whether expected edge survives costs.
- `executionPlan.constraints`: whether portfolio caps block the trade.

Rule: use `finalAction` for manual decisions, not `action`.

## 6) Scan history and "why changed"

- Last scan is stored at:
  - `.dexter/signal-engine/last-scan.json`
- Next run compares against previous and populates `delta`.

If `delta.topDrivers` is unclear, treat the signal as low conviction and review before acting.

## 7) Scheduling (recommended)

Daily post-close run (example cron):
```bash
0 17 * * 1-5 cd /path/to/dexter && bun run scan:daily >> .dexter/signal-engine/daily.log 2>&1
```

Pre-open sanity run (example cron):
```bash
30 8 * * 1-5 cd /path/to/dexter && bun run scan:daily --tickers AAPL,MSFT,NVDA >> .dexter/signal-engine/preopen.log 2>&1
```

## 8) Manual trade checklist

Before placing a trade:
1. Confirm `finalAction` is not downgraded to `HOLD`.
2. Confirm `executionPlan.costEstimate.isTradeableAfterCosts` is `true`.
3. Confirm `executionPlan.constraints.isAllowed` is `true`.
4. Confirm no concentration warning in `reasoning.risk.checks`.
5. Confirm you understand `delta.topDrivers`.

After decision, log it in:
- `docs/paper-trade-log-template.md`

## 9) If you change strategy parameters

When editing `src/signal-engine/config.ts`:
1. Update `docs/parameter-changelog.md`.
2. Run:
   - `npm run typecheck`
   - `npm run test:signals`
3. If snapshot changes are intentional, update snapshots and note why.
4. Update this guide if commands/behavior changed.

## 10) Related docs

- Core logic mapping:
  - `docs/core-logic-integration.md`
- Parameter changelog:
  - `docs/parameter-changelog.md`
- Progress tracker:
  - `docs/implementation-tracker.md`
- Paper trade log template:
  - `docs/paper-trade-log-template.md`
