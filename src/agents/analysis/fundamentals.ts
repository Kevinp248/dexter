import { fetchKeyRatios } from '../../data/market.js';
import { SIGNAL_CONFIG } from '../../signal-engine/config.js';
import { AnalysisContext } from './types.js';

type PillarSignal = {
  signal: 'bullish' | 'bearish' | 'neutral';
  score: number;
  details: string;
};

type MetricThreshold = {
  strong: number;
  weak: number;
};

type ScoredMetric = {
  label: string;
  value?: number;
  score: number | null;
  asPercent?: boolean;
};

export interface FundamentalSignal {
  ticker: string;
  score: number;
  confidence: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  pitAvailabilityMissing: boolean;
  metrics: {
    peRatio?: number;
    pbRatio?: number;
    psRatio?: number;
    roe?: number;
    roic?: number | null;
    nopat?: number | null;
    investedCapital?: number | null;
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
    cashFlowQuality: PillarSignal;
    capitalEfficiency: PillarSignal;
    valuationRatios: PillarSignal;
  };
  summary: string;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ratioText(label: string, value?: number | null, asPercent = false): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return `${label}: N/A`;
  if (asPercent) return `${label}: ${(value * 100).toFixed(1)}%`;
  return `${label}: ${value.toFixed(2)}`;
}

function interpolateHigherIsBetter(
  value: number | undefined,
  threshold: MetricThreshold,
): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (value <= threshold.weak) return -1;
  if (value >= threshold.strong) return 1;
  const span = threshold.strong - threshold.weak;
  if (span <= 0) return null;
  return clamp(((value - threshold.weak) / span) * 2 - 1, -1, 1);
}

function interpolateLowerIsBetter(
  value: number | undefined,
  threshold: MetricThreshold,
): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (value >= threshold.weak) return -1;
  if (value <= threshold.strong) return 1;
  const span = threshold.weak - threshold.strong;
  if (span <= 0) return null;
  return clamp(1 - ((value - threshold.strong) / span) * 2, -1, 1);
}

function average(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  if (!defined.length) return null;
  return defined.reduce((sum, value) => sum + value, 0) / defined.length;
}

function scoreToSignal(score: number): PillarSignal['signal'] {
  if (score > 0.15) return 'bullish';
  if (score < -0.15) return 'bearish';
  return 'neutral';
}

function summarizeMetric(metric: ScoredMetric): string {
  const base = ratioText(metric.label, metric.value, metric.asPercent);
  if (metric.score === null) return base;
  const signed = metric.score >= 0 ? `+${metric.score.toFixed(2)}` : metric.score.toFixed(2);
  return `${base} (${signed})`;
}

function buildPillar(metrics: ScoredMetric[]): PillarSignal {
  const avg = average(metrics.map((metric) => metric.score));
  if (avg === null) {
    return {
      signal: 'neutral',
      score: 0,
      details: metrics.map((metric) => summarizeMetric(metric)).join(', '),
    };
  }
  return {
    signal: scoreToSignal(avg),
    score: clamp(avg, -1, 1),
    details: metrics.map((metric) => summarizeMetric(metric)).join(', '),
  };
}

function selectFirstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function inferTaxRate(record: Record<string, unknown>): number | undefined {
  const explicitTaxRate = selectFirstNumber(record, [
    'effective_tax_rate',
    'tax_rate',
    'income_tax_rate',
  ]);
  if (explicitTaxRate !== undefined) {
    return clamp(explicitTaxRate, 0, 0.5);
  }
  const taxExpense = selectFirstNumber(record, ['income_tax_expense', 'tax_provision']);
  const preTaxIncome = selectFirstNumber(record, ['income_before_tax', 'pretax_income', 'ebt']);
  if (
    taxExpense !== undefined &&
    preTaxIncome !== undefined &&
    Number.isFinite(preTaxIncome) &&
    preTaxIncome > 0
  ) {
    return clamp(taxExpense / preTaxIncome, 0, 0.5);
  }
  return undefined;
}

function computeRoic(
  snapshot: Record<string, unknown>,
): { roic: number | null; nopat: number | null; investedCapital: number | null } {
  const operatingIncome = selectFirstNumber(snapshot, [
    'operating_income',
    'ebit',
    'operatingIncome',
  ]);
  const taxRate = inferTaxRate(snapshot);
  const nopat =
    operatingIncome !== undefined && taxRate !== undefined
      ? operatingIncome * (1 - taxRate)
      : null;

  const explicitInvestedCapital = selectFirstNumber(snapshot, ['invested_capital']);
  const totalDebt = selectFirstNumber(snapshot, [
    'total_debt',
    'short_term_debt',
    'long_term_debt',
  ]);
  const equity = selectFirstNumber(snapshot, [
    'total_equity',
    'shareholders_equity',
    'total_stockholders_equity',
  ]);
  const cash = selectFirstNumber(snapshot, ['cash_and_equivalents', 'cash_and_cash_equivalents', 'cash']);
  const inferredInvestedCapital =
    totalDebt !== undefined && equity !== undefined
      ? totalDebt + equity - (cash ?? 0)
      : null;
  const investedCapital = explicitInvestedCapital ?? inferredInvestedCapital;
  if (
    nopat !== null &&
    investedCapital !== null &&
    Number.isFinite(investedCapital) &&
    investedCapital > 0
  ) {
    return { roic: nopat / investedCapital, nopat, investedCapital };
  }

  const providerRoic = selectFirstNumber(snapshot, ['return_on_invested_capital', 'roic']);
  return {
    roic: providerRoic ?? null,
    nopat,
    investedCapital,
  };
}

export async function runFundamentalAnalysis(
  ticker: string,
  context: AnalysisContext = {},
): Promise<FundamentalSignal> {
  const ratios = await fetchKeyRatios(ticker, {
    asOfDate: context.asOfDate,
    endDate: context.endDate,
  });
  const pitAvailabilityMissing = Boolean(
    (ratios as Record<string, unknown>).__pitMissingAvailability,
  );
  const snapshot = ratios as Record<string, unknown>;
  const roicData = computeRoic(snapshot);

  const metrics: FundamentalSignal['metrics'] = {
    peRatio: asNumber(ratios.pe_ratio),
    pbRatio: asNumber(ratios.price_to_book_ratio),
    psRatio: asNumber(ratios.price_to_sales_ratio),
    roe: asNumber(ratios.return_on_equity),
    roic: roicData.roic,
    nopat: roicData.nopat,
    investedCapital: roicData.investedCapital,
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

  const profitability = buildPillar([
    {
      label: 'ROE',
      value: metrics.roe,
      score: interpolateHigherIsBetter(metrics.roe, {
        strong: SIGNAL_CONFIG.fundamentals.profitability.roeStrong,
        weak: SIGNAL_CONFIG.fundamentals.profitability.roeWeak,
      }),
      asPercent: true,
    },
    {
      label: 'Net Margin',
      value: metrics.netMargin,
      score: interpolateHigherIsBetter(metrics.netMargin, {
        strong: SIGNAL_CONFIG.fundamentals.profitability.netMarginStrong,
        weak: SIGNAL_CONFIG.fundamentals.profitability.netMarginWeak,
      }),
      asPercent: true,
    },
    {
      label: 'Operating Margin',
      value: metrics.operatingMargin,
      score: interpolateHigherIsBetter(metrics.operatingMargin, {
        strong: SIGNAL_CONFIG.fundamentals.profitability.operatingMarginStrong,
        weak: SIGNAL_CONFIG.fundamentals.profitability.operatingMarginWeak,
      }),
      asPercent: true,
    },
  ]);

  const capitalEfficiency = buildPillar([
    {
      label: 'ROIC',
      value: metrics.roic ?? undefined,
      score: interpolateHigherIsBetter(metrics.roic ?? undefined, {
        strong: SIGNAL_CONFIG.fundamentals.profitability.roicStrong,
        weak: SIGNAL_CONFIG.fundamentals.profitability.roicWeak,
      }),
      asPercent: true,
    },
  ]);

  const growth = buildPillar([
    {
      label: 'Revenue Growth',
      value: metrics.revenueGrowth,
      score: interpolateHigherIsBetter(metrics.revenueGrowth, {
        strong: SIGNAL_CONFIG.fundamentals.growth.revenueStrong,
        weak: SIGNAL_CONFIG.fundamentals.growth.negativeCutoff,
      }),
      asPercent: true,
    },
    {
      label: 'Earnings Growth',
      value: metrics.earningsGrowth,
      score: interpolateHigherIsBetter(metrics.earningsGrowth, {
        strong: SIGNAL_CONFIG.fundamentals.growth.earningsStrong,
        weak: SIGNAL_CONFIG.fundamentals.growth.negativeCutoff,
      }),
      asPercent: true,
    },
    {
      label: 'Book Value Growth',
      value: metrics.bookValueGrowth,
      score: interpolateHigherIsBetter(metrics.bookValueGrowth, {
        strong: SIGNAL_CONFIG.fundamentals.growth.bookValueStrong,
        weak: SIGNAL_CONFIG.fundamentals.growth.negativeCutoff,
      }),
      asPercent: true,
    },
  ]);

  const fcfConversion =
    metrics.freeCashFlowPerShare !== undefined &&
    metrics.earningsPerShare !== undefined &&
    Number.isFinite(metrics.earningsPerShare) &&
    metrics.earningsPerShare > 0
      ? metrics.freeCashFlowPerShare / metrics.earningsPerShare
      : undefined;

  const health = buildPillar([
    {
      label: 'Current Ratio',
      value: metrics.currentRatio,
      score: interpolateHigherIsBetter(metrics.currentRatio, {
        strong: SIGNAL_CONFIG.fundamentals.health.currentRatioStrong,
        weak: SIGNAL_CONFIG.fundamentals.health.currentRatioWeak,
      }),
    },
    {
      label: 'Debt/Equity',
      value: metrics.debtToEquity,
      score: interpolateLowerIsBetter(metrics.debtToEquity, {
        strong: SIGNAL_CONFIG.fundamentals.health.debtToEquityStrong,
        weak: SIGNAL_CONFIG.fundamentals.health.debtToEquityWeak,
      }),
    },
  ]);

  const cashFlowQuality = buildPillar([
    {
      label: 'FCF/EPS',
      value: fcfConversion,
      score: interpolateHigherIsBetter(fcfConversion, {
        strong: SIGNAL_CONFIG.fundamentals.cashFlowQuality.fcfConversionStrong,
        weak: SIGNAL_CONFIG.fundamentals.cashFlowQuality.fcfConversionWeak,
      }),
    },
  ]);

  const valuationRatios = buildPillar([
    {
      label: 'P/E',
      value: metrics.peRatio,
      score: interpolateLowerIsBetter(metrics.peRatio, {
        strong: SIGNAL_CONFIG.fundamentals.valuationRatios.peStrong,
        weak: SIGNAL_CONFIG.fundamentals.valuationRatios.peWeak,
      }),
    },
    {
      label: 'P/B',
      value: metrics.pbRatio,
      score: interpolateLowerIsBetter(metrics.pbRatio, {
        strong: SIGNAL_CONFIG.fundamentals.valuationRatios.pbStrong,
        weak: SIGNAL_CONFIG.fundamentals.valuationRatios.pbWeak,
      }),
    },
    {
      label: 'P/S',
      value: metrics.psRatio,
      score: interpolateLowerIsBetter(metrics.psRatio, {
        strong: SIGNAL_CONFIG.fundamentals.valuationRatios.psStrong,
        weak: SIGNAL_CONFIG.fundamentals.valuationRatios.psWeak,
      }),
    },
  ]);

  const pillars: FundamentalSignal['pillars'] = {
    profitability,
    growth,
    health,
    cashFlowQuality,
    capitalEfficiency,
    valuationRatios,
  };

  const weights = SIGNAL_CONFIG.fundamentals.pillarWeights;
  const weightedRaw =
    pillars.profitability.score * weights.profitability +
    pillars.growth.score * weights.growth +
    pillars.health.score * weights.health +
    pillars.cashFlowQuality.score * weights.cashFlowQuality +
    pillars.capitalEfficiency.score * weights.capitalEfficiency +
    pillars.valuationRatios.score * weights.valuationRatios;
  const score = clamp(weightedRaw, -1, 1);
  const signal: FundamentalSignal['signal'] =
    score > SIGNAL_CONFIG.fundamentals.aggregateSignalThreshold
      ? 'bullish'
      : score < -SIGNAL_CONFIG.fundamentals.aggregateSignalThreshold
        ? 'bearish'
        : 'neutral';

  const metricValues = Object.values(metrics);
  const availableMetrics = metricValues.filter(
    (value) => value !== undefined && value !== null && Number.isFinite(value),
  ).length;
  const coverage = clamp(availableMetrics / 15, 0, 1);
  const confidence = clamp(
    (0.55 * Math.abs(score) + 0.45 * coverage) * (pitAvailabilityMissing ? 0.85 : 1),
    0,
    1,
  );

  const topContributors = Object.entries({
    profitability: pillars.profitability.score * weights.profitability,
    growth: pillars.growth.score * weights.growth,
    health: pillars.health.score * weights.health,
    cashFlowQuality: pillars.cashFlowQuality.score * weights.cashFlowQuality,
    capitalEfficiency: pillars.capitalEfficiency.score * weights.capitalEfficiency,
    valuationRatios: pillars.valuationRatios.score * weights.valuationRatios,
  })
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([name, value]) => `${name} ${value >= 0 ? '+' : ''}${value.toFixed(2)}`);

  return {
    ticker,
    score,
    confidence,
    signal,
    pitAvailabilityMissing,
    metrics,
    pillars,
    summary: pitAvailabilityMissing
      ? `${signal.toUpperCase()} fundamentals | score ${score.toFixed(2)} | top ${topContributors.join(', ')} | PIT availability incomplete`
      : `${signal.toUpperCase()} fundamentals | score ${score.toFixed(2)} | top ${topContributors.join(', ')}`,
  };
}
