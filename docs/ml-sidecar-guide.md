# ML Sidecar Guide (AAPL-first)

## Purpose

Use a lightweight Python sidecar for probability modeling while keeping Dexter's deterministic guardrails in place.

## 1) Build dataset (point-in-time, cost-aware labels)

```bash
bun run ml:dataset --ticker AAPL --start 2024-01-01 --end 2026-01-31 --max-api-calls 250
```

Outputs:
- `.dexter/signal-engine/datasets/ml-dataset-<ticker>-<start>-<end>.csv`
- `.dexter/signal-engine/datasets/ml-dataset-<ticker>-<start>-<end>.json`
- `.dexter/signal-engine/reports/api-usage-<label>.json`

## 2) Prepare Python env

```bash
scripts/ml/setup_venv.sh
source .venv-ml/bin/activate
```

## 3) Run sidecar evaluator

```bash
bun run ml:sidecar --dataset .dexter/signal-engine/datasets/ml-dataset-AAPL-2024-01-01-2026-01-31.csv --target 1d --python .venv-ml/bin/python
```

Outputs:
- `.dexter/signal-engine/ml/predictions-*.csv`
- `.dexter/signal-engine/ml/summary-*.json`

## 4) Cost-protection modes

- Limit requests:
  - `--max-api-calls 200` on dataset/backtest commands.
- Cache-only replay:
  - add `--offline-replay` to fail on any uncached request.
