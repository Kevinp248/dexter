# Implementation Tracker: Dexter-First Stock Signal System

Last updated: 2026-04-10
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

`Phase 3B` - Grounded operations and supervised adaptation

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
7. Added persistent fill ledger + derived position state for carry-forward position context.
8. Added mark-to-market P&L fields in daily scan output using stored ledger cost basis.
9. Added signal-quality dashboard metrics (hit rate by action/confidence bucket).
10. Added automatic CSV export of daily alerts with fallback diagnostics.
11. Added trusted-source grounding guardrail (Tier-1 whitelist + evidence bundles).
12. Added postmortem incident engine for losses and edge-divergence cases.
13. Added calibration proposal pipeline with gated checks and manual approval apply.
14. Added a single-command operator workflow (`bun run ops:daily`).
15. Added leakage-safe trial backtest command/reporting for AAPL January workflows.

## Next Steps (Ordered)

1. Add a separate tactical decision channel (entry/exit score) so valuation drag does not dominate short-horizon swing entries.
2. Add a proposal diff preview command (current config vs runtime overrides).
3. Externalize trusted-source whitelist into a managed config file.
4. Add ticker-level postmortem severity policy (warn-only vs temporary trade block).
5. Add monthly report export combining weekly + quality + postmortem summaries.

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
- 2026-04-09:
  - Added persistent fill ledger (`fills.jsonl`) and derived positions state (`positions.json`).
  - Added `bun run trade:ledger` commands (`record`, `show`, `rebuild`) for manual/paper fills.
  - Daily scanner now auto-loads stored position context and still supports CLI overrides.
  - Added deterministic tests for cost-basis and realized-P&L math in position ledger.
- 2026-04-09:
  - Added `positionPerformance` payload with mark-to-market unrealized/realized/total P&L.
  - Wired scanner to load full stored position state for cost-basis-aware P&L.
  - Added integration regression test for P&L math and updated output snapshot baseline.
- 2026-04-09:
  - Added signal-quality dashboard command (`bun run quality:signals`).
  - Added hit-rate/avg-result metrics by action and confidence buckets.
  - Added docs and log-template update to include `Confidence` in paper-trade CSV.
  - Added regression test coverage for dashboard aggregation logic.
- 2026-04-09:
  - Added automatic scan-to-CSV logging (`--append-csv`, `bun run scan:daily:log`).
  - Added CSV exporter with fallback reason/retry columns and confidence capture.
  - Added regression test to ensure header creation + append behavior is stable.
- 2026-04-09:
  - Added de-duplication guard for auto-log rows (same `Date + Ticker` skips duplicates).
  - Kept multi-ticker same-day logging enabled for broader watchlists.
  - Added docs/examples for recording and selling multiple tickers via trade ledger.
- 2026-04-09:
  - Added `src/signal-engine/grounded-research.ts` with Tier-1 trusted-source URL guardrails and evidence bundle formatting.
  - Added `src/signal-engine/postmortem.ts` + `src/signal-engine/postmortem.cli.ts` for deterministic loss/deviation incident generation.
  - Added `src/signal-engine/calibration.ts` + `src/signal-engine/calibration.cli.ts` for proposal -> gate -> manual apply workflow.
  - Added runtime config overrides loading from `.dexter/signal-engine/config-overrides.json`.
  - Added `src/signal-engine/daily-operator.ts` + `src/signal-engine/daily-operator.cli.ts` and script `bun run ops:daily`.
- 2026-04-09:
  - Added time-aware analysis context support (as-of/start/end) to avoid future data in trial backtests.
  - Added trial backtest engine + CLI (`bun run backtest:trial`) with long-only, next-open execution policy.
  - Added JSON/CSV report artifacts under `.dexter/signal-engine/backtests/`.
  - Added deterministic tests for no-lookahead sequencing, long-only mapping, equity reconciliation, and 31-day January output.
- 2026-04-10:
  - Added external research findings note with links and implementation mapping: `docs/research-findings-aapl-reliability-2026-04-10.md`.
- 2026-04-10:
  - Added API call-budget enforcement and run-level usage reporting in financial API client (`FINANCIAL_DATASETS_MAX_CALLS_PER_RUN`, `FINANCIAL_DATASETS_MAX_CALLS_PER_ENDPOINT_PER_RUN`).
  - Added offline replay guard (`FINANCIAL_DATASETS_OFFLINE_REPLAY=1`) to fail on cache miss instead of calling paid endpoints.
  - Added AAPL-first point-in-time ML dataset builder CLI (`bun run ml:dataset`) with features, cost-aware labels, and cached provider usage.
  - Added Python sidecar evaluator script (`scripts/ml/train_eval.py`) with TimeSeriesSplit + calibrated logistic + gradient boosting and strategy evaluation outputs.
  - Added ML venv bootstrap script (`scripts/ml/setup_venv.sh`) and README usage examples.
- 2026-04-10:
  - Added `ml_sidecar` signal profile support in trial backtest (`--signal-profile ml_sidecar` + `--ml-predictions`).
  - ML profile now consumes sidecar `p_up_blend` outputs while keeping risk/cost guardrails active.
  - Ran Jan 2026 AAPL side-by-side comparison for baseline vs adaptive vs ml_sidecar.
- 2026-04-10:
  - Re-ran contiguous monthly OOS backtests for AAPL across Jan/Feb/Mar 2026 for `baseline`, `adaptive`, and `ml_sidecar`.
  - Confirmed historical-cache/API budget controls are active during backtests (`--max-api-calls 250`).
  - Published side-by-side monthly and Q1 summary in `docs/aapl-oos-jan-mar-2026.md`.
  - Result: strategy remains overly conservative (mostly `HOLD`); `adaptive` remains best current base for targeted threshold tuning.
- 2026-04-10:
  - Implemented one focused adaptive tuning pass with 3 knobs (`adaptiveBuyQuantile`, `adaptiveCommitteeBuyRelief`, `adaptiveMinExpectedEdgeAfterCostsBps`).
  - Added ai-hedge-fund-style component committee nudge for adaptive BUY gating in `src/signal-engine/backtest-trial.ts`.
  - Re-ran AAPL Jan/Feb/Mar OOS window and documented before/after in `docs/aapl-oos-jan-mar-2026.md`.
  - Outcome: Q1 loss improved (`-0.2036% -> -0.0938%`) and trade count increased (`2 -> 3`), but strategy remains not yet profitable.
- 2026-04-10:
  - Added data-completeness scoring per alert with explicit `pass/warn/fail` status and critical-missing fields.
  - Added hard `NO_SIGNAL_DATA_GAP` suppression for critical gaps (price history, fundamental metrics, valuation core inputs).
  - Added regression test coverage to ensure critical data gaps are flagged and suppressed deterministically.
- 2026-04-10:
  - Completed AAPL March 2026 trade postmortem and documented root causes in `docs/aapl-march-2026-trade-postmortem.md`.
  - Identified main issue as adaptive BUY admission while aggregate score stayed negative, plus immediate pyramiding.
  - Added next-step surgical remediation plan (buy floor, anti-pyramiding, weekend mark-to-market carry fix).
- 2026-04-10:
  - Implemented adaptive BUY floor + anti-pyramiding guardrails in `src/signal-engine/backtest-trial.ts`.
  - Added CLI flags for new adaptive controls (`--adaptive-buy-score-floor`, `--adaptive-add-score-improvement-min`).
  - Fixed weekend/non-trading mark-to-market carry in backtest daily accounting (uses last known close).
  - Validation: `typecheck` + `backtest-trial` tests pass; weekend equity carry verified on forced-position scenario.
- 2026-04-10:
  - Ran focused 2-parameter calibration sweep for adaptive guardrails (`buy_score_floor`, `add_score_improvement_min`) across Jan/Feb/Mar 2026.
  - Set calibrated default `adaptiveBuyScoreFloor` to `-0.14` (kept `adaptiveAddScoreImprovementMin=0.01`).
  - Re-ran AAPL Jan/Feb/Mar OOS: adaptive improved to `-0.0577%` with 2 trades and no pyramiding in March.
  - Updated results in `docs/aapl-oos-jan-mar-2026.md`.
- 2026-04-10:
  - Added blocker analytics module + CLI (`bun run review:blockers`) for monthly/overall HOLD blocker ranking from backtest artifacts.
  - Added blocker analytics regression test and wired it into `test:signals`.
  - Normalized NO_SIGNAL blocker strings so top-driver counts are actionable (not fragmented by numeric values).
- 2026-04-10:
  - Implemented tactical dip/rebound gate and lifecycle exits in adaptive backtest flow (stop-loss, take-profit, max-hold).
  - Added CLI overrides for tactical thresholds and lifecycle controls.
  - Calibrated tactical defaults (`tacticalZScoreMax=-0.9`) to avoid over-triggering while preserving earlier loss improvement.
  - Re-ran AAPL Jan/Feb/Mar OOS: still `-0.0577%` with 2 trades; safer behavior, but profitability remains insufficient.
