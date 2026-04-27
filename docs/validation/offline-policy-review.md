# Offline Policy Review Runbook

This workflow is for local policy diagnosis only. It does not call providers and does not change production signal behavior.

## Purpose

Use already-saved parity validation artifacts to quantify signal sparsity under:

- threshold set sensitivity (Sets A/B/C/D)
- valuation score sensitivity (`saved`, `-0.5`, `-0.25`, `0`)
- combined threshold + valuation sensitivity

This is intended to support policy review decisions before any live-policy changes.

The tool also supports offline calibration scenario evaluation from a static manifest.

## Inputs

- Directory scan: `.dexter/signal-engine/validation/*.json`
- Optional explicit files (for example `/tmp/parity-aapl-rows.json`)

The tool gracefully handles metadata-only artifacts that contain no row payloads.

## Output

A JSON report is written under `.dexter/signal-engine/validation/` with:

- per-artifact row coverage
- row payload counts and replayable row counts
- threshold replay action counts:
  - `actionCountsThresholdReplayBaseline`
  - `actionCountsByThresholdReplaySet` (Sets A/B/C/D)
- HOLD flip attribution with mutually exclusive buckets:
  - `thresholdOnly`
  - `valuationOnly`
  - `combinedOnly`
  - `noFlip`
  - `totalFlippedByAnyScenario` (`thresholdOnly + valuationOnly + combinedOnly`, equivalent to `baselineHoldRows - noFlip`)
- valuation sensitivity at Set A
- combined threshold + valuation matrix
- calibration scenario comparison (baseline vs named scenarios):
  - per-scenario action counts
  - HOLD flip attribution versus baseline
  - delta vs baseline counts
  - scenario diagnostics (reweight usage, missing component breakdown, risk-off uplift usage)

Important baseline semantics:

- `replay.*thresholdReplay*` fields are a simplified threshold-replay sensitivity baseline.
- `calibrationScenarios.baseline` is the canonical live-equivalent offline baseline in this report (includes risk-off buy uplift).

## Threshold sets used

- Set A: BUY `>= 0.50`, SELL `<= -0.45`
- Set B: BUY `>= 0.35`, SELL `<= -0.35`
- Set C: BUY `>= 0.25`, SELL `<= -0.25`
- Set D: BUY `>= 0.15`, SELL `<= -0.15`

BUY replay also keeps the current risk requirement `riskScore > 0.35`.

## Calibration scenarios

- Default manifest path: `src/signal-engine/validation/offline-calibration-scenarios.v1.json`
- Scenario intent:
  - keep calibration scenario baseline aligned to current policy
  - evaluate conservative threshold softening first
  - optionally test lighter risk-off uplift and valuation-weight rebalance
  - keep this strictly offline (no live config mutation)

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

Run with explicit scenario manifest:

```bash
npm run validation:offline-policy-review -- --scenario-manifest src/signal-engine/validation/offline-calibration-scenarios.v1.json --json
```

## Guardrails

- No provider/network/API calls
- No production signal logic changes
- No threshold or config mutation
- No backtest/walk-forward reruns
- Diagnosis/reporting only
