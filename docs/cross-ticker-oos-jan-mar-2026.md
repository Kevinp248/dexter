# Cross-Ticker OOS Trial: Jan-Mar 2026 (AAPL + MSFT)

Date: 2026-04-10  
Harness: `npx tsx src/signal-engine/cross-ticker-harness.cli.ts`  
Source artifacts:
- `.dexter/signal-engine/reports/cross-ticker-harness-2026-04-10T23-47-28-698Z.json`
- `.dexter/signal-engine/reports/cross-ticker-harness-2026-04-10T23-47-28-698Z.csv`

## Monthly table (return/drawdown/trades)

| Ticker | Month | Profile | Mode | Return % | Max DD % | Trades | Fallback % | Benchmark Spread % |
|---|---|---|---|---:|---:|---:|---:|---:|
| AAPL | 2026-01 | adaptive_safe | long_only | 0.0000 | 0.0000 | 0 | 0.0 | 4.6940 |
| AAPL | 2026-01 | adaptive_safe | long_short | 0.0000 | 0.0000 | 0 | 0.0 | 4.6940 |
| AAPL | 2026-01 | swing_alpha | long_only | 0.1025 | -0.0011 | 2 | 0.0 | 4.7965 |
| AAPL | 2026-01 | swing_alpha | long_short | 0.0821 | -0.0390 | 4 | 0.0 | 4.7761 |
| AAPL | 2026-02 | adaptive_safe | long_only | 0.0000 | 0.0000 | 0 | 0.0 | -1.5960 |
| AAPL | 2026-02 | adaptive_safe | long_short | 0.0000 | 0.0000 | 0 | 0.0 | -1.5960 |
| AAPL | 2026-02 | swing_alpha | long_only | 0.3910 | -0.1130 | 4 | 0.0 | -1.2050 |
| AAPL | 2026-02 | swing_alpha | long_short | 0.3910 | -0.1130 | 4 | 0.0 | -1.2050 |
| AAPL | 2026-03 | adaptive_safe | long_only | -0.0577 | -0.0577 | 2 | 0.0 | 3.2272 |
| AAPL | 2026-03 | adaptive_safe | long_short | -0.0014 | -0.1124 | 4 | 0.0 | 3.2835 |
| AAPL | 2026-03 | swing_alpha | long_only | 0.0000 | 0.0000 | 0 | 0.0 | 3.2849 |
| AAPL | 2026-03 | swing_alpha | long_short | 0.7443 | -0.5779 | 14 | 0.0 | 4.0292 |
| MSFT | 2026-01 | adaptive_safe | long_only | 0.0000 | 0.0000 | 0 | 0.0 | 11.1687 |
| MSFT | 2026-01 | adaptive_safe | long_short | 0.0000 | 0.0000 | 0 | 0.0 | 11.1687 |
| MSFT | 2026-01 | swing_alpha | long_only | -0.4720 | -0.5740 | 3 | 0.0 | 10.6967 |
| MSFT | 2026-01 | swing_alpha | long_short | 0.5667 | -0.2547 | 3 | 0.0 | 11.7354 |
| MSFT | 2026-02 | adaptive_safe | long_only | 0.0000 | 0.0000 | 0 | 0.0 | 8.7161 |
| MSFT | 2026-02 | adaptive_safe | long_short | 0.0000 | 0.0000 | 0 | 0.0 | 8.7161 |
| MSFT | 2026-02 | swing_alpha | long_only | 0.0000 | 0.0000 | 0 | 0.0 | 8.7161 |
| MSFT | 2026-02 | swing_alpha | long_short | 0.0000 | 0.0000 | 0 | 0.0 | 8.7161 |
| MSFT | 2026-03 | adaptive_safe | long_only | 0.0000 | 0.0000 | 0 | 0.0 | 5.7756 |
| MSFT | 2026-03 | adaptive_safe | long_short | 0.0000 | 0.0000 | 0 | 0.0 | 5.7756 |
| MSFT | 2026-03 | swing_alpha | long_only | -0.3325 | -0.7205 | 8 | 0.0 | 5.4431 |
| MSFT | 2026-03 | swing_alpha | long_short | -0.3325 | -0.7205 | 8 | 0.0 | 5.4431 |

## Q1 compounded summary

| Ticker | Profile | Mode | Q1 Compounded Return % |
|---|---|---|---:|
| AAPL | adaptive_safe | long_only | -0.0577 |
| AAPL | adaptive_safe | long_short | -0.0014 |
| AAPL | swing_alpha | long_only | 0.4939 |
| AAPL | swing_alpha | long_short | 1.2212 |
| MSFT | adaptive_safe | long_only | 0.0000 |
| MSFT | adaptive_safe | long_short | 0.0000 |
| MSFT | swing_alpha | long_only | -0.8029 |
| MSFT | swing_alpha | long_short | 0.2323 |

## Takeaways

1. `swing_alpha` materially reduces trade starvation versus `adaptive_safe`.
2. AAPL improves most under `swing_alpha + long_short`, with higher turnover and acceptable fallback hygiene.
3. MSFT remains mixed; `swing_alpha + long_short` helps versus long-only but still needs tighter loss controls.
4. Next tuning pass should target MSFT drawdown control without suppressing AAPL opportunity capture.

