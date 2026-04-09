import { fetchKeyRatios } from '../../data/market.js';

export interface FundamentalSignal {
  ticker: string;
  score: number;
  metrics: {
    peRatio?: number;
    roe?: number;
    debtToEquity?: number;
  };
  summary: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalize(value: number, thresh: number): number {
  return value / thresh;
}

export async function runFundamentalAnalysis(ticker: string): Promise<FundamentalSignal> {
  const ratios = await fetchKeyRatios(ticker);
  const peRatio = typeof ratios.pe_ratio === 'number' ? ratios.pe_ratio : undefined;
  const roe = typeof ratios.return_on_equity === 'number' ? ratios.return_on_equity : undefined;
  const debtToEquity = typeof ratios.debt_to_equity === 'number' ? ratios.debt_to_equity : undefined;

  let score = 0;
  if (typeof peRatio === 'number') {
    if (peRatio <= 20) score += 0.4;
    else if (peRatio >= 35) score -= 0.4;
    else score += normalize(30 - peRatio, 10) * 0.2;
  }
  if (typeof roe === 'number') {
    score += normalize(roe, 20) * 0.4;
  }
  if (typeof debtToEquity === 'number') {
    if (debtToEquity <= 1) score += 0.3;
    else score -= normalize(debtToEquity - 1, 2) * 0.3;
  }

  const normalized = clamp(score, -1, 1);
  const summaryParts: string[] = [];
  if (peRatio !== undefined) summaryParts.push(`P/E ${peRatio.toFixed(1)}`);
  if (roe !== undefined) summaryParts.push(`ROE ${roe.toFixed(1)}%`);
  if (debtToEquity !== undefined) summaryParts.push(`D/E ${debtToEquity.toFixed(2)}`);
  const summary = summaryParts.length ? summaryParts.join(' · ') : 'Fundamental data unavailable';

  return {
    ticker,
    score: normalized,
    metrics: { peRatio, roe, debtToEquity },
    summary,
  };
}
