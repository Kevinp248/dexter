import {
  fetchCashFlowStatements,
  fetchIncomeStatements,
  fetchKeyRatios,
} from '../../data/market.js';
import { SIGNAL_CONFIG } from '../../signal-engine/config.js';
import { AnalysisContext } from './types.js';

type MethodResult = {
  value: number;
  gap: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  details: string;
};

export interface ValuationSignal {
  ticker: string;
  score: number;
  confidence: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  pitAvailabilityMissing: boolean;
  marketCap: number;
  weightedGap: number;
  context: {
    sector: string;
    fairPeBase: number;
    fairPeAdjusted: number;
    pegGrowthUsed: number | null;
    role: 'context_modifier';
  };
  methods: {
    dcf: MethodResult;
    ownerEarnings: MethodResult;
    multiples: MethodResult;
    residualIncome: MethodResult;
  };
  summary: string;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function growthFromSeries(values: number[]): number {
  if (values.length < 2 || values[values.length - 1] === 0) return 0.03;
  const newest = values[0];
  const oldest = values[values.length - 1];
  if (oldest <= 0 || newest <= 0) return 0.03;
  const years = values.length - 1;
  return clamp(
    (newest / oldest) ** (1 / years) - 1,
    SIGNAL_CONFIG.valuation.growthClampMin,
    SIGNAL_CONFIG.valuation.growthClampMax,
  );
}

function dcfValue(
  lastFcf: number,
  growthRate: number,
  discountRate = SIGNAL_CONFIG.valuation.dcfDiscountRate,
): number {
  if (!Number.isFinite(lastFcf) || lastFcf <= 0) return 0;
  let pv = 0;
  for (let year = 1; year <= 5; year += 1) {
    const projected = lastFcf * (1 + growthRate) ** year;
    pv += projected / (1 + discountRate) ** year;
  }
  const terminalGrowth = Math.min(0.03, growthRate);
  const terminal = (lastFcf * (1 + growthRate) ** 5 * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  return pv + terminal / (1 + discountRate) ** 5;
}

function ownerEarningsValue(netIncome: number, depreciation: number, capex: number, growthRate: number): number {
  const owner = netIncome + depreciation - capex;
  if (!Number.isFinite(owner) || owner <= 0) return 0;
  return (
    dcfValue(owner, growthRate, SIGNAL_CONFIG.valuation.ownerEarningsDiscountRate) *
    SIGNAL_CONFIG.valuation.ownerEarningsMarginOfSafety
  );
}

function asMethod(value: number, marketCap: number, label: string): MethodResult {
  const gap = marketCap > 0 ? (value - marketCap) / marketCap : 0;
  const signal =
    gap > SIGNAL_CONFIG.valuation.gapSignalThreshold
      ? 'bullish'
      : gap < -SIGNAL_CONFIG.valuation.gapSignalThreshold
        ? 'bearish'
        : 'neutral';
  return {
    value,
    gap,
    signal,
    details: `${label}: value $${value.toFixed(0)} vs market cap $${marketCap.toFixed(0)} (gap ${(gap * 100).toFixed(1)}%)`,
  };
}

function normalizeSector(raw?: string): string {
  if (!raw || typeof raw !== 'string') return 'Unknown';
  const normalized = raw.trim();
  if (!normalized) return 'Unknown';
  const entries = Object.keys(SIGNAL_CONFIG.valuation.sectorFairPe);
  const match = entries.find(
    (candidate) => candidate.toLowerCase() === normalized.toLowerCase(),
  );
  return match ?? 'Unknown';
}

function resolveFairPeAssumption(
  sector: string,
  growthInput?: number,
): {
  fairPeBase: number;
  fairPeAdjusted: number;
  pegGrowthUsed: number | null;
} {
  const assumption =
    SIGNAL_CONFIG.valuation.sectorFairPe[sector] ??
    SIGNAL_CONFIG.valuation.sectorFairPe.Unknown;
  const boundedGrowth =
    growthInput === undefined || !Number.isFinite(growthInput)
      ? null
      : clamp(
          growthInput,
          SIGNAL_CONFIG.valuation.pegGrowthMin,
          SIGNAL_CONFIG.valuation.pegGrowthMax,
        );

  if (boundedGrowth === null) {
    return {
      fairPeBase: assumption.baseFairPe,
      fairPeAdjusted: assumption.baseFairPe,
      pegGrowthUsed: null,
    };
  }

  const fairPeAdjusted = clamp(
    assumption.baseFairPe + boundedGrowth * assumption.pegSensitivity,
    assumption.minFairPe,
    assumption.maxFairPe,
  );
  return {
    fairPeBase: assumption.baseFairPe,
    fairPeAdjusted,
    pegGrowthUsed: boundedGrowth,
  };
}

export async function runValuationAnalysis(
  ticker: string,
  context: AnalysisContext = {},
): Promise<ValuationSignal> {
  const range = { asOfDate: context.asOfDate, endDate: context.endDate };
  const [ratios, cashFlows, incomeStatements] = await Promise.all([
    fetchKeyRatios(ticker, range),
    fetchCashFlowStatements(ticker, 8, range),
    fetchIncomeStatements(ticker, 8, range),
  ]);
  const pitAvailabilityMissing =
    Boolean((ratios as Record<string, unknown>).__pitMissingAvailability) ||
    cashFlows.some((row) => Boolean((row as Record<string, unknown>).__pitMissingAvailability)) ||
    incomeStatements.some((row) =>
      Boolean((row as Record<string, unknown>).__pitMissingAvailability),
    );

  const marketCap = asNumber(ratios.market_cap) ?? 0;
  const earningsGrowth = asNumber(ratios.earnings_growth) ?? 0.05;
  const pbRatio = asNumber(ratios.price_to_book_ratio) ?? 3;
  const roe = asNumber(ratios.return_on_equity) ?? 0.1;
  const peRatio = asNumber(ratios.pe_ratio) ?? 20;
  const sector = normalizeSector(
    (context as Record<string, unknown>).sector as string | undefined,
  );

  const fcfHistory = cashFlows
    .map((row) => asNumber(row.free_cash_flow))
    .filter((value): value is number => value !== undefined && value > 0);
  const growthRate =
    fcfHistory.length >= 2
      ? growthFromSeries(fcfHistory)
      : clamp(
          earningsGrowth,
          SIGNAL_CONFIG.valuation.growthClampMin,
          SIGNAL_CONFIG.valuation.growthClampMax,
        );
  const lastFcf = fcfHistory[0] ?? 0;

  const latestIncome = incomeStatements[0] ?? {};
  const netIncome = asNumber(latestIncome.net_income) ?? 0;
  const depreciation = asNumber(latestIncome.depreciation_and_amortization) ?? 0;
  const capex = Math.abs(asNumber(cashFlows[0]?.capital_expenditure) ?? 0);

  const dcf = asMethod(dcfValue(lastFcf, growthRate), marketCap, 'DCF');
  const ownerEarnings = asMethod(
    ownerEarningsValue(
      netIncome,
      depreciation,
      capex,
      clamp(
        earningsGrowth,
        SIGNAL_CONFIG.valuation.ownerGrowthClampMin,
        SIGNAL_CONFIG.valuation.ownerGrowthClampMax,
      ),
    ),
    marketCap,
    'Owner earnings',
  );

  const fairPeContext = resolveFairPeAssumption(sector, earningsGrowth);
  const fairPe = fairPeContext.fairPeAdjusted;
  const multiplesValue = marketCap > 0 && peRatio > 0 ? marketCap * (fairPe / peRatio) : 0;
  const multiples = asMethod(multiplesValue, marketCap, 'Relative multiple');

  const bookValue = marketCap > 0 && pbRatio > 0 ? marketCap / pbRatio : 0;
  const residualIncomeValue =
    bookValue * (1 + roe) * SIGNAL_CONFIG.valuation.residualIncomeGrowthMultiplier;
  const residualIncome = asMethod(residualIncomeValue, marketCap, 'Residual income');

  const weightedGap =
    dcf.gap * SIGNAL_CONFIG.valuation.weights.dcf +
    ownerEarnings.gap * SIGNAL_CONFIG.valuation.weights.ownerEarnings +
    multiples.gap * SIGNAL_CONFIG.valuation.weights.multiples +
    residualIncome.gap * SIGNAL_CONFIG.valuation.weights.residualIncome;
  const score = clamp(weightedGap / SIGNAL_CONFIG.valuation.scoreScale, -1, 1);
  const confidence = clamp(
    Math.abs(weightedGap) / SIGNAL_CONFIG.valuation.scoreScale,
    0,
    1,
  ) * (pitAvailabilityMissing ? 0.85 : 1);
  const signal: ValuationSignal['signal'] =
    weightedGap > SIGNAL_CONFIG.valuation.gapSignalThreshold
      ? 'bullish'
      : weightedGap < -SIGNAL_CONFIG.valuation.gapSignalThreshold
        ? 'bearish'
        : 'neutral';

  const posture =
    weightedGap >= 0.1 ? 'supportive' : weightedGap <= -0.1 ? 'blocker' : 'neutral';

  return {
    ticker,
    score,
    confidence,
    signal,
    pitAvailabilityMissing,
    marketCap,
    weightedGap,
    context: {
      sector,
      fairPeBase: fairPeContext.fairPeBase,
      fairPeAdjusted: fairPeContext.fairPeAdjusted,
      pegGrowthUsed: fairPeContext.pegGrowthUsed,
      role: 'context_modifier',
    },
    methods: {
      dcf,
      ownerEarnings,
      multiples,
      residualIncome,
    },
    summary: pitAvailabilityMissing
      ? `${signal.toUpperCase()} valuation (${posture}) | weighted gap ${(weightedGap * 100).toFixed(1)}% | fair P/E ${fairPe.toFixed(1)} (${sector}) | PIT availability incomplete`
      : `${signal.toUpperCase()} valuation (${posture}) | weighted gap ${(weightedGap * 100).toFixed(1)}% | fair P/E ${fairPe.toFixed(1)} (${sector})`,
  };
}
