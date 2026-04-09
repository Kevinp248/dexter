# Implementation Tracker: Dexter-First Stock Signal System

Last updated: 2026-04-09
Owner: Codex + Kevin
Branch: `feature-kevin-dexter`

## How to use this file

1. This is the single source of truth for progress.
2. At the end of every work session, update:
   - `Current Phase`
   - `Completed Steps`
   - `Next Steps (Ordered)`
   - `Work Log`
3. Never delete old log entries; append new ones.

## Current Phase

`Phase 3A` - Execution realism and portfolio guardrails

## Phase Plan (Ordered)

### Phase 1 - Core integration baseline (Done)
- [x] Build deterministic signal engine skeleton in Dexter.
- [x] Add US/CA watchlist support.
- [x] Add technical, fundamentals, sentiment, and risk modules.
- [x] Add valuation analysis module.
- [x] Add position-aware action rules with `COVER`.
- [x] Add scanner CLI flags (`--tickers`, `--position`).
- [x] Add core logic mapping doc.

### Phase 2A - Deterministic validation harness (In Progress)
- [x] Add integration test harness for `runDailyScan` using mocked data.
- [ ] Add golden scenarios:
  - [x] strong bullish -> `BUY`
  - [x] strong bearish -> `SELL`
  - [x] mixed/conflicted -> `HOLD`
  - [x] short position + thesis flip -> `COVER`
- [ ] Add fixture snapshots for expected JSON output shape.
- [x] Document how to run validation suite without Bun.

### Phase 2B - Signal calibration and explainability (Planned)
- [ ] Externalize weights/thresholds into a versioned config.
- [ ] Add change log for threshold updates (what changed and why).
- [ ] Add "why changed vs previous day" output.

### Phase 3 - Operational hardening (Planned)
- [ ] Add daily scheduler instructions/playbook.
- [ ] Add retry/fallback policy for unavailable data sources.
- [ ] Add Canadian ticker/data nuance checks.
- [ ] Add runbook for manual-trade workflow and review checklist.

### Phase 3A - Execution realism (In Progress)
- [x] Add transaction cost model (spread + slippage + fees + borrow proxy).
- [x] Add portfolio guardrails (gross exposure + sector exposure caps).
- [x] Add alert-level execution plan fields (shares, notional, cost-adjusted edge).
- [x] Add action downgrade to `HOLD` when costs/constraints invalidate trade.
- [ ] Add regression test for cost-based downgrade behavior.

## Completed Steps

1. Merged core deterministic architecture into Dexter.
2. Ported core technical/fundamental/valuation/risk logic patterns from `ai-hedge-fund`.
3. Added auditable component-level reasoning in output payload.
4. Added unit tests for deterministic action rules (`BUY/SELL/HOLD/COVER`).
5. Added execution-cost realism + portfolio-level exposure guardrails.

## Next Steps (Ordered)

1. Add snapshot-style fixture test for full JSON output shape from `runDailyScan`.
2. Add multi-ticker correlation regression case in risk scoring.
3. Add cost-model regression case that downgrades trade to `HOLD`.
4. Begin Phase 2B config externalization (weights/thresholds file).

## Work Log

- 2026-04-09:
  - Completed core integration and pushed to `feature-kevin-dexter` (`6c212de`).
  - Added this tracker file to preserve continuity across context resets.
  - Next target set to `Phase 2A`.
- 2026-04-09:
  - Implemented `runDailyScan` integration harness via provider injection.
  - Added 4 deterministic golden scenario tests (`BUY/SELL/HOLD/COVER`).
  - Added `npm run test:signals` and README validation command.
  - Validation status: `typecheck` pass, `npx jest` pass, `npm run test:signals` pass (2 suites, 9 tests).
- 2026-04-09:
  - Added transaction-cost model and portfolio-constraint engine to signal output.
  - Added execution plan fields and final action downgrade logic (`action` vs `finalAction`).
  - Added integration test for gross-exposure cap forcing `BUY` -> `HOLD`.
  - Added CLI flags for portfolio context (`--portfolio-value`, `--gross-exposure`, `--max-gross`, `--sector-exposure`, `--max-sector`).
  - Validation status: `typecheck` pass, `npm run test:signals` pass (2 suites, 10 tests).
