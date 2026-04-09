import { fetchKeyRatios } from '../../data/market.js';
import { SIGNAL_CONFIG } from '../../signal-engine/config.js';
import { AnalysisContext } from './types.js';

type PillarSignal = {
  signal: 'bullish' | 'bearish' | 'neutral';
  score: number;
  details: string;
};

export interface FundamentalSignal {
  ticker: string;
  score: number;
  confidence: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  metrics: {
    peRatio?: number;
    pbRatio?: number;
    psRatio?: number;
    roe?: number;
    netMargin?: number;
    operatingMargin?: number;
    revenueGrowth?: number;
    earningsGrowth?: number;
    bookValueGrowth?: number;
    currentRatio?: number;
    debtToEquity?: number;
    freeCashFlowPerShare?: number;
    earningsPerShare?: number;
  };
  pillars: {
    profitability: PillarSignal;
    growth: PillarSignal;
    health: PillarSignal;
    valuationRatios: PillarSignal;
  };
  summary: string;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function ratioText(label: string, value?: number, asPercent = false): string {
  if (value === undefined) return `${label}: N/A`;
  if (asPercent) return `${label}: ${(value * 100).toFixed(1)}%`;
  return `${label}: ${value.toFixed(2)}`;
}

function scoreFromCounts(
  positiveCount: number,
  negativeCount: number,
): Pick<PillarSignal, 'signal' | 'score'> {
  if (positiveCount > negativeCount) return { signal: 'bullish', score: 1 };
  if (negativeCount > positiveCount) return { signal: 'bearish', score: -1 };
  return { signal: 'neutral', score: 0 };
}

export async function runFundamentalAnalysis(
  ticker: string,
  context: AnalysisContext = {},
): Promise<FundamentalSignal> {
  const ratios = await fetchKeyRatios(ticker, {
    asOfDate: context.asOfDate,
    endDate: context.endDate,
  });

  const metrics: FundamentalSignal['metrics'] = {
    peRatio: asNumber(ratios.pe_ratio),
    pbRatio: asNumber(ratios.price_to_book_ratio),
    psRatio: asNumber(ratios.price_to_sales_ratio),
    roe: asNumber(ratios.return_on_equity),
    netMargin: asNumber(ratios.net_margin),
    operatingMargin: asNumber(ratios.operating_margin),
    revenueGrowth: asNumber(ratios.revenue_growth),
    earningsGrowth: asNumber(ratios.earnings_growth),
    bookValueGrowth: asNumber(ratios.book_value_growth),
    currentRatio: asNumber(ratios.current_ratio),
    debtToEquity: asNumber(ratios.debt_to_equity),
    freeCashFlowPerShare: asNumber(ratios.free_cash_flow_per_share),
    earningsPerShare: asNumber(ratios.earnings_per_share),
  };

  const profitabilityPositive = [
    (metrics.roe ?? -1) > SIGNAL_CONFIG.fundamentals.profitability.roeStrong,
    (metrics.netMargin ?? -1) >
      SIGNAL_CONFIG.fundamentals.profitability.netMarginStrong,
    (metrics.operatingMargin ?? -1) >
      SIGNAL_CONFIG.fundamentals.profitability.operatingMarginStrong,
  ].filter(Boolean).length;
  const profitabilityNegative = [
    metrics.roe !== undefined &&
      metrics.roe <= SIGNAL_CONFIG.fundamentals.profitability.roeWeak,
    metrics.netMargin !== undefined &&
      metrics.netMargin <= SIGNAL_CONFIG.fundamentals.profitability.netMarginWeak,
    metrics.operatingMargin !== undefined &&
      metrics.operatingMargin <=
        SIGNAL_CONFIG.fundamentals.profitability.operatingMarginWeak,
  ].filter(Boolean).length;
  const profitabilityScore = scoreFromCounts(profitabilityPositive, profitabilityNegative);

  const growthPositive = [
    (metrics.revenueGrowth ?? -1) > SIGNAL_CONFIG.fundamentals.growth.revenueStrong,
    (metrics.earningsGrowth ?? -1) >
      SIGNAL_CONFIG.fundamentals.growth.earningsStrong,
    (metrics.bookValueGrowth ?? -1) >
      SIGNAL_CONFIG.fundamentals.growth.bookValueStrong,
  ].filter(Boolean).length;
  const growthNegative = [
    metrics.revenueGrowth !== undefined &&
      metrics.revenueGrowth < SIGNAL_CONFIG.fundamentals.growth.negativeCutoff,
    metrics.earningsGrowth !== undefined &&
      metrics.earningsGrowth < SIGNAL_CONFIG.fundamentals.growth.negativeCutoff,
    metrics.bookValueGrowth !== undefined &&
      metrics.bookValueGrowth < SIGNAL_CONFIG.fundamentals.growth.negativeCutoff,
  ].filter(Boolean).length;
  const growthScore = scoreFromCounts(growthPositive, growthNegative);

  let healthPositive = 0;
  let healthNegative = 0;
  if (metrics.currentRatio !== undefined) {
    if (metrics.currentRatio > SIGNAL_CONFIG.fundamentals.health.currentRatioStrong)
      healthPositive += 1;
    if (metrics.currentRatio < SIGNAL_CONFIG.fundamentals.health.currentRatioWeak)
      healthNegative += 1;
  }
  if (metrics.debtToEquity !== undefined) {
    if (metrics.debtToEquity < SIGNAL_CONFIG.fundamentals.health.debtToEquityStrong)
      healthPositive += 1;
    if (metrics.debtToEquity > SIGNAL_CONFIG.fundamentals.health.debtToEquityWeak)
      healthNegative += 1;
  }
  if (
    metrics.freeCashFlowPerShare !== undefined &&
    metrics.earningsPerShare !== undefined &&
    metrics.earningsPerShare > 0
  ) {
    if (
      metrics.freeCashFlowPerShare >
      metrics.earningsPerShare * SIGNAL_CONFIG.fundamentals.health.fcfConversionStrong
    )
      healthPositive += 1;
    if (
      metrics.freeCashFlowPerShare <
      metrics.earningsPerShare * SIGNAL_CONFIG.fundamentals.health.fcfConversionWeak
    )
      healthNegative += 1;
  }
  const healthScore = scoreFromCounts(healthPositive, healthNegative);

  let valuationPositive = 0;
  let valuationNegative = 0;
  if (metrics.peRatio !== undefined) {
    if (metrics.peRatio <= SIGNAL_CONFIG.fundamentals.valuationRatios.peStrong)
      valuationPositive += 1;
    if (metrics.peRatio > SIGNAL_CONFIG.fundamentals.valuationRatios.peWeak)
      valuationNegative += 1;
  }
  if (metrics.pbRatio !== undefined) {
    if (metrics.pbRatio <= SIGNAL_CONFIG.fundamentals.valuationRatios.pbStrong)
      valuationPositive += 1;
    if (metrics.pbRatio > SIGNAL_CONFIG.fundamentals.valuationRatios.pbWeak)
      valuationNegative += 1;
  }
  if (metrics.psRatio !== undefined) {
    if (metrics.psRatio <= SIGNAL_CONFIG.fundamentals.valuationRatios.psStrong)
      valuationPositive += 1;
    if (metrics.psRatio > SIGNAL_CONFIG.fundamentals.valuationRatios.psWeak)
      valuationNegative += 1;
  }
  const valuationScore = scoreFromCounts(valuationPositive, valuationNegative);

  const pillars = {
    profitability: {
      ...profitabilityScore,
      details: [
        ratioText('ROE', metrics.roe, true),
        ratioText('Net Margin', metrics.netMargin, true),
        ratioText('Operating Margin', metrics.operatingMargin, true),
      ].join(', '),
    },
    growth: {
      ...growthScore,
      details: [
        ratioText('Revenue Growth', metrics.revenueGrowth, true),
        ratioText('Earnings Growth', metrics.earningsGrowth, true),
        ratioText('Book Value Growth', metrics.bookValueGrowth, true),
      ].join(', '),
    },
    health: {
      ...healthScore,
      details: [
        ratioText('Current Ratio', metrics.currentRatio),
        ratioText('Debt/Equity', metrics.debtToEquity),
      ].join(', '),
    },
    valuationRatios: {
      ...valuationScore,
      details: [
        ratioText('P/E', metrics.peRatio),
        ratioText('P/B', metrics.pbRatio),
        ratioText('P/S', metrics.psRatio),
      ].join(', '),
    },
  };

  const score = (pillars.profitability.score + pillars.growth.score + pillars.health.score + pillars.valuationRatios.score) / 4;
  const confidence = Math.abs(score);
  const signal: FundamentalSignal['signal'] =
    score > SIGNAL_CONFIG.fundamentals.aggregateSignalThreshold
      ? 'bullish'
      : score < -SIGNAL_CONFIG.fundamentals.aggregateSignalThreshold
        ? 'bearish'
        : 'neutral';

  return {
    ticker,
    score,
    confidence,
    signal,
    metrics,
    pillars,
    summary: `${signal.toUpperCase()} fundamentals | score ${score.toFixed(2)}`,
  };
}
