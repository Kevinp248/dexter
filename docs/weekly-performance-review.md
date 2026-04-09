# Weekly Performance Review

Last updated: 2026-04-09

Use this once per week to audit signal quality and your manual decisions.

## 1) Keep paper-trade log current

- Store your CSV at:
  - `.dexter/signal-engine/paper-trade-log.csv`
- Keep fills synced in position ledger:
  - `bun run trade:ledger record ...`
- Use header from:
  - `docs/paper-trade-log-template.md`

## 2) Run review command

```bash
bun run review:weekly
```

Optional flags:

```bash
bun run review:weekly --days 14
bun run review:weekly --json
bun run review:weekly --log /custom/path/paper-trade-log.csv
```

## 3) Read checklist output

The script prints PASS/WARN checks for:

- Closed trades sample size
- Fallback retry hygiene
- Manual override discipline
- Outcome drift
- Win rate floor

## 4) What to do when WARN appears

- If fallback retry hygiene warns:
  - Log fallback reason and retry suggestion for every fallback row before next week.
- If manual override warns:
  - Re-check override decisions and tighten your discretionary rules.
- If outcome drift/win-rate warns:
  - Reduce risk, keep paper trading, and do not increase position size.

## 5) Weekly operator discipline

Before changing strategy parameters:
1. Finish weekly review.
2. Update `docs/parameter-changelog.md` with any planned changes.
3. Re-run:
   - `npm run typecheck`
   - `npm run test:signals`
