# Research Cleanup Audit

Audit date: 2026-04-26

This audit reviews the research-only code, scripts, tests, and validation docs
added during the Phase 4-6 research work. It does not remove files, change
strategy behavior, alter production signal logic, train models, tune policy,
fetch data, or create live-trading readiness.

Current research state:

- `sma20_gap_reversion` did not pass holdout as a `research_candidate`.
- The SMA20 holdout verdict was `holdout_fragile`.
- The regime/risk diagnostic verdict was `risk_filter_needed`.
- The next research direction is `test_risk_controls_next`.
- No current result is production, training, policy, or live-trading evidence.

## Script Inventory

| Script | Target | Status | Recommendation |
| --- | --- | --- | --- |
| `research:yahoo:fetch` | `src/signal-engine/research/yahoo-history.cli.ts` | Exists | Keep. Foundational Yahoo research lane. |
| `research:yahoo:normalize` | `src/signal-engine/research/yahoo-history.cli.ts` | Exists | Keep for now. Clarify later that this is an alias/path through the same CLI. |
| `research:price-features` | `src/signal-engine/research/price-feature-labels.cli.ts` | Exists | Keep. Foundational feature/label artifact builder. |
| `research:multiticker-separation` | `src/signal-engine/research/multiticker-separation-analysis.cli.ts` | Exists | Keep. Reusable descriptive separation analysis. |
| `research:multiticker-evidence` | `src/signal-engine/research/multiticker-evidence-report.cli.ts` | Exists | Keep. Useful gate before profit testing or training discussions. |
| `research:profit-backtest` | `src/signal-engine/research/profit-backtest.cli.ts` | Exists | Keep. Reusable portfolio-level research lane. |
| `research:profit-robustness` | `src/signal-engine/research/profit-robustness-grid.cli.ts` | Exists | Keep. Reusable parameter stress-test lane. |
| `research:strategy-family-comparison` | `src/signal-engine/research/strategy-family-comparison.cli.ts` | Exists | Keep. Useful for broad family triage after a candidate weakens. |
| `research:sma20-holdout` | `src/signal-engine/research/sma20-holdout-validation.cli.ts` | Exists | Keep as a historical gate and reusable holdout pattern. |
| `research:sma20-regime-risk` | `src/signal-engine/research/sma20-regime-risk-diagnostic.cli.ts` | Exists | Keep. Current diagnostic lane for risk-control hypotheses. |

No research script currently points to a missing file. No script should be
removed in the next PR. The only clarity issue is that `research:yahoo:fetch`
and `research:yahoo:normalize` share one CLI target.

## Research Module Inventory

| Module or CLI | Role | Recommendation |
| --- | --- | --- |
| `yahoo-history-fetch.ts` | Yahoo chart fetch helper for research artifacts | Keep as reusable infrastructure. |
| `yahoo-normalize.ts` | Normalizes Yahoo rows into the research artifact format | Keep as reusable infrastructure. |
| `yahoo-history.cli.ts` | Fetch/normalize command surface | Keep; consider clearer help text for fetch-only vs normalize paths. |
| `price-feature-labels.ts` and CLI | Builds price features and forward labels | Keep as foundational input to later lanes. |
| `multiticker-separation-analysis.ts` and CLI | Quantile separation by feature/horizon/ticker | Keep as descriptive evidence infrastructure. |
| `multiticker-evidence-report.ts` and CLI | Deterministic evidence classification | Keep as a pre-training gate. |
| `profit-backtest.ts` and CLI | Long-only historical profit simulation | Keep as reusable research infrastructure. |
| `profit-robustness-grid.ts` and CLI | Parameter robustness runner for SMA20 | Keep as reusable pattern; currently historical for SMA20. |
| `strategy-family-comparison.ts` and CLI | Compares simple price-only families | Keep as current family-selection infrastructure. |
| `sma20-holdout-validation.ts` and CLI | Research/holdout split for SMA20 | Keep as historical result and reusable holdout gate. |
| `sma20-regime-risk-diagnostic.ts` and CLI | Diagnoses SMA20 failure modes | Keep as current risk-control diagnostic. |

Nothing is clearly dead or broken. Some SMA20-specific modules are historical
for the current strategy result, but they remain useful examples and gates for
future candidates. Do not delete them yet.

## Validation Docs Inventory

| Doc | Status | Recommendation |
| --- | --- | --- |
| `research-yahoo-lane.md` | Current infrastructure doc | Keep. |
| `research-price-feature-label-lane.md` | Current infrastructure doc | Keep. |
| `research-multiticker-price-separation.md` | Historical/current descriptive evidence doc | Keep. |
| `research-profit-backtest.md` | Historical/current profit-simulation doc | Keep; archive later only if docs become too noisy. |
| `research-profit-robustness-grid.md` | Historical robustness doc for first SMA20 candidate | Keep; wording already says this is not production evidence. |
| `research-expanded-universe-profit-test.md` | Historical expanded-universe result | Keep as evidence that the first SMA20 result did not generalize cleanly. |
| `research-strategy-family-comparison.md` | Current workflow, historical result | Keep; updated with current holdout/regime status note. |
| `research-sma20-holdout-validation.md` | Current holdout-result doc | Keep. |
| `research-sma20-regime-risk-diagnostic.md` | Current diagnostic-result doc | Keep. |
| `offline-policy-review.md` | Separate validation doc | Keep; not part of cleanup unless policy review scope changes. |

No docs should be deleted now. If the validation folder becomes hard to scan,
move historical research-result docs into an archive in a future docs-only PR.

## Test Inventory

Research-focused tests currently map to existing modules:

- `yahoo-research-lane.test.ts`
- `price-feature-labels.test.ts`
- `multiticker-separation-analysis.test.ts`
- `multiticker-evidence-report.test.ts`
- `profit-backtest.test.ts`
- `profit-robustness-grid.test.ts`
- `strategy-family-comparison.test.ts`
- `sma20-holdout-validation.test.ts`
- `sma20-regime-risk-diagnostic.test.ts`
- `grounded-research.test.ts`

The newer research lanes include production-isolation tests that check
production entrypoints do not import research modules. Keep those tests. A
future cleanup can consolidate repeated fixture builders and production
isolation checks into shared test helpers.

## Generated Artifact Tracking Check

Generated local research outputs are under `.dexter/` and are ignored by git.
The audit found no tracked `.dexter/` files, Yahoo raw/normalized outputs,
price-feature outputs, or research analysis JSON artifacts.

Tracked JSON files are limited to intended validation fixtures:

- `src/signal-engine/validation/offline-calibration-scenarios.v1.json`
- `src/signal-engine/validation/universes/liquid-us-ca.sample.json`
- `src/signal-engine/validation/universes/liquid-us-smoke.json`

No generated research artifact cleanup is needed in git.

## Stale Wording Risks

The main wording risk is older docs that mention a `research_candidate` row or
family before later holdout and regime diagnostics weakened the case. Those
docs should keep their historical results, but they should not imply training,
production tuning, or live trading readiness.

Minimal correction made in this audit:

- `research-strategy-family-comparison.md` now notes that later SMA20 holdout
  validation found `holdout_fragile` and the regime/risk diagnostic found
  `risk_filter_needed`.

## Refactor Opportunities

These are cleanup candidates only; they should be handled in a separate PR:

- Extract shared research CLI numeric parsing and validation helpers.
- Extract shared date-window validation for research/holdout splits.
- Extract shared artifact grouping and coverage-summary helpers.
- Extract shared `mean`, `median`, rounding, and count-by helpers.
- Extract shared production-isolation test helpers.
- Clarify the shared Yahoo CLI used by `research:yahoo:fetch` and
  `research:yahoo:normalize`.
- Consider a research-only sector/ticker mapping utility if more diagnostics
  reuse sector buckets.

## Recommended Next Cleanup PR Scope

The safest cleanup PR would be narrow and non-behavioral:

1. Add shared research utility helpers for validation and simple statistics.
2. Migrate one or two modules at a time with focused tests.
3. Keep all script names stable.
4. Avoid changing strategy defaults, ranking, costs, rebalance logic, or verdict
   thresholds.
5. Optionally add an `archive/` folder for historical validation docs after the
   team agrees on doc organization.

Do not combine source cleanup with new research results.

## Recommended Next Research PR Scope

The next research PR should follow the current diagnostic result:

1. Test risk-control hypotheses for SMA20 in research-only mode.
2. Start with diagnostics-supported filters such as avoiding deepest pullbacks,
   limiting ticker/sector concentration, and comparing topN=6 with explicit
   risk controls.
3. Keep holdout validation as a mandatory gate.
4. Report whether any risk-controlled variant survives costs and holdout.
5. Continue to avoid model training, production policy tuning, and live trading
   unless future evidence passes broader universe and holdout gates.
