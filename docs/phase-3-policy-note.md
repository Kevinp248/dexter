# Phase 3 Policy Note

## Earnings policy defaults
- `earnings.enabled = true`
- `earnings.blackoutTradingDays = 5`
- `earnings.buyPolicyInBlackout = "suppress_to_hold"` (BUY is downgraded to HOLD in blackout)
- `earnings.missingCoveragePolicy = "warn_only"` by default
- Stricter mode remains available: `earnings.missingCoveragePolicy = "suppress_buy"`

## Regime defaults
- Regime states are explicit: `risk_on`, `risk_off`, `regime_unknown`
- `regime.strictBuyGateInRiskOff = false` by default
- In `risk_off`, policy layer applies:
  - higher BUY threshold
  - confidence cap
  - max-allocation multiplier
- In `regime_unknown` (missing SPY/VIX or insufficient SPY history), conservative caps are applied with explicit reason codes.

## Cost provenance fields now exposed
Execution cost payload now includes:
- `expectedEdgePreCostBps`
- `costBreakdownBps`
- `expectedEdgePostCostBps` (also mirrored as `expectedEdgeAfterCostsBps`)
- `minEdgeThresholdBps`
- `costChangedAction`
- `assumptionSource`
- `assumptionVersion`
- `assumptionSnapshotId`

These fields are propagated to scan payloads, paper-trade log rows, and ML dataset rows.

## Sentiment fallback default
- Sentiment LLM fallback remains OFF by default.
- It only activates when `SIGNAL_SENTIMENT_LLM_FALLBACK` is explicitly enabled.

## Known non-blocking tuning concern
- Earnings staleness classification currently treats very distant earnings dates as `stale` (warn path), which is conservative but may over-warn for valid far-future dates.
