# Phase 2 Signal-Quality Note

Date: 2026-04-11

## What changed in Phase 2

- Replaced the prior single-name `statArb` slot with deterministic MACD (12/26/9) in technical analysis.
- Added ROIC support to fundamentals and moved pillar scoring from coarse buckets to continuous interpolation.
- Added sector-aware valuation assumptions with bounded PEG-style fair-P/E adjustment.
- Redesigned confidence to reflect agreement, evidence breadth, data quality, and disagreement/divergence.
- Replaced keyword sentiment counting with provider-based structured sentiment flow (plus conservative fallback).
- Expanded targeted tests for MACD, ROIC, continuous scoring, valuation assumptions, confidence, and sentiment flow.

## Important defaults now

- Aggregate weights: technical `0.36`, fundamentals `0.29`, valuation `0.18`, sentiment `0.17`.
- Technical includes MACD via `technical.macdWeight = 0.18`.
- Fundamentals include capital-efficiency and cash-flow-quality pillars.
- Valuation sector assumptions are configured in `SIGNAL_CONFIG.valuation.sectorFairPe`.
- PEG adjustment bounds: `pegGrowthMin = -0.05`, `pegGrowthMax = 0.25`.

## Sentiment fallback default

- `SIGNAL_SENTIMENT_LLM_FALLBACK` is **OFF by default**.
- Structured provider sentiment is used first.
- If structured sentiment is unavailable and LLM fallback is not explicitly enabled, sentiment returns conservative neutral fallback.

## Still needs out-of-sample calibration

- MACD confidence scale sensitivity across different volatility regimes.
- Fundamentals pillar weights/thresholds across US + CA sectors beyond AAPL/MSFT.
- Valuation sector table/PEG sensitivities to avoid over- or under-penalization.
- Confidence calibration against realized hit-rate and drawdown outcomes.
- Structured sentiment coverage quality and fallback frequency by ticker/news source.
