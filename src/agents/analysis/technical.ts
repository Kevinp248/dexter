import { fetchHistoricalPrices } from '../../data/market.js';

type SubSignal = {
  signal: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  score: number;
  metrics: Record<string, number>;
};

export interface TechnicalSignal {
  ticker: string;
  score: number;
  confidence: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  volatility: number;
  bars: { date: string; close: number }[];
  returns: number[];
  summary: string;
  subSignals: {
    trend: SubSignal;
    meanReversion: SubSignal;
    momentum: SubSignal;
    volatility: SubSignal;
    statArb: SubSignal;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = average(values.map((v) => (v - mean) ** 2));
  return Math.sqrt(variance);
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out = alpha * values[i] + (1 - alpha) * out;
  }
  return out;
}

function returnsFromCloses(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(curr)) {
      out.push(curr / prev - 1);
    }
  }
  return out;
}

function rsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  const window = closes.slice(-(period + 1));
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < window.length; i += 1) {
    const change = window[i] - window[i - 1];
    if (change >= 0) gains.push(change);
    else losses.push(Math.abs(change));
  }
  const avgGain = average(gains);
  const avgLoss = average(losses);
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function signalToScore(signal: 'bullish' | 'bearish' | 'neutral', confidence: number): number {
  if (signal === 'bullish') return confidence;
  if (signal === 'bearish') return -confidence;
  return 0;
}

function calculateTrendSignal(closes: number[], highs: number[], lows: number[]): SubSignal {
  const ema8 = ema(closes, 8);
  const ema21 = ema(closes, 21);
  const ema55 = ema(closes, 55);

  const upMoves: number[] = [];
  const downMoves: number[] = [];
  const trValues: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    upMoves.push(upMove > downMove && upMove > 0 ? upMove : 0);
    downMoves.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trValues.push(tr);
  }
  const period = 14;
  const tr14 = average(trValues.slice(-period));
  const plusDM14 = average(upMoves.slice(-period));
  const minusDM14 = average(downMoves.slice(-period));
  const plusDI = tr14 ? (plusDM14 / tr14) * 100 : 0;
  const minusDI = tr14 ? (minusDM14 / tr14) * 100 : 0;
  const dx = plusDI + minusDI ? (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100 : 0;
  const confidence = clamp(dx / 100, 0, 1);

  let signal: SubSignal['signal'] = 'neutral';
  if (ema8 > ema21 && ema21 > ema55) signal = 'bullish';
  else if (ema8 < ema21 && ema21 < ema55) signal = 'bearish';

  return {
    signal,
    confidence: signal === 'neutral' ? 0.5 : confidence,
    score: signalToScore(signal, signal === 'neutral' ? 0.5 : confidence),
    metrics: { ema8, ema21, ema55, adxProxy: dx },
  };
}

function calculateMeanReversionSignal(closes: number[]): SubSignal {
  const lookback = 50;
  if (closes.length < lookback) {
    return {
      signal: 'neutral',
      confidence: 0.5,
      score: 0,
      metrics: { zScore: 0, priceVsBb: 0.5, rsi14: 50, rsi28: 50 },
    };
  }

  const recent = closes.slice(-lookback);
  const ma50 = average(recent);
  const sd50 = stdDev(recent) || 1;
  const zScore = (closes[closes.length - 1] - ma50) / sd50;
  const bbUpper = ma50 + 2 * sd50;
  const bbLower = ma50 - 2 * sd50;
  const priceVsBb = (closes[closes.length - 1] - bbLower) / (bbUpper - bbLower || 1);
  const rsi14 = rsi(closes, 14);
  const rsi28 = rsi(closes, 28);

  let signal: SubSignal['signal'] = 'neutral';
  let confidence = 0.5;
  if (zScore < -2 && priceVsBb < 0.2) {
    signal = 'bullish';
    confidence = clamp(Math.abs(zScore) / 4, 0, 1);
  } else if (zScore > 2 && priceVsBb > 0.8) {
    signal = 'bearish';
    confidence = clamp(Math.abs(zScore) / 4, 0, 1);
  }

  return {
    signal,
    confidence,
    score: signalToScore(signal, confidence),
    metrics: { zScore, priceVsBb, rsi14, rsi28 },
  };
}

function calculateMomentumSignal(closes: number[], volumes: number[]): SubSignal {
  const return21 = closes.length > 21 ? closes[closes.length - 1] / closes[closes.length - 22] - 1 : 0;
  const return63 = closes.length > 63 ? closes[closes.length - 1] / closes[closes.length - 64] - 1 : 0;
  const return126 = closes.length > 126 ? closes[closes.length - 1] / closes[closes.length - 127] - 1 : 0;
  const weightedMomentum = return21 * 0.5 + return63 * 0.3 + return126 * 0.2;

  const recentVol = average(volumes.slice(-21));
  const pastVol = average(volumes.slice(-63, -21));
  const volumeMomentum = pastVol > 0 ? recentVol / pastVol - 1 : 0;

  let signal: SubSignal['signal'] = 'neutral';
  if (weightedMomentum > 0.03) signal = 'bullish';
  else if (weightedMomentum < -0.03) signal = 'bearish';

  const confidence = clamp(Math.abs(weightedMomentum) * 10 + Math.max(volumeMomentum, 0), 0, 1);
  return {
    signal,
    confidence: signal === 'neutral' ? 0.5 : confidence,
    score: signalToScore(signal, signal === 'neutral' ? 0.5 : confidence),
    metrics: { return21, return63, return126, weightedMomentum, volumeMomentum },
  };
}

function calculateVolatilitySignal(closes: number[]): SubSignal {
  const rets = returnsFromCloses(closes);
  const recent = rets.slice(-21);
  const recentVol = stdDev(recent) * Math.sqrt(252);
  const rolling: number[] = [];
  for (let i = 21; i <= rets.length; i += 1) {
    rolling.push(stdDev(rets.slice(i - 21, i)) * Math.sqrt(252));
  }
  const percentile = rolling.length
    ? (rolling.filter((v) => v <= recentVol).length / rolling.length) * 100
    : 50;

  let signal: SubSignal['signal'] = 'neutral';
  if (percentile < 30) signal = 'bullish';
  else if (percentile > 70) signal = 'bearish';
  const confidence = clamp(Math.abs(percentile - 50) / 50, 0, 1);

  return {
    signal,
    confidence,
    score: signalToScore(signal, confidence),
    metrics: { annualizedVolatility: recentVol, volatilityPercentile: percentile },
  };
}

function calculateStatArbSignal(closes: number[]): SubSignal {
  const window = closes.slice(-30);
  const mean = average(window);
  const sd = stdDev(window) || 1;
  const zScore = (closes[closes.length - 1] - mean) / sd;
  let signal: SubSignal['signal'] = 'neutral';
  if (zScore < -1.5) signal = 'bullish';
  else if (zScore > 1.5) signal = 'bearish';
  const confidence = clamp(Math.abs(zScore) / 3, 0, 1);
  return {
    signal,
    confidence,
    score: signalToScore(signal, confidence),
    metrics: { zScore },
  };
}

export async function runTechnicalAnalysis(ticker: string): Promise<TechnicalSignal> {
  const history = await fetchHistoricalPrices(ticker, 220);
  const closes = history.map((bar) => bar.close).filter(Number.isFinite);
  const highs = history.map((bar) => bar.high).filter(Number.isFinite);
  const lows = history.map((bar) => bar.low).filter(Number.isFinite);
  const volumes = history.map((bar) => bar.volume).filter(Number.isFinite);
  const returns = returnsFromCloses(closes);
  const annualizedVolatility = stdDev(returns.slice(-21)) * Math.sqrt(252);

  const trend = calculateTrendSignal(closes, highs, lows);
  const meanReversion = calculateMeanReversionSignal(closes);
  const momentum = calculateMomentumSignal(closes, volumes);
  const volatility = calculateVolatilitySignal(closes);
  const statArb = calculateStatArbSignal(closes);

  const weightedScore =
    trend.score * 0.25 +
    meanReversion.score * 0.2 +
    momentum.score * 0.25 +
    volatility.score * 0.15 +
    statArb.score * 0.15;
  const score = clamp(weightedScore, -1, 1);
  const confidence = clamp(Math.abs(score), 0, 1);

  let signal: TechnicalSignal['signal'] = 'neutral';
  if (score > 0.1) signal = 'bullish';
  else if (score < -0.1) signal = 'bearish';

  return {
    ticker,
    score,
    confidence,
    signal,
    volatility: annualizedVolatility,
    bars: history.map((bar) => ({ date: bar.date, close: bar.close })),
    returns,
    summary: `Trend ${trend.signal}, Momentum ${momentum.signal}, score ${score.toFixed(2)}`,
    subSignals: {
      trend,
      meanReversion,
      momentum,
      volatility,
      statArb,
    },
  };
}
