# Parameter Changelog

This file tracks every change to strategy parameters in:
- `src/signal-engine/config.ts`

## Rules

1. Never change parameters without adding an entry here.
2. Include reason, expected impact, and validation command/results.
3. Keep entries append-only.

## Entries

### 2026-04-09 - Config v1.0.0
- Added initial centralized, versioned config at `src/signal-engine/config.ts`.
- Externalized:
  - aggregate signal weights
  - action thresholds
  - confidence weights
  - technical strategy thresholds/weights
  - fundamental threshold set
  - valuation weights and gap thresholds
  - risk volatility/correlation limits
  - execution cost assumptions and bounds
  - default portfolio guardrails
- Reason:
  - Avoid hidden constants across modules.
  - Make tuning controlled and auditable.
- Validation:
  - `npm run typecheck`
  - `npm run test:signals`

### 2026-04-09 - Config v1.0.1
- Added `regional.canada` settings:
  - `allowedExchanges`
  - `minAverageDollarVolume20d`
  - `minHistoryBars`
- Added Canadian market nuance gating in signal engine:
  - Exchange + liquidity checks feed `regionalMarketCheck`.
  - Trade actions can be downgraded to `HOLD` if CA checks fail.
- Reason:
  - Avoid low-liquidity or unsupported-market executions for Canadian names.
- Validation:
  - `npm run typecheck`
  - `npm run test:signals`
