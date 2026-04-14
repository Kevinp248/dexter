import { SIGNAL_CONFIG } from './config.js';
import { MarketRegimeAssessment } from './models.js';

export interface MarketRegimeInput {
  asOfDate: string;
  spyCloses: number[];
  vixClose: number | null;
  config?: {
    enabled?: boolean;
    strictBuyGateInRiskOff?: boolean;
    buyScoreThresholdAddRiskOff?: number;
    confidenceCapRiskOff?: number;
    maxAllocationMultiplierRiskOff?: number;
    confidenceCapUnknown?: number;
    maxAllocationMultiplierUnknown?: number;
    vixRiskOffThreshold?: number;
    spySmaLookbackDays?: number;
  };
}

export interface MarketRegimePolicyResult {
  assessment: MarketRegimeAssessment;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateMarketRegime(input: MarketRegimeInput): MarketRegimePolicyResult {
  const resolvedConfig = {
    enabled: input.config?.enabled ?? SIGNAL_CONFIG.regime.enabled,
    strictBuyGateInRiskOff:
      input.config?.strictBuyGateInRiskOff ?? SIGNAL_CONFIG.regime.strictBuyGateInRiskOff,
    buyScoreThresholdAddRiskOff:
      input.config?.buyScoreThresholdAddRiskOff ?? SIGNAL_CONFIG.regime.buyScoreThresholdAddRiskOff,
    confidenceCapRiskOff:
      input.config?.confidenceCapRiskOff ?? SIGNAL_CONFIG.regime.confidenceCapRiskOff,
    maxAllocationMultiplierRiskOff:
      input.config?.maxAllocationMultiplierRiskOff ??
      SIGNAL_CONFIG.regime.maxAllocationMultiplierRiskOff,
    confidenceCapUnknown:
      input.config?.confidenceCapUnknown ?? SIGNAL_CONFIG.regime.confidenceCapUnknown,
    maxAllocationMultiplierUnknown:
      input.config?.maxAllocationMultiplierUnknown ??
      SIGNAL_CONFIG.regime.maxAllocationMultiplierUnknown,
    vixRiskOffThreshold:
      input.config?.vixRiskOffThreshold ?? SIGNAL_CONFIG.regime.vixRiskOffThreshold,
    spySmaLookbackDays:
      input.config?.spySmaLookbackDays ?? SIGNAL_CONFIG.regime.spySmaLookbackDays,
  };
  const inputs = {
    asOfDate: input.asOfDate,
    spyClose: null as number | null,
    spySma: null as number | null,
    vixClose: input.vixClose,
    lookbackDays: resolvedConfig.spySmaLookbackDays,
  };

  if (!resolvedConfig.enabled) {
    return {
      assessment: {
        state: 'risk_on',
        reasonCode: 'REGIME_RISK_ON',
        inputs,
        policyAdjustmentsApplied: {
          buyThresholdAdd: 0,
          confidenceCap: null,
          maxAllocationMultiplier: 1,
          strictBuyGate: false,
        },
      },
    };
  }

  if (input.spyCloses.length < resolvedConfig.spySmaLookbackDays) {
    return {
      assessment: {
        state: 'regime_unknown',
        reasonCode: 'REGIME_UNKNOWN_INSUFFICIENT_HISTORY',
        inputs,
        policyAdjustmentsApplied: {
          buyThresholdAdd: 0,
          confidenceCap: resolvedConfig.confidenceCapUnknown,
          maxAllocationMultiplier: clamp(resolvedConfig.maxAllocationMultiplierUnknown, 0.1, 1),
          strictBuyGate: false,
        },
      },
    };
  }

  const lastSpyClose = input.spyCloses[input.spyCloses.length - 1];
  const smaWindow = input.spyCloses.slice(-resolvedConfig.spySmaLookbackDays);
  const spySma = average(smaWindow);
  inputs.spyClose = Number.isFinite(lastSpyClose) ? lastSpyClose : null;
  inputs.spySma = spySma;

  if (inputs.spyClose === null || inputs.spySma === null) {
    return {
      assessment: {
        state: 'regime_unknown',
        reasonCode: 'REGIME_UNKNOWN_MISSING_SPY',
        inputs,
        policyAdjustmentsApplied: {
          buyThresholdAdd: 0,
          confidenceCap: resolvedConfig.confidenceCapUnknown,
          maxAllocationMultiplier: clamp(resolvedConfig.maxAllocationMultiplierUnknown, 0.1, 1),
          strictBuyGate: false,
        },
      },
    };
  }

  if (!Number.isFinite(inputs.vixClose)) {
    return {
      assessment: {
        state: 'regime_unknown',
        reasonCode: 'REGIME_UNKNOWN_MISSING_VIX',
        inputs,
        policyAdjustmentsApplied: {
          buyThresholdAdd: 0,
          confidenceCap: resolvedConfig.confidenceCapUnknown,
          maxAllocationMultiplier: clamp(resolvedConfig.maxAllocationMultiplierUnknown, 0.1, 1),
          strictBuyGate: false,
        },
      },
    };
  }

  const isRiskOff =
    (inputs.spyClose as number) < (inputs.spySma as number) ||
    (inputs.vixClose as number) >= resolvedConfig.vixRiskOffThreshold;
  if (isRiskOff) {
    return {
      assessment: {
        state: 'risk_off',
        reasonCode: 'REGIME_RISK_OFF_SPY_BELOW_SMA_OR_VIX_HIGH',
        inputs,
        policyAdjustmentsApplied: {
          buyThresholdAdd: resolvedConfig.buyScoreThresholdAddRiskOff,
          confidenceCap: resolvedConfig.confidenceCapRiskOff,
          maxAllocationMultiplier: clamp(resolvedConfig.maxAllocationMultiplierRiskOff, 0.1, 1),
          strictBuyGate: resolvedConfig.strictBuyGateInRiskOff,
        },
      },
    };
  }

  return {
    assessment: {
      state: 'risk_on',
      reasonCode: 'REGIME_RISK_ON',
      inputs,
      policyAdjustmentsApplied: {
        buyThresholdAdd: 0,
        confidenceCap: null,
        maxAllocationMultiplier: 1,
        strictBuyGate: false,
      },
    },
  };
}
