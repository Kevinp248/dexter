#!/usr/bin/env python3
"""Train/evaluate a lightweight ML sidecar on Dexter dataset exports."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


FEATURES = [
    "aggregateScore",
    "confidence",
    "riskScore",
    "expectedEdgeAfterCostsBps",
    "roundTripCostBps",
    "technicalScore",
    "fundamentalsScore",
    "valuationScore",
    "sentimentScore",
    "volatilityPercentile",
    "annualizedVolatility",
]


@dataclass
class FoldResult:
    fold: int
    start_idx: int
    end_idx: int
    auc: Optional[float]
    trades: int
    total_return_pct: float
    sharpe: Optional[float]
    max_drawdown_pct: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train/evaluate sidecar ML signal model")
    parser.add_argument(
        "--dataset",
        required=True,
        help="Path to ml-dataset CSV produced by Dexter.",
    )
    parser.add_argument(
        "--output-dir",
        default=".dexter/signal-engine/ml",
        help="Directory to write predictions and summary.",
    )
    parser.add_argument("--target-horizon", choices=["1d", "5d"], default="1d")
    parser.add_argument("--splits", type=int, default=5)
    return parser.parse_args()


def compute_action(prob_up: float, row: pd.Series, position: int) -> str:
    vol_regime = str(row.get("volatilityRegime", "normal")).lower()
    fallback_used = bool(row.get("fallbackUsed", False))
    quality_guard = bool(row.get("qualityGuardSuppressed", False))
    edge_after_cost = float(row.get("expectedEdgeAfterCostsBps", 0.0))
    risk_score = float(row.get("riskScore", 0.0))

    if quality_guard:
        return "HOLD"

    band = 0.08
    if vol_regime == "high":
        band += 0.04
    if fallback_used:
        band += 0.03

    uncertainty = abs(prob_up - 0.5)
    band = min(0.2, band + max(0.0, 0.12 - uncertainty))
    upper = 0.5 + band
    lower = 0.5 - band

    if edge_after_cost <= 0:
        return "HOLD"
    if prob_up >= upper and risk_score >= 0.25:
        return "BUY"
    if position > 0 and prob_up <= lower:
        return "SELL"
    return "HOLD"


def simulate_strategy(predictions: pd.DataFrame, return_col: str) -> tuple[pd.Series, int]:
    position = 0
    strategy_returns: List[float] = []
    trades = 0
    for _, row in predictions.iterrows():
        p_up = float(row["p_up_blend"])
        action = compute_action(p_up, row, position)
        if action == "BUY" and position == 0:
            position = 1
            trades += 1
        elif action == "SELL" and position == 1:
            position = 0
            trades += 1
        raw_ret = float(row.get(return_col, 0.0))
        strategy_returns.append(raw_ret * position)
    return pd.Series(strategy_returns, index=predictions.index), trades


def max_drawdown(returns: pd.Series) -> float:
    if returns.empty:
        return 0.0
    equity = (1.0 + returns.fillna(0.0)).cumprod()
    peak = equity.cummax()
    dd = equity / peak - 1.0
    return float(dd.min() * 100.0)


def sharpe_ratio(returns: pd.Series) -> Optional[float]:
    if returns.empty:
        return None
    mu = returns.mean()
    sigma = returns.std(ddof=0)
    if sigma <= 0:
        return None
    return float((mu / sigma) * math.sqrt(252))


def main() -> None:
    args = parse_args()
    dataset = Path(args.dataset)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(dataset)
    df = df.sort_values("date").reset_index(drop=True)

    target_col = "labelUp1dAfterCosts" if args.target_horizon == "1d" else "labelUp5dAfterCosts"
    ret_col = "return1dAfterCostsPct" if args.target_horizon == "1d" else "return5dAfterCostsPct"
    model_df = df.dropna(subset=FEATURES + [target_col, ret_col]).copy()
    model_df[target_col] = model_df[target_col].astype(int)

    X = model_df[FEATURES]
    y = model_df[target_col]

    tscv = TimeSeriesSplit(n_splits=args.splits)
    fold_results: List[FoldResult] = []
    all_preds = []

    for fold_idx, (train_idx, test_idx) in enumerate(tscv.split(X), start=1):
        X_train = X.iloc[train_idx]
        y_train = y.iloc[train_idx]
        X_test = X.iloc[test_idx]
        y_test = y.iloc[test_idx]

        if len(np.unique(y_train)) < 2:
            # Tiny samples can be single-class in early folds.
            base_prob = float(np.mean(y_train))
            p_log = np.full(len(X_test), base_prob, dtype=float)
            p_gb = np.full(len(X_test), base_prob, dtype=float)
        else:
            logistic = Pipeline(
                [
                    ("scaler", StandardScaler()),
                    ("clf", LogisticRegression(max_iter=2000, class_weight="balanced")),
                ]
            )
            class_counts = np.bincount(y_train)
            min_class_count = int(class_counts[class_counts > 0].min())
            if min_class_count >= 2:
                calib_cv = min(3, min_class_count)
                logistic_cal = CalibratedClassifierCV(estimator=logistic, method="sigmoid", cv=calib_cv)
                logistic_cal.fit(X_train, y_train)
                p_log = logistic_cal.predict_proba(X_test)[:, 1]
            else:
                logistic.fit(X_train, y_train)
                p_log = logistic.predict_proba(X_test)[:, 1]

            gb = GradientBoostingClassifier(random_state=42)
            gb.fit(X_train, y_train)
            p_gb = gb.predict_proba(X_test)[:, 1]

        p_blend = 0.5 * p_log + 0.5 * p_gb
        auc = roc_auc_score(y_test, p_blend) if len(set(y_test)) > 1 else None

        fold_df = model_df.iloc[test_idx].copy()
        fold_df["p_up_logistic"] = p_log
        fold_df["p_up_gb"] = p_gb
        fold_df["p_up_blend"] = p_blend
        strategy_rets, trades = simulate_strategy(fold_df, ret_col)
        fold_df["strategy_return"] = strategy_rets.values
        all_preds.append(fold_df)

        fold_results.append(
            FoldResult(
                fold=fold_idx,
                start_idx=int(test_idx[0]),
                end_idx=int(test_idx[-1]),
                auc=None if auc is None else float(auc),
                trades=trades,
                total_return_pct=float(strategy_rets.sum() * 100.0),
                sharpe=sharpe_ratio(strategy_rets),
                max_drawdown_pct=max_drawdown(strategy_rets),
            )
        )

    predictions = pd.concat(all_preds).sort_values("date").reset_index(drop=True)
    pred_path = out_dir / f"predictions-{dataset.stem}-{args.target_horizon}.csv"
    predictions.to_csv(pred_path, index=False)

    strat = predictions["strategy_return"].fillna(0.0)
    summary = {
        "generatedAt": pd.Timestamp.now("UTC").isoformat(),
        "dataset": str(dataset),
        "targetHorizon": args.target_horizon,
        "rows": int(len(model_df)),
        "features": FEATURES,
        "overall": {
            "totalReturnPct": float(strat.sum() * 100.0),
            "sharpe": sharpe_ratio(strat),
            "maxDrawdownPct": max_drawdown(strat),
            "trades": int(
                (
                    (predictions["strategy_return"].shift(1).fillna(0.0) == 0.0)
                    & (predictions["strategy_return"] != 0.0)
                ).sum()
            ),
        },
        "folds": [fold.__dict__ for fold in fold_results],
        "predictionsPath": str(pred_path),
    }

    summary_path = out_dir / f"summary-{dataset.stem}-{args.target_horizon}.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
