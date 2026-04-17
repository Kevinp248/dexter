# Offline Policy Review Runbook

This workflow is for local policy diagnosis only. It does not call providers and does not change production signal behavior.

## Purpose

Use already-saved parity validation artifacts to quantify signal sparsity under:

- threshold set sensitivity (Sets A/B/C/D)
- valuation score sensitivity (`saved`, `-0.5`, `-0.25`, `0`)
- combined threshold + valuation sensitivity

This is intended to support policy review decisions before any live-policy changes.

## Inputs

- Directory scan: `.dexter/signal-engine/validation/*.json`
- Optional explicit files (for example `/tmp/parity-aapl-rows.json`)

The tool gracefully handles metadata-only artifacts that contain no row payloads.

## Output

A JSON report is written under `.dexter/signal-engine/validation/` with:

- per-artifact row coverage
- row payload counts and replayable row counts
- action counts under current thresholds
- action counts under Sets A/B/C/D
- HOLD flip attribution with mutually exclusive buckets:
  - `thresholdOnly`
  - `valuationOnly`
  - `combinedOnly`
  - `noFlip`
  - `totalFlippedByAnyScenario` (`thresholdOnly + valuationOnly + combinedOnly`, equivalent to `baselineHoldRows - noFlip`)
- valuation sensitivity at Set A
- combined threshold + valuation matrix

## Threshold sets used

- Set A: BUY `>= 0.50`, SELL `<= -0.45`
- Set B: BUY `>= 0.35`, SELL `<= -0.35`
- Set C: BUY `>= 0.25`, SELL `<= -0.25`
- Set D: BUY `>= 0.15`, SELL `<= -0.15`

BUY replay also keeps the current risk requirement `riskScore > 0.35`.

## Commands

Run with default directory scan:

```bash
npm run validation:offline-policy-review
```

Run with explicit files and stdout JSON:

```bash
npm run validation:offline-policy-review -- --file /tmp/parity-aapl-rows.json --json
```

Run with mixed directory + extra file:

```bash
npm run validation:offline-policy-review -- --dir .dexter/signal-engine/validation --extra-file /tmp/parity-aapl-rows.json
```

## Guardrails

- No provider/network/API calls
- No production signal logic changes
- No threshold or config mutation
- No backtest/walk-forward reruns
- Diagnosis/reporting only
