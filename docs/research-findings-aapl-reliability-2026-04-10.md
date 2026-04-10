# AAPL Prediction Reliability - Research Findings (2026-04-10)

This note captures external research and how it maps to our current system gaps.

## Why HOLD-heavy behavior keeps happening

1. **Decision thresholds are not calibrated to observed score distribution**
   - If probability/score thresholds are fixed and not tuned, classifiers can remain in a wide neutral zone.
   - Source: scikit-learn threshold tuning guide  
     https://scikit-learn.org/stable/modules/classification_threshold.html
   - Mapping to our code:
     - Current fixed thresholds in signal rules and config can under-trigger entries in certain regimes.

2. **Time-series validation must avoid random splits**
   - For chronological data, training must only use past data and validate on future slices.
   - Source: TimeSeriesSplit docs  
     https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
   - Mapping to our code:
     - We need rolling walk-forward evaluation for ML sidecar and threshold calibration.

3. **Backtest overfitting risk is high when many parameter/model trials are attempted**
   - Strategy selection bias can overstate expected performance.
   - Source: Deflated Sharpe Ratio paper (Bailey & Lopez de Prado)  
     https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
   - Mapping to our code:
     - We should gate model changes by out-of-sample risk-adjusted metrics and stability checks across multiple folds.

4. **Monotonic constraints can improve model behavior for finance features**
   - Constraining relationships can reduce unstable or counterintuitive model outputs.
   - Source: XGBoost monotonic constraints  
     https://xgboost.readthedocs.io/en/stable/tutorials/monotonic.html
   - Mapping to our code:
     - For an optional boosting model, use monotonic constraints on selected features to reduce regime overfitting.

## Candidate open-source integrations reviewed

1. **vectorbt** (fast research/backtest workflows)  
   https://github.com/polakowo/vectorbt
2. **backtesting.py** (simple strategy evaluation framework)  
   https://github.com/kernc/backtesting.py
3. **Qlib** (broader quant research platform; larger integration scope)  
   https://github.com/microsoft/qlib
4. **LEAN** (production-grade engine; heavy integration)  
   https://github.com/quantconnect/lean

Current recommendation: keep runtime in Dexter TS, add a Python sidecar for model evaluation first, avoid full engine migration right now.

## Practical conclusions for this repo

1. HOLD-heavy output is primarily a modeling/calibration issue, not only data length.
2. One-month windows (e.g., Jan 2026 only) are useful for smoke tests and API-cost control, but insufficient for reliability claims.
3. Use local cache + offline dataset replay for repeatable tests without burning credits.
4. Validate any improvement with rolling OOS tests, drawdown constraints, and minimum trade-count checks.
