#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Signal = -1 | 0 | 1;

type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type StrategyMetrics = {
  totalReturn: number;
  annReturn: number;
  annVolatility: number;
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  trades: number;
  finalEquity: number;
  dollarPnl: number;
  benchmarkReturn: number;
};

type TradeEpisode = {
  entryDate: string;
  exitDate: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
};

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

function rollingMean(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < window) {
      out.push(null);
      continue;
    }
    const slice = values.slice(i + 1 - window, i + 1);
    out.push(slice.reduce((sum, v) => sum + v, 0) / window);
  }
  return out;
}

function rollingStd(values: number[], window: number): Array<number | null> {
  const means = rollingMean(values, window);
  return means.map((mean, i) => {
    if (mean === null) return null;
    const slice = values.slice(i + 1 - window, i + 1);
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window;
    return Math.sqrt(variance);
  });
}

function rsi(close: number[], period = 14): Array<number | null> {
  const gains = new Array<number>(close.length).fill(0);
  const losses = new Array<number>(close.length).fill(0);
  for (let i = 1; i < close.length; i += 1) {
    const d = close[i] - close[i - 1];
    gains[i] = Math.max(0, d);
    losses[i] = Math.max(0, -d);
  }
  const avgGain = rollingMean(gains, period);
  const avgLoss = rollingMean(losses, period);
  return close.map((_, i) => {
    if (avgGain[i] === null || avgLoss[i] === null) return null;
    if ((avgLoss[i] as number) === 0) return 100;
    const rs = (avgGain[i] as number) / (avgLoss[i] as number);
    return 100 - 100 / (1 + rs);
  });
}

async function fetchYahooAdjustedBars(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<PriceBar[]> {
  const toEpoch = (d: string) => Math.floor(Date.parse(`${d}T00:00:00.000Z`) / 1000);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker.toUpperCase()}`);
  url.searchParams.set('period1', String(toEpoch(startDate)));
  url.searchParams.set('period2', String(toEpoch(endDate) + 86400));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'history');
  url.searchParams.set('includeAdjustedClose', 'true');
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Yahoo request failed: ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as Record<string, unknown>;
  const result = (
    ((payload.chart as Record<string, unknown> | undefined)?.result as Array<Record<string, unknown>> | undefined) ??
    []
  )[0];
  if (!result) return [];
  const ts = (result.timestamp as number[]) ?? [];
  const quote = (((result.indicators as Record<string, unknown> | undefined)?.quote as Array<Record<string, unknown>> | undefined) ?? [])[0] ?? {};
  const adj =
    ((((result.indicators as Record<string, unknown> | undefined)?.adjclose as Array<Record<string, unknown>> | undefined) ?? [])[0]?.adjclose as
      | number[]
      | undefined) ?? [];
  const open = (quote.open as number[]) ?? [];
  const high = (quote.high as number[]) ?? [];
  const low = (quote.low as number[]) ?? [];
  const close = (quote.close as number[]) ?? [];
  const volume = (quote.volume as number[]) ?? [];

  const bars: PriceBar[] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const c = Number(close[i]);
    if (!Number.isFinite(c) || c <= 0) continue;
    const a = Number(adj[i]);
    const factor = Number.isFinite(a) && a > 0 ? a / c : 1;
    const o = Number(open[i]);
    const h = Number(high[i]);
    const l = Number(low[i]);
    const v = Number(volume[i]);
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: Number.isFinite(o) ? o * factor : c * factor,
      high: Number.isFinite(h) ? h * factor : c * factor,
      low: Number.isFinite(l) ? l * factor : c * factor,
      close: c * factor,
      volume: Number.isFinite(v) ? v : 0,
    });
  }
  return bars.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function signalFromCondition(values: boolean[], negValues: boolean[]): Signal[] {
  return values.map((v, i) => (v ? 1 : negValues[i] ? -1 : 0));
}

function backtestVectorized(close: number[], signal: Signal[], capital = 10000, commission = 0.001): StrategyMetrics {
  const n = close.length;
  const pos = signal.map((_, i) => (i === 0 ? 0 : signal[i - 1]));
  const ret = close.map((_, i) => (i === 0 ? 0 : close[i] / close[i - 1] - 1));
  const posDiff = pos.map((v, i) => (i === 0 ? Math.abs(v) : Math.abs(v - pos[i - 1])));
  const stratRet = ret.map((r, i) => pos[i] * r);
  const cost = posDiff.map((d) => d * commission);
  const net = stratRet.map((r, i) => r - cost[i]);

  const eq: number[] = [];
  let running = capital;
  for (const r of net) {
    running *= 1 + r;
    eq.push(running);
  }

  const totalReturn = (eq[eq.length - 1] / capital - 1) * 100;
  const annReturn = (Math.pow(eq[eq.length - 1] / capital, 252 / Math.max(n, 1)) - 1) * 100;
  const meanNet = net.reduce((s, v) => s + v, 0) / Math.max(net.length, 1);
  const varNet = net.reduce((s, v) => s + (v - meanNet) ** 2, 0) / Math.max(net.length, 1);
  const stdNet = Math.sqrt(varNet);
  const annVolatility = stdNet * Math.sqrt(252) * 100;
  const rfDaily = 0.045 / 252;
  const sharpe = stdNet > 0 ? ((meanNet - rfDaily) / stdNet) * Math.sqrt(252) : 0;

  let peak = eq[0] ?? capital;
  let maxDd = 0;
  for (const e of eq) {
    peak = Math.max(peak, e);
    maxDd = Math.min(maxDd, (e - peak) / peak);
  }
  const tradeMask = posDiff.map((d) => d > 0);
  const tradeRets = net.filter((_, i) => tradeMask[i]);
  const wins = tradeRets.filter((v) => v > 0);
  const losses = tradeRets.filter((v) => v < 0);
  const winRate = tradeRets.length ? (wins.length / tradeRets.length) * 100 : 0;
  const profitFactor =
    Math.abs(losses.reduce((s, v) => s + v, 0)) > 0
      ? wins.reduce((s, v) => s + v, 0) / Math.abs(losses.reduce((s, v) => s + v, 0))
      : 99.9;

  const benchmarkReturn = (close[close.length - 1] / close[0] - 1) * 100;
  return {
    totalReturn: round(totalReturn, 2),
    annReturn: round(annReturn, 2),
    annVolatility: round(annVolatility, 2),
    sharpe: round(sharpe, 3),
    maxDrawdown: round(maxDd * 100, 2),
    winRate: round(winRate, 1),
    profitFactor: round(Math.min(profitFactor, 99.9), 3),
    trades: tradeRets.length,
    finalEquity: round(eq[eq.length - 1], 2),
    dollarPnl: round(eq[eq.length - 1] - capital, 2),
    benchmarkReturn: round(benchmarkReturn, 2),
  };
}

function buildTradeEpisodes(
  dates: string[],
  close: number[],
  signal: Signal[],
): TradeEpisode[] {
  const pos = signal.map((_, i) => (i === 0 ? 0 : signal[i - 1]));
  const episodes: TradeEpisode[] = [];
  let prev = 0;
  let entryDate = '';
  let entryPrice = 0;
  let side: 'LONG' | 'SHORT' = 'LONG';
  for (let i = 0; i < dates.length; i += 1) {
    const next = pos[i];
    const px = close[i];
    const dt = dates[i];
    if (prev === 0 && next !== 0) {
      entryDate = dt;
      entryPrice = px;
      side = next > 0 ? 'LONG' : 'SHORT';
    } else if (prev !== 0 && next === 0) {
      const pnlPct = prev > 0 ? ((px - entryPrice) / entryPrice) * 100 : ((entryPrice - px) / entryPrice) * 100;
      episodes.push({ entryDate, exitDate: dt, side, entryPrice, exitPrice: px, pnlPct: round(pnlPct, 2) });
    } else if (prev !== 0 && next !== 0 && prev !== next) {
      const pnlPct = prev > 0 ? ((px - entryPrice) / entryPrice) * 100 : ((entryPrice - px) / entryPrice) * 100;
      episodes.push({ entryDate, exitDate: dt, side, entryPrice, exitPrice: px, pnlPct: round(pnlPct, 2) });
      entryDate = dt;
      entryPrice = px;
      side = next > 0 ? 'LONG' : 'SHORT';
    }
    prev = next;
  }
  if (prev !== 0 && dates.length > 0) {
    const px = close[close.length - 1];
    const dt = dates[dates.length - 1];
    const pnlPct = prev > 0 ? ((px - entryPrice) / entryPrice) * 100 : ((entryPrice - px) / entryPrice) * 100;
    episodes.push({ entryDate, exitDate: dt, side, entryPrice, exitPrice: px, pnlPct: round(pnlPct, 2) });
  }
  return episodes;
}

function parseArgs(argv: string[]): {
  ticker: string;
  start: string;
  end: string;
  capital: number;
  strategyDetails: string | null;
  episodesCsv: string | null;
} {
  const out = {
    ticker: 'AAPL',
    start: '2025-01-01',
    end: '2025-03-31',
    capital: 10000,
    strategyDetails: null as string | null,
    episodesCsv: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--ticker' || arg === '-t') && argv[i + 1]) out.ticker = argv[++i].toUpperCase();
    else if (arg === '--start' && argv[i + 1]) out.start = argv[++i];
    else if (arg === '--end' && argv[i + 1]) out.end = argv[++i];
    else if (arg === '--capital' && argv[i + 1]) out.capital = Number(argv[++i]) || out.capital;
    else if (arg === '--strategy-details' && argv[i + 1]) out.strategyDetails = argv[++i];
    else if (arg === '--episodes-csv' && argv[i + 1]) out.episodesCsv = argv[++i];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const warmupStart = new Date(`${args.start}T00:00:00.000Z`);
  warmupStart.setUTCDate(warmupStart.getUTCDate() - 420);
  const warmupDate = warmupStart.toISOString().slice(0, 10);
  const barsAll = await fetchYahooAdjustedBars(args.ticker, warmupDate, args.end);
  const windowIndices = barsAll
    .map((bar, idx) => ({ bar, idx }))
    .filter(({ bar }) => bar.date >= args.start && bar.date <= args.end)
    .map(({ idx }) => idx);
  if (windowIndices.length < 40) throw new Error('Not enough bars in selected window.');

  const closeAll = barsAll.map((b) => b.close);
  const highAll = barsAll.map((b) => b.high);
  const lowAll = barsAll.map((b) => b.low);

  const ema9 = ema(closeAll, 9);
  const ema21 = ema(closeAll, 21);
  const ema12 = ema(closeAll, 12);
  const ema26 = ema(closeAll, 26);
  const macd = closeAll.map((_, i) => ema12[i] - ema26[i]);
  const macdSignal = ema(macd, 9);
  const rsi14 = rsi(closeAll, 14);
  const bbMean = rollingMean(closeAll, 20);
  const bbStd = rollingStd(closeAll, 20);
  const bbUpper = bbMean.map((m, i) => (m === null || bbStd[i] === null ? null : m + 2 * (bbStd[i] as number)));
  const bbLower = bbMean.map((m, i) => (m === null || bbStd[i] === null ? null : m - 2 * (bbStd[i] as number)));

  const ll14 = closeAll.map((_, i) => (i < 13 ? null : Math.min(...lowAll.slice(i - 13, i + 1))));
  const hh14 = closeAll.map((_, i) => (i < 13 ? null : Math.max(...highAll.slice(i - 13, i + 1))));
  const stochK = closeAll.map((c, i) => {
    if (ll14[i] === null || hh14[i] === null) return null;
    const range = (hh14[i] as number) - (ll14[i] as number);
    return range > 0 ? ((c - (ll14[i] as number)) / range) * 100 : 50;
  });
  const stochD = stochK.map((_, i) => {
    if (i < 2 || stochK[i] === null || stochK[i - 1] === null || stochK[i - 2] === null) return null;
    return ((stochK[i] as number) + (stochK[i - 1] as number) + (stochK[i - 2] as number)) / 3;
  });

  const sigEmaAll = signalFromCondition(
    closeAll.map((_, i) => ema9[i] > ema21[i]),
    closeAll.map((_, i) => ema9[i] < ema21[i]),
  );
  const sigRsiAll = signalFromCondition(
    closeAll.map((_, i) => (rsi14[i] ?? 50) < 35),
    closeAll.map((_, i) => (rsi14[i] ?? 50) > 65),
  );
  const sigMacdAll = signalFromCondition(
    closeAll.map((_, i) => macd[i] > macdSignal[i]),
    closeAll.map((_, i) => macd[i] < macdSignal[i]),
  );
  const sigBbAll = signalFromCondition(
    closeAll.map((c, i) => bbLower[i] !== null && c < (bbLower[i] as number)),
    closeAll.map((c, i) => bbUpper[i] !== null && c > (bbUpper[i] as number)),
  );
  const sigStochAll = signalFromCondition(
    closeAll.map((_, i) => stochK[i] !== null && stochD[i] !== null && (stochK[i] as number) > (stochD[i] as number) && (stochK[i] as number) < 80),
    closeAll.map((_, i) => stochK[i] !== null && stochD[i] !== null && (stochK[i] as number) < (stochD[i] as number) && (stochK[i] as number) > 20),
  );
  const sigEnsembleAll = closeAll.map((_, i) => {
    const score =
      sigEmaAll[i] * 0.25 +
      sigRsiAll[i] * 0.2 +
      sigMacdAll[i] * 0.25 +
      sigBbAll[i] * 0.15 +
      sigStochAll[i] * 0.15;
    return score > 0.1 ? 1 : score < -0.1 ? -1 : 0;
  }) as Signal[];

  const close = windowIndices.map((i) => closeAll[i]);
  const dates = windowIndices.map((i) => barsAll[i].date);
  const sigMacd = windowIndices.map((i) => sigMacdAll[i]) as Signal[];
  const sigEma = windowIndices.map((i) => sigEmaAll[i]) as Signal[];
  const sigRsi = windowIndices.map((i) => sigRsiAll[i]) as Signal[];
  const sigBb = windowIndices.map((i) => sigBbAll[i]) as Signal[];
  const sigStoch = windowIndices.map((i) => sigStochAll[i]) as Signal[];
  const sigEnsemble = windowIndices.map((i) => sigEnsembleAll[i]) as Signal[];

  const results: Record<string, StrategyMetrics> = {
    'MACD Crossover': backtestVectorized(close, sigMacd, args.capital),
    'EMA Crossover': backtestVectorized(close, sigEma, args.capital),
    'RSI Mean Reversion': backtestVectorized(close, sigRsi, args.capital),
    'Bollinger Bands': backtestVectorized(close, sigBb, args.capital),
    Stochastic: backtestVectorized(close, sigStoch, args.capital),
    Ensemble: backtestVectorized(close, sigEnsemble, args.capital),
  };

  console.log(`Vectorized parity run | ${args.ticker} | ${args.start} -> ${args.end}`);
  console.log('Strategy | Return | Sharpe | MaxDD | Trades | WinRate');
  for (const [name, m] of Object.entries(results)) {
    console.log(`${name} | ${m.totalReturn}% | ${m.sharpe} | ${m.maxDrawdown}% | ${m.trades} | ${m.winRate}%`);
  }
  console.log(`Buy&Hold benchmark: ${(Object.values(results)[0]?.benchmarkReturn ?? 0)}%`);

  const strategyMap: Record<string, Signal[]> = {
    'MACD Crossover': sigMacd,
    'EMA Crossover': sigEma,
    'RSI Mean Reversion': sigRsi,
    'Bollinger Bands': sigBb,
    Stochastic: sigStoch,
    Ensemble: sigEnsemble,
  };
  if (args.strategyDetails && strategyMap[args.strategyDetails]) {
    const episodes = buildTradeEpisodes(dates, close, strategyMap[args.strategyDetails]);
    console.log(`\n${args.strategyDetails} trade episodes (${episodes.length})`);
    for (const ep of episodes) {
      const sign = ep.pnlPct >= 0 ? '+' : '';
      console.log(
        `${ep.entryDate} -> ${ep.exitDate} | ${ep.side} | entry ${ep.entryPrice.toFixed(2)} | exit ${ep.exitPrice.toFixed(2)} | pnl ${sign}${ep.pnlPct.toFixed(2)}%`,
      );
    }
    if (args.episodesCsv) {
      const csvPath = path.isAbsolute(args.episodesCsv)
        ? args.episodesCsv
        : path.join(process.cwd(), args.episodesCsv);
      const header = 'entry_date,exit_date,side,entry_price,exit_price,pnl_pct\n';
      const rows = episodes.map(
        (ep) =>
          `${ep.entryDate},${ep.exitDate},${ep.side},${ep.entryPrice.toFixed(4)},${ep.exitPrice.toFixed(4)},${ep.pnlPct.toFixed(4)}`,
      );
      await mkdir(path.dirname(csvPath), { recursive: true });
      await writeFile(csvPath, header + rows.join('\n') + '\n', 'utf8');
      console.log(`Episodes CSV saved: ${path.relative(process.cwd(), csvPath)}`);
    }
  }

  const outDir = path.join(process.cwd(), '.dexter', 'signal-engine', 'reports');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `vectorized-parity-${args.ticker}-${args.start}-${args.end}.json`,
  );
  await writeFile(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), args, results },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Saved: ${path.relative(process.cwd(), outPath)}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Vectorized parity failed: ${message}`);
  process.exit(1);
});
