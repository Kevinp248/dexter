# Walk-Forward Validation Design (Purged + Embargo)

Last updated: 2026-04-09

## Goal

Define deterministic split policy for backtests so we reduce data leakage risk before trusting live daily alerts.

## Policy

- Time-ordered folds only (no random shuffle).
- Expanding train window.
- Purge gap between train and test windows.
- Embargo gap between consecutive test windows.

This policy is implemented in:
- `src/signal-engine/validation/walk-forward.ts`

## Core functions

- `buildPurgedWalkForwardFolds(dates, config)`
  - Inputs: ordered date array and split config.
  - Output: folds with `trainIndices`, `purgeIndices`, `testIndices`, `embargoIndices`.
- `validatePurgedWalkForwardFolds(folds)`
  - Returns leakage sanity status and issues list.

## Config knobs

- `initialTrainSize`: bars in first training window.
- `testSize`: bars in each test window.
- `stepSize`: how much the test window advances each fold.
- `purgeSize`: bars removed between train and test.
- `embargoSize`: bars reserved after each test window before next test starts.
- `maxFolds`: cap fold count.

## Test coverage

- `src/signal-engine/__tests__/walk-forward.test.ts`
  - Purge and embargo spacing.
  - Insufficient data behavior.
  - `maxFolds` cap.
  - Valid split sanity.
  - Invalid config guardrails.

Run:

```bash
npm run test:walkforward
```
