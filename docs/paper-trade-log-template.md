# Paper Trade Log Template

Use this after each scan and manual decision.
For fill-level position tracking, also log each fill through:
- `bun run trade:ledger record ...`

Recommended file path for weekly review script:
- `.dexter/signal-engine/paper-trade-log.csv`

CSV header (copy/paste as first row):
```csv
Date,Ticker,action,finalAction,Confidence,Decision,Direction,Entry Price,Position Size (shares),Notional,Cost Estimate (USD),Key Delta Drivers,Risk Checks,Reason for Override,Exit Date,Exit Price,Result (%),Fallback Had Fallback,Fallback Reason,Fallback Retry Suggestion,Notes / Lessons
```

## Trade Log Columns

- Date
- Ticker
- Signal `action`
- Signal `finalAction`
- Signal `Confidence` (0-100, from scan output)
- Your Decision (`trade` / `skip`)
- Direction (`long` / `exit long` / `cover short` / `none`)
- Entry Price
- Position Size (shares)
- Notional
- Cost Estimate (USD)
- Key Delta Drivers
- Risk Checks
- Reason for Override (if you ignored `finalAction`)
- Exit Date
- Exit Price
- Result (%)
- Fallback Had Fallback (`true` / `false`)
- Fallback Reason
- Fallback Retry Suggestion
- Notes / Lessons

## Example row

| Date | Ticker | action | finalAction | Decision | Direction | Entry | Shares | Notional | Cost Est | Delta Drivers | Risk Checks | Override Reason | Exit Date | Exit | Result | Notes |
|------|--------|--------|-------------|----------|-----------|-------|--------|----------|----------|---------------|-------------|-----------------|-----------|------|--------|-------|
| 2026-04-09 | AAPL | BUY | HOLD | skip | none | - | 0 | 0 | 0 | technical +0.12, valuation +0.09 | High correlation | Cost/constraint downgrade respected | - | - | - | Wait for cleaner setup |
