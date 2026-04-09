# Core Logic Integration (ai-hedge-fund + Dexter)

This document defines what core logic is currently merged and where it lives.

## 1) Technical Analysis Core (ported from ai-hedge-fund)

Source inspiration:
- `ai-hedge-fund/src/agents/technicals.py`

Implemented in:
- `src/agents/analysis/technical.ts`

Parity scope:
- Trend following (EMA 8/21/55 + ADX-style strength proxy)
- Mean reversion (z-score, Bollinger position, RSI 14/28)
- Momentum (21/63/126-day returns + volume momentum)
- Volatility regime (annualized vol percentile)
- Statistical reversion proxy (30-day z-score)
- Weighted ensemble combination:
  - trend 25%
  - mean reversion 20%
  - momentum 25%
  - volatility 15%
  - stat-arb 15%

## 2) Fundamental Analysis Core (ported from ai-hedge-fund)

Source inspiration:
- `ai-hedge-fund/src/agents/fundamentals.py`

Implemented in:
- `src/agents/analysis/fundamentals.ts`

Parity scope:
- Profitability pillar (ROE, net margin, operating margin)
- Growth pillar (revenue, earnings, book value growth)
- Financial health pillar (current ratio, debt/equity, FCF conversion)
- Valuation ratios pillar (P/E, P/B, P/S)
- Deterministic bullish/bearish/neutral pillar voting and aggregate score

## 3) Valuation Core (ported from ai-hedge-fund)

Source inspiration:
- `ai-hedge-fund/src/agents/valuation.py`

Implemented in:
- `src/agents/analysis/valuation.ts`
- `src/data/market.ts` (cash-flow + income statement loaders)

Parity scope:
- DCF-style valuation from FCF history and growth assumptions
- Owner earnings valuation proxy
- Multiples-based fair value proxy
- Residual income proxy
- Weighted valuation gap vs market cap:
  - DCF 35%
  - Owner earnings 35%
  - Multiples 20%
  - Residual income 10%

## 4) Risk Core (ported from ai-hedge-fund)

Source inspiration:
- `ai-hedge-fund/src/agents/risk_manager.py`

Implemented in:
- `src/risk/risk.ts`

Parity scope:
- Volatility-adjusted position limit function
- Correlation adjustment multiplier function
- Combined risk score + max allocation cap
- Risk checks list (volatility, leverage, valuation, correlation concentration)

## 5) Deterministic Final Decision Engine (Dexter-native orchestration)

Source inspiration:
- `ai-hedge-fund` portfolio/risk signal gating and ensemble behavior
- Dexter orchestration style and output model

Implemented in:
- `src/signal-engine/index.ts`
- `src/signal-engine/rules.ts`
- `src/signal-engine/models.ts`
- `src/signal-engine/daily-scan.ts`

Behavior:
- Runs technical + fundamentals + valuation + sentiment analyzers
- Calculates cross-ticker average correlations
- Applies risk constraints
- Produces deterministic action in `BUY | SELL | HOLD | COVER`
- Supports position context (`--position TICKER:long:QTY` / `--position TICKER:short:QTY`)
- Outputs auditable JSON with component breakdowns and weighted inputs
