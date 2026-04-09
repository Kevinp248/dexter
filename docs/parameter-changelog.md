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
