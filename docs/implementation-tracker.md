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

`Phase 3` - Operational hardening

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
- [x] Add golden scenarios:
  - [x] strong bullish -> `BUY`
  - [x] strong bearish -> `SELL`
  - [x] mixed/conflicted -> `HOLD`
  - [x] short position + thesis flip -> `COVER`
- [x] Add fixture snapshots for expected JSON output shape.
- [x] Document how to run validation suite without Bun.

### Phase 2B - Signal calibration and explainability (Planned)
- [x] Externalize weights/thresholds into a versioned config.
- [x] Add change log for threshold updates (what changed and why).
- [x] Add "why changed vs previous day" output.

### Phase 3 - Operational hardening (Planned)
- [x] Add daily scheduler instructions/playbook.
- [x] Add retry/fallback policy for unavailable data sources.
- [x] Add Canadian ticker/data nuance checks.
- [x] Add runbook for manual-trade workflow and review checklist.

### Phase 3A - Execution realism (In Progress)
- [x] Add transaction cost model (spread + slippage + fees + borrow proxy).
- [x] Add portfolio guardrails (gross exposure + sector exposure caps).
- [x] Add alert-level execution plan fields (shares, notional, cost-adjusted edge).
- [x] Add action downgrade to `HOLD` when costs/constraints invalidate trade.
- [x] Add regression test for cost-based downgrade behavior.
- [x] Start walk-forward validation design (purged/embargo style split policy).
- [x] Add weekly performance review script/checklist tied to paper-trade log.

## Completed Steps

1. Merged core deterministic architecture into Dexter.
2. Ported core technical/fundamental/valuation/risk logic patterns from `ai-hedge-fund`.
3. Added auditable component-level reasoning in output payload.
4. Added unit tests for deterministic action rules (`BUY/SELL/HOLD/COVER`).
5. Added execution-cost realism + portfolio-level exposure guardrails.
6. Added walk-forward split policy utilities with purged/embargo-aware fold generation + validation tests.

## Next Steps (Ordered)

1. Add alert-quality dashboard metrics (hit rate by action/confidence bucket).
2. Add CSV export for daily signals + fallback diagnostics.
3. Add a simple CLI/report wrapper that prints walk-forward folds for a date range.
4. Add monthly calibration memo template using weekly review output.

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
- 2026-04-09:
  - Added deterministic snapshot fixture test for full `runDailyScan` output shape.
  - Added multi-ticker correlation regression case (expect correlation multiplier = 0.7).
  - Added explicit cost-stress downgrade regression (`BUY` -> `HOLD`) with execution overrides.
  - Added execution stress CLI flags (`--cost-multiplier`, `--min-edge-bps`).
  - Validation status: `typecheck` pass, `npm run test:signals` pass (2 suites, 13 tests, 1 snapshot).
- 2026-04-09:
  - Externalized major strategy constants into versioned config (`src/signal-engine/config.ts`, v1.0.0).
  - Refactored signal rules, execution model, risk model, and technical/fundamental/valuation analyzers to consume config.
  - Added parameter change log (`docs/parameter-changelog.md`) and README references.
  - Validation status: `typecheck` pass, `npm run test:signals` pass (2 suites, 13 tests, 1 snapshot).
- 2026-04-09:
  - Added previous-scan delta explanations per ticker (`delta` in signal payload).
  - Added scan history persistence at `.dexter/signal-engine/last-scan.json`.
  - Added regression test for delta behavior and updated snapshot baseline.
  - Validation status: `typecheck` pass, `npm run test:signals` pass (2 suites, 14 tests, 1 snapshot).
- 2026-04-09:
  - Added main operator guide in plain English (`docs/START-HERE-SIGNAL-GUIDE.md`).
  - Included backtest-first workflow, scheduler examples, and manual trade checklist.
  - Linked README to this guide and marked it as the primary human runbook.
- 2026-04-09:
  - Added paper-trade log template (`docs/paper-trade-log-template.md`) and linked it in the operator guide.
- 2026-04-09:
  - Added Canadian market nuance checks (exchange + liquidity gate) with downgrade-to-`HOLD` behavior.
  - Added `regionalMarketCheck` to payload and regression coverage for CA low-liquidity case.
  - Updated snapshot baseline and operator docs with CA-specific review guidance.
  - Validation status: `typecheck` pass, `npm run test:signals` pass (2 suites, 15 tests, 1 snapshot).
- 2026-04-09:
  - Added retry-with-backoff policy for core components (3 attempts before fallback).
  - Added `fallbackPolicy` payload section with reason + retry suggestion.
  - Added regression test verifying fallback reason and retry guidance when component fails.
  - Updated operator docs to require fallback review before acting.
  - Validation status: `typecheck` pass, `npm run test:signals` pass (2 suites, 16 tests, 1 snapshot).
- 2026-04-09:
  - Added walk-forward validation design utilities (`buildPurgedWalkForwardFolds`, `validatePurgedWalkForwardFolds`).
  - Added deterministic split tests (purge/embargo spacing, max folds, invalid config guardrails).
  - Added `npm run test:walkforward` and included walk-forward tests in `npm run test:signals`.
- 2026-04-09:
  - Added weekly review script (`bun run review:weekly`) tied to paper-trade CSV log.
  - Added deterministic parser/summary logic for win rate, avg/median result, fallback hygiene, and override discipline.
  - Added weekly review tests and included them in `npm run test:signals`.
  - Added weekly review runbook docs and expanded paper-trade template with fallback retry columns.
