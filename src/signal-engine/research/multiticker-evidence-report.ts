import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type FeatureConsistencySummary,
  type MultiTickerSeparationReport,
  type SeparationFeature,
  type SeparationHorizon,
} from './multiticker-separation-analysis.js';

export type EvidenceClassification =
  | 'research_candidate'
  | 'watchlist'
  | 'misleading_pooled'
  | 'unstable'
  | 'ticker_specific'
  | 'weak'
  | 'insufficient_data';

export type TrainReadiness = 'no_train' | 'expand_universe' | 'research_only_candidate';

export type FinalEvidenceRecommendation =
  | 'do_not_train'
  | 'expand_universe'
  | 'research_only_candidate_possible';

export interface EvidenceReportThresholds {
  broadAgreementRatio: number;
  minimumStableTickerCount: number;
  tickerSpecificAgreementMax: number;
  nonTrivialPooledSpread: number;
  verySmallPooledSpread: number;
}

export interface FeatureHorizonEvidence {
  feature: SeparationFeature;
  horizon: SeparationHorizon;
  pooledDirection: 'positive' | 'negative' | 'flat' | 'insufficient_data';
  pooledSpread: number | null;
  tickerAgreementCount: number;
  tickerDisagreementCount: number;
  stableTickerCount: number;
  unstableTickerCount: number;
  tickerCountWithSignal: number;
  agreementRatio: number;
  flags: string[];
  classification: EvidenceClassification;
  interpretation: string;
  trainReadiness: TrainReadiness;
}

export interface MultiTickerEvidenceReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'multiticker_evidence_report';
  schemaVersion: 'multiticker_evidence_v1';
  sourceReportType: MultiTickerSeparationReport['reportType'];
  sourceSchemaVersion: MultiTickerSeparationReport['schemaVersion'];
  sourceGeneratedAt: string;
  sourceArtifactPath: string | null;
  thresholds: EvidenceReportThresholds;
  summary: {
    totalFeatureHorizons: number;
    countByClassification: Record<EvidenceClassification, number>;
    topWatchlistCandidates: Array<{ feature: SeparationFeature; horizon: SeparationHorizon; pooledSpread: number | null }>;
    misleadingPooledCandidates: Array<{ feature: SeparationFeature; horizon: SeparationHorizon; pooledSpread: number | null }>;
    finalRecommendation: FinalEvidenceRecommendation;
    notes: string[];
  };
  rows: FeatureHorizonEvidence[];
  warnings: string[];
}

export interface BuildEvidenceReportOptions {
  sourceArtifactPath?: string;
  thresholds?: Partial<EvidenceReportThresholds>;
}

export const DEFAULT_EVIDENCE_THRESHOLDS: EvidenceReportThresholds = {
  broadAgreementRatio: 0.75,
  minimumStableTickerCount: 5,
  tickerSpecificAgreementMax: 0.5,
  nonTrivialPooledSpread: 0.002,
  verySmallPooledSpread: 0.002,
};

const CLASSIFICATIONS: EvidenceClassification[] = [
  'research_candidate',
  'watchlist',
  'misleading_pooled',
  'unstable',
  'ticker_specific',
  'weak',
  'insufficient_data',
];

function signDirection(value: number | null): FeatureHorizonEvidence['pooledDirection'] {
  if (value === null) return 'insufficient_data';
  if (Math.abs(value) < 1e-12) return 'flat';
  return value > 0 ? 'positive' : 'negative';
}

function hasFlag(item: FeatureConsistencySummary, flag: string): boolean {
  return item.instabilityFlags.includes(flag as FeatureConsistencySummary['instabilityFlags'][number]);
}

function classifyEvidence(
  item: FeatureConsistencySummary,
  stableTickerCount: number,
  thresholds: EvidenceReportThresholds,
): EvidenceClassification {
  if (item.pooledSpread === null || item.tickerCountWithSignal === 0 || hasFlag(item, 'insufficient_data')) {
    return 'insufficient_data';
  }

  const hasMismatch = hasFlag(item, 'pooled_sign_differs_majority_ticker_sign');
  const hasWeakSpread = hasFlag(item, 'weak_pooled_spread') || Math.abs(item.pooledSpread) < thresholds.verySmallPooledSpread;
  const hasPooledHalfSignFlip = item.instabilityFlags.includes('pooled_half_sign_flip' as never);
  const hasBroadAgreement =
    item.agreementRatio >= thresholds.broadAgreementRatio &&
    stableTickerCount >= thresholds.minimumStableTickerCount;

  if (hasMismatch) return 'misleading_pooled';

  if (hasBroadAgreement && !hasWeakSpread && !hasPooledHalfSignFlip) {
    return 'research_candidate';
  }

  if (hasBroadAgreement && (hasWeakSpread || hasPooledHalfSignFlip)) {
    return 'watchlist';
  }

  if (hasPooledHalfSignFlip || item.unstableTickerCount >= stableTickerCount) {
    return 'unstable';
  }

  if (
    item.agreementRatio <= thresholds.tickerSpecificAgreementMax &&
    Math.abs(item.pooledSpread) >= thresholds.nonTrivialPooledSpread
  ) {
    return 'ticker_specific';
  }

  if (hasWeakSpread) return 'weak';

  return 'weak';
}

function trainReadinessFor(classification: EvidenceClassification): TrainReadiness {
  if (classification === 'research_candidate') return 'research_only_candidate';
  if (classification === 'watchlist' || classification === 'ticker_specific') return 'expand_universe';
  return 'no_train';
}

function interpretationFor(item: FeatureConsistencySummary, classification: EvidenceClassification): string {
  const direction = signDirection(item.pooledSpread);
  const spreadText = item.pooledSpread === null ? 'no pooled spread' : `pooled ${direction} spread`;
  const agreementText = `${item.agreementWithPooledCount}/${item.tickerCountWithSignal} tickers agree`;
  const stableCount = item.tickerCountWithSignal - item.unstableTickerCount;

  if (classification === 'research_candidate') {
    return `${spreadText}; ${agreementText}, at least ${stableCount} tickers are stable, and no pooled-vs-majority or weak-spread flags were raised.`;
  }
  if (classification === 'watchlist') {
    return `${spreadText}; ticker agreement is broad, but weak spread or pooled half instability keeps this research-only.`;
  }
  if (classification === 'misleading_pooled') {
    return `${spreadText}; the pooled direction disagrees with the majority ticker direction, so the pooled result may hide ticker disagreement.`;
  }
  if (classification === 'unstable') {
    return `${spreadText}; half-split instability or a high unstable-ticker count makes the result unreliable.`;
  }
  if (classification === 'ticker_specific') {
    return `${spreadText}; agreement is low, so the apparent separation is mostly ticker-specific.`;
  }
  if (classification === 'insufficient_data') {
    return 'Insufficient usable pooled or ticker-level signal data for this feature/horizon.';
  }
  return `${spreadText}; spread magnitude is too small or otherwise weak for training readiness.`;
}

function rowFromRanking(
  item: FeatureConsistencySummary,
  thresholds: EvidenceReportThresholds,
): FeatureHorizonEvidence {
  const stableTickerCount = Math.max(0, item.tickerCountWithSignal - item.unstableTickerCount);
  const tickerDisagreementCount = Math.max(0, item.tickerCountWithSignal - item.agreementWithPooledCount);
  const classification = classifyEvidence(item, stableTickerCount, thresholds);

  return {
    feature: item.feature,
    horizon: item.horizon,
    pooledDirection: signDirection(item.pooledSpread),
    pooledSpread: item.pooledSpread,
    tickerAgreementCount: item.agreementWithPooledCount,
    tickerDisagreementCount,
    stableTickerCount,
    unstableTickerCount: item.unstableTickerCount,
    tickerCountWithSignal: item.tickerCountWithSignal,
    agreementRatio: item.agreementRatio,
    flags: item.instabilityFlags,
    classification,
    interpretation: interpretationFor(item, classification),
    trainReadiness: trainReadinessFor(classification),
  };
}

function countByClassification(rows: FeatureHorizonEvidence[]): Record<EvidenceClassification, number> {
  const counts = Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0])) as Record<
    EvidenceClassification,
    number
  >;
  for (const row of rows) {
    counts[row.classification] += 1;
  }
  return counts;
}

function finalRecommendation(rows: FeatureHorizonEvidence[]): FinalEvidenceRecommendation {
  const researchCandidateCount = rows.filter((row) => row.classification === 'research_candidate').length;
  const hasContradictoryEvidence = rows.some(
    (row) => row.classification === 'misleading_pooled' || row.classification === 'unstable',
  );
  if (researchCandidateCount >= 2 && !hasContradictoryEvidence) return 'research_only_candidate_possible';
  if (rows.some((row) => row.classification === 'watchlist' || row.classification === 'ticker_specific')) {
    return 'expand_universe';
  }
  return 'do_not_train';
}

export function buildMultiTickerEvidenceReport(
  separationReport: MultiTickerSeparationReport,
  options: BuildEvidenceReportOptions = {},
): MultiTickerEvidenceReport {
  const thresholds = {
    ...DEFAULT_EVIDENCE_THRESHOLDS,
    ...options.thresholds,
  };

  const ranking = separationReport.featureConsistencyRanking.map((item) => {
    const pooledHalfFlag = separationReport.instabilityFlags.some(
      (flag) =>
        flag.feature === item.feature &&
        flag.horizon === item.horizon &&
        flag.reason === 'pooled_half_sign_flip',
    );
    return pooledHalfFlag && !item.instabilityFlags.includes('pooled_half_sign_flip' as never)
      ? {
          ...item,
          instabilityFlags: [...item.instabilityFlags, 'pooled_half_sign_flip' as never],
        }
      : item;
  });

  const rows = ranking.map((item) => rowFromRanking(item, thresholds));
  const counts = countByClassification(rows);
  const topWatchlistCandidates = rows
    .filter((row) => row.classification === 'watchlist')
    .slice(0, 5)
    .map((row) => ({ feature: row.feature, horizon: row.horizon, pooledSpread: row.pooledSpread }));
  const misleadingPooledCandidates = rows
    .filter((row) => row.classification === 'misleading_pooled')
    .map((row) => ({ feature: row.feature, horizon: row.horizon, pooledSpread: row.pooledSpread }));

  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'multiticker_evidence_report',
    schemaVersion: 'multiticker_evidence_v1',
    sourceReportType: separationReport.reportType,
    sourceSchemaVersion: separationReport.schemaVersion,
    sourceGeneratedAt: separationReport.generatedAt,
    sourceArtifactPath: options.sourceArtifactPath ? path.resolve(options.sourceArtifactPath) : null,
    thresholds,
    summary: {
      totalFeatureHorizons: rows.length,
      countByClassification: counts,
      topWatchlistCandidates,
      misleadingPooledCandidates,
      finalRecommendation: finalRecommendation(rows),
      notes: [
        'Descriptive research only; this report does not train a model or alter production signal behavior.',
        'Evidence classifications are deterministic gates over the separation artifact, not predictive-power claims.',
        'Pooled results can hide ticker disagreement; misleading_pooled rows should not be used as training candidates.',
      ],
    },
    rows,
    warnings: separationReport.warnings,
  };
}

export async function loadMultiTickerSeparationReportFromFile(
  inputPath: string,
): Promise<MultiTickerSeparationReport> {
  const absolute = path.resolve(inputPath);
  return JSON.parse(await readFile(absolute, 'utf8')) as MultiTickerSeparationReport;
}

function defaultOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'research',
    'analysis',
    `multiticker-evidence-${stamp}.json`,
  );
}

export async function persistMultiTickerEvidenceReport(
  report: MultiTickerEvidenceReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
