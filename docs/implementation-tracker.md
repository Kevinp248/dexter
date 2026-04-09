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

`Phase 2A` - Deterministic validation harness and golden scenarios

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
- [ ] Add integration test harness for `runDailyScan` using mocked data.
- [ ] Add golden scenarios:
  - [ ] strong bullish -> `BUY`
  - [ ] strong bearish -> `SELL`
  - [ ] mixed/conflicted -> `HOLD`
  - [ ] short position + thesis flip -> `COVER`
- [ ] Add fixture snapshots for expected JSON output shape.
- [ ] Document how to run validation suite without Bun.

### Phase 2B - Signal calibration and explainability (Planned)
- [ ] Externalize weights/thresholds into a versioned config.
- [ ] Add change log for threshold updates (what changed and why).
- [ ] Add "why changed vs previous day" output.

### Phase 3 - Operational hardening (Planned)
- [ ] Add daily scheduler instructions/playbook.
- [ ] Add retry/fallback policy for unavailable data sources.
- [ ] Add Canadian ticker/data nuance checks.
- [ ] Add runbook for manual-trade workflow and review checklist.

## Completed Steps

1. Merged core deterministic architecture into Dexter.
2. Ported core technical/fundamental/valuation/risk logic patterns from `ai-hedge-fund`.
3. Added auditable component-level reasoning in output payload.
4. Added unit tests for deterministic action rules (`BUY/SELL/HOLD/COVER`).

## Next Steps (Ordered)

1. Implement integration test harness with mocked market/fundamental/news inputs.
2. Create 4 golden scenario fixtures and expected outputs.
3. Add npm command for integration validation.
4. Run full validation and record pass/fail in `Work Log`.

## Work Log

- 2026-04-09:
  - Completed core integration and pushed to `feature-kevin-dexter` (`6c212de`).
  - Added this tracker file to preserve continuity across context resets.
  - Next target set to `Phase 2A`.
