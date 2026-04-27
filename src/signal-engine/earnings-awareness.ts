import { SIGNAL_CONFIG } from './config.js';
import { EarningsRiskAssessment, SignalAction } from './models.js';

export interface EarningsPolicyInput {
  action: SignalAction;
  asOfDate: string;
  nextEarningsDate: string | null;
  config?: {
    enabled?: boolean;
    blackoutTradingDays?: number;
    missingCoveragePolicy?: 'warn_only' | 'suppress_buy';
    maxCoverageAgeDays?: number;
  };
}

export interface EarningsPolicyResult {
  action: SignalAction;
  assessment: EarningsRiskAssessment;
}

function parseDateOnly(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const dt = new Date(`${date}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isTradingDay(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function tradingDaysBetween(startDate: string, endDate: string): number {
  if (startDate === endDate) return isTradingDay(startDate) ? 0 : 1;
  if (startDate > endDate) return -tradingDaysBetween(endDate, startDate);
  let cursor = startDate;
  let days = 0;
  while (cursor < endDate) {
    cursor = addDays(cursor, 1);
    if (isTradingDay(cursor)) days += 1;
  }
  return days;
}

export function applyEarningsPolicy(input: EarningsPolicyInput): EarningsPolicyResult {
  const resolvedConfig = {
    enabled: input.config?.enabled ?? SIGNAL_CONFIG.earnings.enabled,
    blackoutTradingDays:
      input.config?.blackoutTradingDays ?? SIGNAL_CONFIG.earnings.blackoutTradingDays,
    missingCoveragePolicy:
      input.config?.missingCoveragePolicy ?? SIGNAL_CONFIG.earnings.missingCoveragePolicy,
    maxCoverageAgeDays:
      input.config?.maxCoverageAgeDays ?? SIGNAL_CONFIG.earnings.maxCoverageAgeDays,
  };
  const asOfDate = parseDateOnly(input.asOfDate) ?? new Date().toISOString().slice(0, 10);
  const nextEarningsDate = parseDateOnly(input.nextEarningsDate);

  if (!resolvedConfig.enabled) {
    return {
      action: input.action,
      assessment: {
        nextEarningsDate,
        tradingDaysToEarnings: null,
        coverageStatus: nextEarningsDate ? 'covered' : 'missing',
        inBlackoutWindow: false,
        policyApplied: 'none',
        reasonCode: 'EARNINGS_POLICY_DISABLED',
      },
    };
  }

  if (!nextEarningsDate) {
    const shouldSuppress =
      input.action === 'BUY' && resolvedConfig.missingCoveragePolicy === 'suppress_buy';
    return {
      action: shouldSuppress ? 'HOLD' : input.action,
      assessment: {
        nextEarningsDate: null,
        tradingDaysToEarnings: null,
        coverageStatus: 'missing',
        inBlackoutWindow: false,
        policyApplied: shouldSuppress ? 'buy_suppressed_to_hold_missing_coverage' : 'warn_only',
        reasonCode: shouldSuppress
          ? 'EARNINGS_MISSING_COVERAGE_SUPPRESSED'
          : 'EARNINGS_COVERAGE_WARN',
      },
    };
  }

  const tradingDaysToEarnings = tradingDaysBetween(asOfDate, nextEarningsDate);
  const calendarDaysToEarnings = Math.floor(
    (Date.parse(`${nextEarningsDate}T00:00:00.000Z`) - Date.parse(`${asOfDate}T00:00:00.000Z`)) /
      86_400_000,
  );
  const isStale =
    calendarDaysToEarnings < 0 &&
    Math.abs(calendarDaysToEarnings) > resolvedConfig.maxCoverageAgeDays;
  const inBlackoutWindow =
    !isStale &&
    tradingDaysToEarnings >= 0 &&
    tradingDaysToEarnings <= resolvedConfig.blackoutTradingDays;

  if (input.action === 'BUY' && inBlackoutWindow) {
    return {
      action: 'HOLD',
      assessment: {
        nextEarningsDate,
        tradingDaysToEarnings,
        coverageStatus: 'covered',
        inBlackoutWindow,
        policyApplied: 'buy_suppressed_to_hold_blackout',
        reasonCode: 'EARNINGS_BLACKOUT_BUY_SUPPRESSED',
      },
    };
  }

  if (isStale) {
    const shouldSuppress =
      input.action === 'BUY' && resolvedConfig.missingCoveragePolicy === 'suppress_buy';
    return {
      action: shouldSuppress ? 'HOLD' : input.action,
      assessment: {
        nextEarningsDate,
        tradingDaysToEarnings,
        coverageStatus: 'stale',
        inBlackoutWindow: false,
        policyApplied: shouldSuppress ? 'buy_suppressed_to_hold_missing_coverage' : 'warn_only',
        reasonCode: shouldSuppress
          ? 'EARNINGS_MISSING_COVERAGE_SUPPRESSED'
          : 'EARNINGS_COVERAGE_STALE',
      },
    };
  }

  return {
    action: input.action,
    assessment: {
      nextEarningsDate,
      tradingDaysToEarnings,
      coverageStatus: 'covered',
      inBlackoutWindow,
      policyApplied: 'none',
      reasonCode: 'EARNINGS_COVERAGE_OK',
    },
  };
}
