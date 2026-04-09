import { WatchlistEntry } from '../watchlists/watchlists.js';
import { SIGNAL_CONFIG } from './config.js';
import {
  PortfolioConstraintEvaluation,
  ScanOptions,
  SignalAction,
} from './models.js';

type ConstraintInputs = {
  action: SignalAction;
  watchlist: WatchlistEntry;
  notionalUsd: number;
  portfolioValue: number;
  options: ScanOptions;
};

function isAddingExposure(action: SignalAction): boolean {
  return action === 'BUY';
}

export function evaluatePortfolioConstraints(
  inputs: ConstraintInputs,
): PortfolioConstraintEvaluation {
  const blockedReasons: string[] = [];
  const portfolioContext = inputs.options.portfolioContext;
  const currentGross = portfolioContext?.grossExposurePct ?? 0;
  const currentSector =
    portfolioContext?.sectorExposurePct?.[inputs.watchlist.sector] ?? 0;
  const maxGross =
    portfolioContext?.maxGrossExposurePct ??
    SIGNAL_CONFIG.portfolio.defaultMaxGrossExposurePct;
  const maxSector =
    portfolioContext?.maxSectorExposurePct ??
    SIGNAL_CONFIG.portfolio.defaultMaxSectorExposurePct;

  const tradeExposurePct =
    inputs.portfolioValue > 0 ? inputs.notionalUsd / inputs.portfolioValue : 0;
  const projectedGrossExposurePct = isAddingExposure(inputs.action)
    ? currentGross + tradeExposurePct
    : currentGross;
  const projectedSectorExposurePct = isAddingExposure(inputs.action)
    ? currentSector + tradeExposurePct
    : currentSector;

  if (isAddingExposure(inputs.action) && projectedGrossExposurePct > maxGross) {
    blockedReasons.push(
      `Projected gross exposure ${(projectedGrossExposurePct * 100).toFixed(
        1,
      )}% exceeds cap ${(maxGross * 100).toFixed(1)}%`,
    );
  }
  if (isAddingExposure(inputs.action) && projectedSectorExposurePct > maxSector) {
    blockedReasons.push(
      `Projected sector exposure (${inputs.watchlist.sector}) ${(
        projectedSectorExposurePct * 100
      ).toFixed(1)}% exceeds cap ${(maxSector * 100).toFixed(1)}%`,
    );
  }

  return {
    isAllowed: blockedReasons.length === 0,
    blockedReasons,
    projectedGrossExposurePct,
    projectedSectorExposurePct,
  };
}
