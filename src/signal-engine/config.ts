import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface SignalEngineConfig {
  version: string;
  aggregateWeights: {
    technical: number;
    fundamentals: number;
    valuation: number;
    sentiment: number;
  };
  actions: {
    coverScoreThreshold: number;
    coverRiskThreshold: number;
    buyScoreThreshold: number;
    buyRiskThreshold: number;
    sellScoreThreshold: number;
    longExitScoreThreshold: number;
  };
  confidence: {
    scoreWeight: number;
    riskWeight: number;
  };
  technical: {
    trendWeight: number;
    meanReversionWeight: number;
    momentumWeight: number;
    volatilityWeight: number;
    statArbWeight: number;
    signalBullishThreshold: number;
    signalBearishThreshold: number;
    momentumBullishThreshold: number;
    momentumBearishThreshold: number;
    meanReversionZScoreThreshold: number;
    meanReversionBandLow: number;
    meanReversionBandHigh: number;
    statArbZScoreThreshold: number;
    volatilityPercentileLow: number;
    volatilityPercentileHigh: number;
  };
  fundamentals: {
    profitability: {
      roeStrong: number;
      roeWeak: number;
      netMarginStrong: number;
      netMarginWeak: number;
      operatingMarginStrong: number;
      operatingMarginWeak: number;
    };
    growth: {
      revenueStrong: number;
      earningsStrong: number;
      bookValueStrong: number;
      negativeCutoff: number;
    };
    health: {
      currentRatioStrong: number;
      currentRatioWeak: number;
      debtToEquityStrong: number;
      debtToEquityWeak: number;
      fcfConversionStrong: number;
      fcfConversionWeak: number;
    };
    valuationRatios: {
      peStrong: number;
      peWeak: number;
      pbStrong: number;
      pbWeak: number;
      psStrong: number;
      psWeak: number;
    };
    aggregateSignalThreshold: number;
  };
  valuation: {
    growthClampMin: number;
    growthClampMax: number;
    ownerGrowthClampMin: number;
    ownerGrowthClampMax: number;
    dcfDiscountRate: number;
    ownerEarningsDiscountRate: number;
    ownerEarningsMarginOfSafety: number;
    fairPe: number;
    residualIncomeGrowthMultiplier: number;
    weights: {
      dcf: number;
      ownerEarnings: number;
      multiples: number;
      residualIncome: number;
    };
    gapSignalThreshold: number;
    scoreScale: number;
  };
  risk: {
    baseLimit: number;
    lowVolThreshold: number;
    mediumVolThreshold: number;
    highVolThreshold: number;
    minLimitMultiplier: number;
    maxLimitMultiplier: number;
    riskVolScale: number;
    debtPenaltyScale: number;
    correlationBands: {
      veryHigh: number;
      high: number;
      medium: number;
      low: number;
    };
    correlationMultipliers: {
      veryHigh: number;
      high: number;
      medium: number;
      low: number;
      veryLow: number;
    };
    maxAllocationMin: number;
    maxAllocationMax: number;
    volatilityCheckThreshold: number;
    expensivePeThreshold: number;
    concentrationCorrelationThreshold: number;
  };
  execution: {
    confidenceScaleMin: number;
    costMultiplierMin: number;
    costMultiplierMax: number;
    defaultCostMultiplier: number;
    defaultMinimumEdgeAfterCostsBps: number;
    holdingDays: number;
    regionCostBps: {
      US: { spread: number; slippage: number; fee: number; borrowDaily: number };
      CA: { spread: number; slippage: number; fee: number; borrowDaily: number };
    };
    fallbackEstimatedPrice: number;
  };
  portfolio: {
    defaultMaxGrossExposurePct: number;
    defaultMaxSectorExposurePct: number;
  };
  regional: {
    canada: {
      allowedExchanges: string[];
      minAverageDollarVolume20d: number;
      minHistoryBars: number;
    };
  };
}

const BASE_SIGNAL_CONFIG: SignalEngineConfig = {
  version: '1.0.0',
  aggregateWeights: {
    technical: 0.3,
    fundamentals: 0.25,
    valuation: 0.3,
    sentiment: 0.15,
  },
  actions: {
    coverScoreThreshold: 0.15,
    coverRiskThreshold: 0.25,
    buyScoreThreshold: 0.5,
    buyRiskThreshold: 0.35,
    sellScoreThreshold: -0.45,
    longExitScoreThreshold: -0.25,
  },
  confidence: {
    scoreWeight: 70,
    riskWeight: 30,
  },
  technical: {
    trendWeight: 0.25,
    meanReversionWeight: 0.2,
    momentumWeight: 0.25,
    volatilityWeight: 0.15,
    statArbWeight: 0.15,
    signalBullishThreshold: 0.1,
    signalBearishThreshold: -0.1,
    momentumBullishThreshold: 0.03,
    momentumBearishThreshold: -0.03,
    meanReversionZScoreThreshold: 2,
    meanReversionBandLow: 0.2,
    meanReversionBandHigh: 0.8,
    statArbZScoreThreshold: 1.5,
    volatilityPercentileLow: 30,
    volatilityPercentileHigh: 70,
  },
  fundamentals: {
    profitability: {
      roeStrong: 0.15,
      roeWeak: 0.05,
      netMarginStrong: 0.2,
      netMarginWeak: 0.08,
      operatingMarginStrong: 0.15,
      operatingMarginWeak: 0.08,
    },
    growth: {
      revenueStrong: 0.1,
      earningsStrong: 0.1,
      bookValueStrong: 0.1,
      negativeCutoff: 0,
    },
    health: {
      currentRatioStrong: 1.5,
      currentRatioWeak: 1.0,
      debtToEquityStrong: 0.5,
      debtToEquityWeak: 2.0,
      fcfConversionStrong: 0.8,
      fcfConversionWeak: 0.5,
    },
    valuationRatios: {
      peStrong: 25,
      peWeak: 35,
      pbStrong: 3,
      pbWeak: 5,
      psStrong: 5,
      psWeak: 8,
    },
    aggregateSignalThreshold: 0.15,
  },
  valuation: {
    growthClampMin: -0.15,
    growthClampMax: 0.2,
    ownerGrowthClampMin: -0.05,
    ownerGrowthClampMax: 0.12,
    dcfDiscountRate: 0.1,
    ownerEarningsDiscountRate: 0.15,
    ownerEarningsMarginOfSafety: 0.75,
    fairPe: 20,
    residualIncomeGrowthMultiplier: 1.05,
    weights: {
      dcf: 0.35,
      ownerEarnings: 0.35,
      multiples: 0.2,
      residualIncome: 0.1,
    },
    gapSignalThreshold: 0.15,
    scoreScale: 0.3,
  },
  risk: {
    baseLimit: 0.2,
    lowVolThreshold: 0.15,
    mediumVolThreshold: 0.3,
    highVolThreshold: 0.5,
    minLimitMultiplier: 0.25,
    maxLimitMultiplier: 1.25,
    riskVolScale: 0.8,
    debtPenaltyScale: 3,
    correlationBands: {
      veryHigh: 0.8,
      high: 0.6,
      medium: 0.4,
      low: 0.2,
    },
    correlationMultipliers: {
      veryHigh: 0.7,
      high: 0.85,
      medium: 1.0,
      low: 1.05,
      veryLow: 1.1,
    },
    maxAllocationMin: 0.05,
    maxAllocationMax: 0.3,
    volatilityCheckThreshold: 0.45,
    expensivePeThreshold: 40,
    concentrationCorrelationThreshold: 0.75,
  },
  execution: {
    confidenceScaleMin: 0.1,
    costMultiplierMin: 0.25,
    costMultiplierMax: 20,
    defaultCostMultiplier: 1,
    defaultMinimumEdgeAfterCostsBps: 0,
    holdingDays: 5,
    regionCostBps: {
      US: { spread: 5, slippage: 7, fee: 1, borrowDaily: 2 },
      CA: { spread: 7, slippage: 10, fee: 1.5, borrowDaily: 2.5 },
    },
    fallbackEstimatedPrice: 100,
  },
  portfolio: {
    defaultMaxGrossExposurePct: 1.0,
    defaultMaxSectorExposurePct: 0.35,
  },
  regional: {
    canada: {
      allowedExchanges: ['TSX', 'TSXV', 'CSE'],
      minAverageDollarVolume20d: 500_000,
      minHistoryBars: 20,
    },
  },
};

function applyConfigOverrides(
  baseConfig: SignalEngineConfig,
  overrides: Record<string, unknown>,
): SignalEngineConfig {
  const merged = JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>;

  const assign = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const next = target[key];
        const nextObj =
          next && typeof next === 'object' && !Array.isArray(next)
            ? (next as Record<string, unknown>)
            : {};
        target[key] = nextObj;
        assign(nextObj, value as Record<string, unknown>);
        continue;
      }
      if (typeof value === 'number') {
        target[key] = value;
      }
    }
  };

  assign(merged, overrides);
  return merged as unknown as SignalEngineConfig;
}

function loadRuntimeOverrides(): Record<string, unknown> {
  const target = path.join(process.cwd(), '.dexter', 'signal-engine', 'config-overrides.json');
  try {
    const raw = readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // No overrides configured.
  }
  return {};
}

export const SIGNAL_CONFIG: SignalEngineConfig = applyConfigOverrides(
  BASE_SIGNAL_CONFIG,
  loadRuntimeOverrides(),
);
