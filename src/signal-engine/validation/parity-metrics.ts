import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ForwardReturnLabel,
  ParityValidationReport,
  ParityValidationRow,
} from './parity-models.js';

export type ValidationHorizon = '1d' | '5d' | '10d' | '20d';

export interface NumericSummary {
  count: number;
  mean: number | null;
  median: number | null;
}

export interface DirectionalSummary extends NumericSummary {
  positiveHitRate: number | null;
}

export interface LabelAvailabilitySummary {
  horizon: ValidationHorizon;
  totalRows: number;
  closeToCloseLabelCount: number;
  directionalAfterCostsLabelCount: number;
  directionalAfterCostsExcludedCount: number;
}

export interface ActionHorizonMetricsRow {
  horizon: ValidationHorizon;
  finalAction: string;
  rowCount: number;
  closeToClose: NumericSummary;
  directionalAfterCosts: DirectionalSummary;
}

export interface BucketCalibrationRow {
  bucket: string;
  rowCount: number;
  directionalSampleCount: number;
  directionalAfterCostsMean: number | null;
  directionalPositiveHitRate: number | null;
}

export interface RegimeAttributionRow {
  regimeState: string;
  horizon: ValidationHorizon;
  rowCount: number;
  directionalSampleCount: number;
  directionalAfterCostsMean: number | null;
  directionalPositiveHitRate: number | null;
}

export interface SectorAttributionSummary {
  available: boolean;
  deferredReason: string | null;
  rowsBySector: Array<{ sector: string; rowCount: number }>;
}

export interface QualityAttributionSummary {
  qualityGuardSuppressedCount: number;
  qualityGuardReasonCounts: Array<{ reason: string; count: number }>;
  rowsWithFallbackCount: number;
  fallbackEventCountTotal: number;
  dataCompletenessStatusCounts: Array<{ status: string; count: number }>;
  missingCriticalFieldCounts: Array<{ field: string; count: number }>;
}

export interface ParityMetricsConfig {
  smallSampleWarningThreshold: number;
  confidenceBuckets: number[];
  aggregateScoreBuckets: number[];
}

export interface ParityMetricsReport {
  generatedAt: string;
  sourceGeneratedAt: string;
  sourceRows: number;
  sourceWarningsCount: number;
  notes: string[];
  config: ParityMetricsConfig;
  rowCountsByFinalAction: Array<{ finalAction: string; count: number }>;
  labelAvailabilityByHorizon: LabelAvailabilitySummary[];
  returnsByActionAndHorizon: ActionHorizonMetricsRow[];
  confidenceBucketCalibration: BucketCalibrationRow[];
  aggregateScoreBucketCalibration: BucketCalibrationRow[];
  regimeAttribution: RegimeAttributionRow[];
  sectorAttribution: SectorAttributionSummary;
  qualityAttribution: QualityAttributionSummary;
  warnings: string[];
}

const DEFAULT_CONFIG: ParityMetricsConfig = {
  smallSampleWarningThreshold: 20,
  confidenceBuckets: [20, 40, 60, 80],
  aggregateScoreBuckets: [-0.6, -0.2, 0.2, 0.6],
};

const HORIZONS: Array<{ name: ValidationHorizon; select: (row: ParityValidationRow) => ForwardReturnLabel }> = [
  { name: '1d', select: (row) => row.forward1d },
  { name: '5d', select: (row) => row.forward5d },
  { name: '10d', select: (row) => row.forward10d },
  { name: '20d', select: (row) => row.forward20d },
];
const HORIZON_ORDER: Record<ValidationHorizon, number> = {
  '1d': 0,
  '5d': 1,
  '10d': 2,
  '20d': 3,
};

function compareHorizon(a: ValidationHorizon, b: ValidationHorizon): number {
  return HORIZON_ORDER[a] - HORIZON_ORDER[b];
}

function round(value: number, digits = 8): number {
  return Number(value.toFixed(digits));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numericSummary(values: number[]): NumericSummary {
  return {
    count: values.length,
    mean: values.length ? round(mean(values) as number) : null,
    median: values.length ? round(median(values) as number) : null,
  };
}

function directionalSummary(values: number[]): DirectionalSummary {
  if (!values.length) {
    return {
      count: 0,
      mean: null,
      median: null,
      positiveHitRate: null,
    };
  }
  const hits = values.filter((value) => value > 0).length;
  return {
    count: values.length,
    mean: round(mean(values) as number),
    median: round(median(values) as number),
    positiveHitRate: round(hits / values.length, 6),
  };
}

function formatBucketLabel(
  lowerExclusive: number | null,
  upperInclusive: number | null,
): string {
  if (lowerExclusive === null && upperInclusive !== null) {
    return `(-inf,${upperInclusive}]`;
  }
  if (lowerExclusive !== null && upperInclusive === null) {
    return `(${lowerExclusive},inf)`;
  }
  return `(${lowerExclusive},${upperInclusive}]`;
}

function bucketIndex(value: number, boundaries: number[]): number {
  for (let i = 0; i < boundaries.length; i += 1) {
    if (value <= boundaries[i]) return i;
  }
  return boundaries.length;
}

function sortedCounts<K extends string>(
  map: Map<K, number>,
  keyName: string,
): Array<{ [k: string]: string | number }> {
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ [keyName]: key, count }));
}

function toCsvCell(value: string | number | boolean | null): string {
  const str = value === null ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowsToCsv<T extends Record<string, string | number | boolean | null>>(
  rows: T[],
  headers: string[],
): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => toCsvCell(row[header] ?? null)).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function collectWarningsForSmallSamples(
  rows: Array<{ rowCount: number; horizon: ValidationHorizon; finalAction?: string }>,
  threshold: number,
): string[] {
  const warnings: string[] = [];
  for (const row of rows) {
    if (row.rowCount > 0 && row.rowCount < threshold) {
      const action = row.finalAction ? ` (${row.finalAction})` : '';
      warnings.push(
        `Small sample warning: horizon ${row.horizon}${action} has ${row.rowCount} rows (< ${threshold}).`,
      );
    }
  }
  return warnings;
}

export function buildParityMetricsReport(
  validationReport: ParityValidationReport,
  config: Partial<ParityMetricsConfig> = {},
): ParityMetricsReport {
  const resolved: ParityMetricsConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const rows = validationReport.rows;
  const notes = [
    'closeToCloseReturnPct is used for neutral market movement analysis.',
    'directionalReturnAfterCostsPct is used for action-quality analysis only when label availability is true.',
    'Directional labels are validation labels and are not execution PnL.',
  ];
  const warnings = new Set<string>();
  if (!rows.length) warnings.add('No validation rows available. Metrics were generated with empty inputs.');

  const actionCounts = new Map<string, number>();
  for (const row of rows) {
    actionCounts.set(row.finalAction, (actionCounts.get(row.finalAction) ?? 0) + 1);
  }
  const rowCountsByFinalAction = sortedCounts(actionCounts, 'finalAction') as Array<{
    finalAction: string;
    count: number;
  }>;

  const returnsByActionAndHorizon: ActionHorizonMetricsRow[] = [];
  const labelAvailabilityByHorizon: LabelAvailabilitySummary[] = [];
  const regimeAttributionRows: RegimeAttributionRow[] = [];

  const allRegimes = Array.from(new Set(rows.map((row) => row.regimeState))).sort((a, b) =>
    a.localeCompare(b),
  );
  const allActions = Array.from(actionCounts.keys()).sort((a, b) => a.localeCompare(b));

  for (const horizon of HORIZONS) {
    const labels = rows.map((row) => horizon.select(row));
    const closeToCloseLabelCount = labels.filter((label) => label.isLabelAvailable).length;
    const directionalAfterCostsLabelCount = labels.filter(
      (label) => label.isDirectionalAfterCostsLabelAvailable,
    ).length;
    labelAvailabilityByHorizon.push({
      horizon: horizon.name,
      totalRows: rows.length,
      closeToCloseLabelCount,
      directionalAfterCostsLabelCount,
      directionalAfterCostsExcludedCount: rows.length - directionalAfterCostsLabelCount,
    });

    for (const action of allActions) {
      const actionRows = rows.filter((row) => row.finalAction === action);
      const closeToCloseValues = actionRows
        .map((row) => horizon.select(row).closeToCloseReturnPct)
        .filter((value): value is number => value !== null);
      const directionalValues = actionRows
        .map((row) => {
          const label = horizon.select(row);
          if (!label.isDirectionalAfterCostsLabelAvailable) return null;
          return label.directionalReturnAfterCostsPct;
        })
        .filter((value): value is number => value !== null);

      returnsByActionAndHorizon.push({
        horizon: horizon.name,
        finalAction: action,
        rowCount: actionRows.length,
        closeToClose: numericSummary(closeToCloseValues),
        directionalAfterCosts: directionalSummary(directionalValues),
      });
    }

    for (const regime of allRegimes) {
      const regimeRows = rows.filter((row) => row.regimeState === regime);
      const directionalValues = regimeRows
        .map((row) => {
          const label = horizon.select(row);
          if (!label.isDirectionalAfterCostsLabelAvailable) return null;
          return label.directionalReturnAfterCostsPct;
        })
        .filter((value): value is number => value !== null);
      regimeAttributionRows.push({
        regimeState: regime,
        horizon: horizon.name,
        rowCount: regimeRows.length,
        directionalSampleCount: directionalValues.length,
        directionalAfterCostsMean: directionalValues.length ? round(mean(directionalValues) as number) : null,
        directionalPositiveHitRate:
          directionalValues.length
            ? round(directionalValues.filter((value) => value > 0).length / directionalValues.length, 6)
            : null,
      });
    }
  }

  warningsForUnavailableDirectional(rows, HORIZONS, warnings);
  for (const warning of collectWarningsForSmallSamples(returnsByActionAndHorizon, resolved.smallSampleWarningThreshold)) {
    warnings.add(warning);
  }

  const confidenceBucketCalibration = buildCalibrationRows(
    rows,
    resolved.confidenceBuckets,
    (row) => row.confidence,
    HORIZONS[0].select,
  );
  const aggregateScoreBucketCalibration = buildCalibrationRows(
    rows,
    resolved.aggregateScoreBuckets,
    (row) => row.aggregateScore,
    HORIZONS[0].select,
  );

  const sectorValues = rows
    .map((row) => (row as ParityValidationRow & { sector?: unknown }).sector)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const sectorAttribution: SectorAttributionSummary = sectorValues.length
    ? {
        available: true,
        deferredReason: null,
        rowsBySector: (
          sortedCounts(
            sectorValues.reduce((map, sector) => {
              map.set(sector, (map.get(sector) ?? 0) + 1);
              return map;
            }, new Map<string, number>()),
            'sector',
          ) as Array<{ sector: string; count: number }>
        ).map((row) => ({
          sector: row.sector,
          rowCount: row.count,
        })),
      }
    : {
        available: false,
        deferredReason: 'Sector attribution deferred: validation rows do not include sector metadata.',
        rowsBySector: [],
      };
  if (!sectorAttribution.available && sectorAttribution.deferredReason) {
    warnings.add(sectorAttribution.deferredReason);
  }

  const qualityGuardReasonCounts = new Map<string, number>();
  const dataCompletenessStatusCounts = new Map<string, number>();
  const missingCriticalFieldCounts = new Map<string, number>();
  let rowsWithFallbackCount = 0;
  let fallbackEventCountTotal = 0;
  let qualityGuardSuppressedCount = 0;
  for (const row of rows) {
    if (row.qualityGuardSuppressed) qualityGuardSuppressedCount += 1;
    if (row.qualityGuardReason) {
      qualityGuardReasonCounts.set(
        row.qualityGuardReason,
        (qualityGuardReasonCounts.get(row.qualityGuardReason) ?? 0) + 1,
      );
    }
    if (row.fallbackHadFallback) rowsWithFallbackCount += 1;
    fallbackEventCountTotal += row.fallbackEventCount;
    dataCompletenessStatusCounts.set(
      row.dataCompletenessStatus,
      (dataCompletenessStatusCounts.get(row.dataCompletenessStatus) ?? 0) + 1,
    );
    for (const missingField of row.dataCompletenessMissingCritical) {
      missingCriticalFieldCounts.set(
        missingField,
        (missingCriticalFieldCounts.get(missingField) ?? 0) + 1,
      );
    }
  }

  const qualityAttribution: QualityAttributionSummary = {
    qualityGuardSuppressedCount,
    qualityGuardReasonCounts: sortedCounts(qualityGuardReasonCounts, 'reason') as Array<{
      reason: string;
      count: number;
    }>,
    rowsWithFallbackCount,
    fallbackEventCountTotal,
    dataCompletenessStatusCounts: sortedCounts(
      dataCompletenessStatusCounts,
      'status',
    ) as Array<{ status: string; count: number }>,
    missingCriticalFieldCounts: sortedCounts(
      missingCriticalFieldCounts,
      'field',
    ) as Array<{ field: string; count: number }>,
  };

  for (const bucket of confidenceBucketCalibration) {
    if (bucket.rowCount > 0 && bucket.rowCount < resolved.smallSampleWarningThreshold) {
      warnings.add(
        `Small sample warning: confidence bucket ${bucket.bucket} has ${bucket.rowCount} rows (< ${resolved.smallSampleWarningThreshold}).`,
      );
    }
  }
  for (const bucket of aggregateScoreBucketCalibration) {
    if (bucket.rowCount > 0 && bucket.rowCount < resolved.smallSampleWarningThreshold) {
      warnings.add(
        `Small sample warning: aggregate score bucket ${bucket.bucket} has ${bucket.rowCount} rows (< ${resolved.smallSampleWarningThreshold}).`,
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: validationReport.generatedAt,
    sourceRows: rows.length,
    sourceWarningsCount: validationReport.warnings.length,
    notes,
    config: resolved,
    rowCountsByFinalAction,
    labelAvailabilityByHorizon,
    returnsByActionAndHorizon: returnsByActionAndHorizon.sort((a, b) => {
      if (a.horizon !== b.horizon) return compareHorizon(a.horizon, b.horizon);
      return a.finalAction.localeCompare(b.finalAction);
    }),
    confidenceBucketCalibration,
    aggregateScoreBucketCalibration,
    regimeAttribution: regimeAttributionRows.sort((a, b) => {
      if (a.horizon !== b.horizon) return compareHorizon(a.horizon, b.horizon);
      return a.regimeState.localeCompare(b.regimeState);
    }),
    sectorAttribution,
    qualityAttribution,
    warnings: Array.from(warnings).sort((a, b) => a.localeCompare(b)),
  };
}

function warningsForUnavailableDirectional(
  rows: ParityValidationRow[],
  horizons: Array<{ name: ValidationHorizon; select: (row: ParityValidationRow) => ForwardReturnLabel }>,
  warnings: Set<string>,
): void {
  for (const horizon of horizons) {
    const total = rows.length;
    const available = rows.filter((row) => horizon.select(row).isDirectionalAfterCostsLabelAvailable).length;
    if (total > 0 && available === 0) {
      warnings.add(`No directional after-cost labels available for horizon ${horizon.name}.`);
    }
  }
}

function buildCalibrationRows(
  rows: ParityValidationRow[],
  boundaries: number[],
  valueSelector: (row: ParityValidationRow) => number,
  horizonSelector: (row: ParityValidationRow) => ForwardReturnLabel,
): BucketCalibrationRow[] {
  const bucketRows = new Map<number, ParityValidationRow[]>();
  for (let i = 0; i <= boundaries.length; i += 1) {
    bucketRows.set(i, []);
  }
  for (const row of rows) {
    const idx = bucketIndex(valueSelector(row), boundaries);
    bucketRows.get(idx)?.push(row);
  }

  const out: BucketCalibrationRow[] = [];
  for (let i = 0; i <= boundaries.length; i += 1) {
    const lower = i === 0 ? null : boundaries[i - 1];
    const upper = i === boundaries.length ? null : boundaries[i];
    const bucket = bucketRows.get(i) ?? [];
    const directionalValues = bucket
      .map((row) => {
        const label = horizonSelector(row);
        if (!label.isDirectionalAfterCostsLabelAvailable) return null;
        return label.directionalReturnAfterCostsPct;
      })
      .filter((value): value is number => value !== null);
    out.push({
      bucket: formatBucketLabel(lower, upper),
      rowCount: bucket.length,
      directionalSampleCount: directionalValues.length,
      directionalAfterCostsMean: directionalValues.length ? round(mean(directionalValues) as number) : null,
      directionalPositiveHitRate:
        directionalValues.length
          ? round(directionalValues.filter((value) => value > 0).length / directionalValues.length, 6)
          : null,
    });
  }
  return out;
}

export async function readParityValidationReport(jsonPath: string): Promise<ParityValidationReport> {
  const content = await readFile(jsonPath, 'utf8');
  const parsed = JSON.parse(content) as ParityValidationReport;
  if (!parsed || !Array.isArray(parsed.rows) || typeof parsed.generatedAt !== 'string') {
    throw new Error('Invalid parity validation report JSON.');
  }
  return parsed;
}

export async function persistParityMetricsReport(
  report: ParityMetricsReport,
  validationReport: ParityValidationReport,
): Promise<{
  jsonPath: string;
  actionSummaryCsvPath: string;
  calibrationCsvPath: string;
  regimeCsvPath: string;
}> {
  const dir = path.join(process.cwd(), '.dexter', 'signal-engine', 'validation');
  await mkdir(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const suffix = `${validationReport.config.startDate}-${validationReport.config.endDate}-${validationReport.config.tickers.join('_')}`;
  const jsonPath = path.join(dir, `parity-metrics-${suffix}-${stamp}.json`);
  const actionSummaryCsvPath = path.join(dir, `parity-metrics-actions-${suffix}-${stamp}.csv`);
  const calibrationCsvPath = path.join(dir, `parity-metrics-calibration-${suffix}-${stamp}.csv`);
  const regimeCsvPath = path.join(dir, `parity-metrics-regime-${suffix}-${stamp}.csv`);

  const actionRows = report.returnsByActionAndHorizon.map((row) => ({
    horizon: row.horizon,
    finalAction: row.finalAction,
    rowCount: row.rowCount,
    closeToCloseCount: row.closeToClose.count,
    closeToCloseMean: row.closeToClose.mean,
    closeToCloseMedian: row.closeToClose.median,
    directionalAfterCostsCount: row.directionalAfterCosts.count,
    directionalAfterCostsMean: row.directionalAfterCosts.mean,
    directionalAfterCostsMedian: row.directionalAfterCosts.median,
    directionalPositiveHitRate: row.directionalAfterCosts.positiveHitRate,
  }));
  const calibrationRows = [
    ...report.confidenceBucketCalibration.map((row) => ({
      metric: 'confidence',
      bucket: row.bucket,
      rowCount: row.rowCount,
      directionalSampleCount: row.directionalSampleCount,
      directionalAfterCostsMean: row.directionalAfterCostsMean,
      directionalPositiveHitRate: row.directionalPositiveHitRate,
    })),
    ...report.aggregateScoreBucketCalibration.map((row) => ({
      metric: 'aggregateScore',
      bucket: row.bucket,
      rowCount: row.rowCount,
      directionalSampleCount: row.directionalSampleCount,
      directionalAfterCostsMean: row.directionalAfterCostsMean,
      directionalPositiveHitRate: row.directionalPositiveHitRate,
    })),
  ];
  const regimeRows = report.regimeAttribution.map((row) => ({
    regimeState: row.regimeState,
    horizon: row.horizon,
    rowCount: row.rowCount,
    directionalSampleCount: row.directionalSampleCount,
    directionalAfterCostsMean: row.directionalAfterCostsMean,
    directionalPositiveHitRate: row.directionalPositiveHitRate,
  }));

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(
    actionSummaryCsvPath,
    rowsToCsv(actionRows, [
      'horizon',
      'finalAction',
      'rowCount',
      'closeToCloseCount',
      'closeToCloseMean',
      'closeToCloseMedian',
      'directionalAfterCostsCount',
      'directionalAfterCostsMean',
      'directionalAfterCostsMedian',
      'directionalPositiveHitRate',
    ]),
    'utf8',
  );
  await writeFile(
    calibrationCsvPath,
    rowsToCsv(calibrationRows, [
      'metric',
      'bucket',
      'rowCount',
      'directionalSampleCount',
      'directionalAfterCostsMean',
      'directionalPositiveHitRate',
    ]),
    'utf8',
  );
  await writeFile(
    regimeCsvPath,
    rowsToCsv(regimeRows, [
      'regimeState',
      'horizon',
      'rowCount',
      'directionalSampleCount',
      'directionalAfterCostsMean',
      'directionalPositiveHitRate',
    ]),
    'utf8',
  );

  return { jsonPath, actionSummaryCsvPath, calibrationCsvPath, regimeCsvPath };
}
