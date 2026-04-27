# Research Feature Engineering Signal Discovery

This workflow is a research-only pivot away from price-only SMA20 optimization. The prior SMA20 evidence trail ended with `finalDecisionVerdict: stop_sma20_price_only` and `finalRecommendation: stop_price_only_sma20_research` because fixed holdout optimization could still find attractive rows, but walk-forward selection did not generalize.

The stopped SMA20 baseline had 0 of 4 walk-forward test windows as `research_candidate`, 1 of 4 weak-or-better windows, average test `benchmarkRelativeReturn` of -0.0495, selected only 0 bps configs, and had no selected test result survive 10 bps or 25 bps as `research_candidate`.

## Purpose

The new workflow tests richer but still explainable price-derived signals:

- Market-relative strength: `marketRet20d`, `relRet20d`, `marketRet5d`, `relRet5d`.
- Sector-relative pullback: `sectorAvgSma20Gap`, `sectorRelativeSma20Gap`, `sectorAvgRet20d`, `sectorRelativeRet20d`.
- Volatility-adjusted pullback: `volAdjustedSma20Gap`, `volAdjustedRet20d`.
- Trend-qualified pullback flags: `trendUp20`, `trendUp50`, `pullbackInUptrend`, `deepPullbackInUptrend`.
- Breadth filters: `universeBreadth20`, `universeBreadth50`, `sectorBreadth20`, `sectorBreadth50`.
- Explainable rank scores: `relStrengthRank`, `pullbackRank`, `volAdjustedPullbackRank`, `trendQualifiedPullbackScore`, `relativePullbackComposite`.

All cross-sectional features are computed from rows on the same signal date. Sector features use the same sector bucket mapping as the SMA20 regime/risk diagnostic.

## Walk-Forward Discipline

The workflow uses the same train/test windows as the SMA20 walk-forward decision report:

1. Train 2021-01-04 to 2022-12-31, test 2023-01-01 to 2023-12-31.
2. Train 2021-01-04 to 2023-12-31, test 2024-01-01 to 2024-12-31.
3. Train 2021-01-04 to 2024-12-31, test 2025-01-01 to 2025-12-31.
4. Train 2021-01-04 to 2025-12-31, test 2026-01-01 to 2026-04-24.

Best configs are selected on train windows only and then applied unchanged to test windows. Test results are never used for selection.

## Families

- `sector_relative_pullback`: rank `sectorRelativeSma20Gap` ascending, require `pullbackInUptrend`.
- `relative_strength_pullback`: require `pullbackInUptrend`, combine relative strength rank and sector-relative pullback rank.
- `vol_adjusted_pullback`: rank `volAdjustedSma20Gap` ascending, require valid volatility and exclude raw `sma_20_gap <= -0.12`.
- `breadth_filtered_pullback`: require `universeBreadth20 >= 0.45` and `sectorBreadth20 >= 0.40`, rank `sectorRelativeSma20Gap` ascending.
- `relative_pullback_composite`: rank `relativePullbackComposite` descending, require `pullbackInUptrend` and `universeBreadth20 >= 0.45`.

Each family tests `topN` 4, 6, and 8, `holdDays` 20, and costs of 0, 10, and 25 bps.

## Decision Rules

`continue_new_signal_research` requires at least one family with at least 2 of 4 test windows as `research_candidate`, at least 3 of 4 weak-or-better windows, positive average test `benchmarkRelativeReturn`, and at least one selected 10 bps test result as `research_candidate`.

`refine_feature_set` applies when no family meets continue, but at least one family improves on the stopped SMA20 baseline on weak-or-better windows, average benchmark-relative return, drawdown, and has at least one 10 bps weak-or-better result.

`stop_price_only_research` applies when no family clearly improves over the SMA20 baseline.

## Scope Limits

This is not production signal logic. It does not train a model, tune production policy, use live providers, fetch data, auto-trade, or change `runDailyScan`. It reads only the existing local price-feature artifact and writes research artifacts under `.dexter/signal-engine/research/`.
