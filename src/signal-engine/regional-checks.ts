import type { TechnicalSignal } from '../agents/analysis/technical.js';
import { WatchlistEntry } from '../watchlists/watchlists.js';
import { SIGNAL_CONFIG } from './config.js';
import { RegionalMarketCheck } from './models.js';

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateRegionalMarketCheck(
  watchlistEntry: WatchlistEntry,
  technical: TechnicalSignal,
): RegionalMarketCheck {
  const checks: string[] = [];

  if (watchlistEntry.region !== 'CA') {
    return {
      isTradeableInRegion: true,
      checks: ['No regional restrictions triggered'],
      averageDollarVolume20d: null,
    };
  }

  if (!SIGNAL_CONFIG.regional.canada.allowedExchanges.includes(watchlistEntry.exchange)) {
    checks.push(
      `Exchange ${watchlistEntry.exchange} is not in allowed list (${SIGNAL_CONFIG.regional.canada.allowedExchanges.join(', ')})`,
    );
  }

  if (technical.bars.length < SIGNAL_CONFIG.regional.canada.minHistoryBars) {
    checks.push(
      `Insufficient history bars (${technical.bars.length}) for Canadian liquidity check`,
    );
  }

  const latestBars = technical.bars.slice(-20);
  const dollarVolumes = latestBars
    .map((bar) => bar.close * bar.volume)
    .filter((value) => Number.isFinite(value) && value > 0);
  const averageDollarVolume20d = dollarVolumes.length ? average(dollarVolumes) : 0;
  if (averageDollarVolume20d < SIGNAL_CONFIG.regional.canada.minAverageDollarVolume20d) {
    checks.push(
      `Average 20d dollar volume ${averageDollarVolume20d.toFixed(
        0,
      )} is below threshold ${SIGNAL_CONFIG.regional.canada.minAverageDollarVolume20d}`,
    );
  }

  return {
    isTradeableInRegion: checks.length === 0,
    checks: checks.length ? checks : ['Canadian market checks passed'],
    averageDollarVolume20d,
  };
}
