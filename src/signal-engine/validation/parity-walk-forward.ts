import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildParityMetricsReport, ParityMetricsConfig, ParityMetricsReport } from './parity-metrics.js';
import {
  buildParityValidationReport,
} from './parity-validation.js';
import { ParityValidationConfig } from './parity-models.js';
import {
  buildPurgedWalkForwardFolds,
  validatePurgedWalkForwardFolds,
  WalkForwardConfig,
  WalkForwardFold,
} from './walk-forward.js';

export interface UniverseTickerEntry {
  ticker: string;
  region?: string;
  sector?: string;
  notes?: string;
}

export interface UniverseManifest {
  name: string;
  description?: string;
  survivorshipBiasWarning?: string;
  tickers: UniverseTickerEntry[];
}

export interface ParityWalkForwardConfig {
  manifestPath?: string;
  startDate: string;
  endDate: string;
  walkForward: WalkForwardConfig;
  holdoutStartDate?: string;
  holdoutEndDate?: string;
  parityValidation?: Partial<Omit<ParityValidationConfig, 'tickers' | 'startDate' | 'endDate'>>;
  parityMetrics?: Partial<ParityMetricsConfig>;
}

export interface FoldEvaluationSummary {
  fold: number;
  trainStartDate: string;
  trainEndDate: string;
  testStartDate: string;
  testEndDate: string;
  purgeDates: string[];
  embargoDates: string[];
  validationRows: number;
  validationWarnings: string[];
  metrics: ParityMetricsReport;
}

export interface HoldoutEvaluationSummary {
  startDate: string;
  endDate: string;
  validationRows: number;
  validationWarnings: string[];
  metrics: ParityMetricsReport;
}

export interface ParityWalkForwardReport {
  generatedAt: string;
  mode: 'evaluation_only';
  universe: {
    manifestPath: string;
    manifestName: string;
    tickers: UniverseTickerEntry[];
    tickerCount: number;
    survivorshipBiasWarning: string;
  };
  dateWindow: {
    startDate: string;
    endDate: string;
  };
  walkForward: {
    config: Required<WalkForwardConfig>;
    folds: Array<{
      fold: number;
      trainStartDate: string;
      trainEndDate: string;
      testStartDate: string;
      testEndDate: string;
      purgeDates: string[];
      embargoDates: string[];
    }>;
    foldEvaluations: FoldEvaluationSummary[];
  };
  holdout: HoldoutEvaluationSummary | null;
  warnings: string[];
}

interface ParityWalkForwardDependencies {
  loadManifestFn?: (manifestPath: string) => Promise<UniverseManifest>;
  buildParityValidationReportFn?: typeof buildParityValidationReport;
  buildParityMetricsReportFn?: typeof buildParityMetricsReport;
  nowFn?: () => Date;
  orderedDatesFn?: (startDate: string, endDate: string) => string[];
}

const DEFAULT_MANIFEST_PATH = path.join(
  process.cwd(),
  'src',
  'signal-engine',
  'validation',
  'universes',
  'liquid-us-ca.sample.json',
);

function asDateOnly(value: string): string {
  return value.slice(0, 10);
}

function validateHoldoutWindow(
  mainEndDate: string,
  holdoutStartDate?: string,
  holdoutEndDate?: string,
): { hasHoldout: boolean; startDate: string | null; endDate: string | null } {
  const hasStart = typeof holdoutStartDate === 'string' && holdoutStartDate.trim().length > 0;
  const hasEnd = typeof holdoutEndDate === 'string' && holdoutEndDate.trim().length > 0;

  if (hasStart !== hasEnd) {
    throw new Error('Holdout window requires both holdoutStartDate and holdoutEndDate.');
  }
  if (!hasStart && !hasEnd) {
    return { hasHoldout: false, startDate: null, endDate: null };
  }

  const startDate = asDateOnly(holdoutStartDate as string);
  const endDate = asDateOnly(holdoutEndDate as string);
  const normalizedMainEndDate = asDateOnly(mainEndDate);

  if (startDate > endDate) {
    throw new Error(
      `Invalid holdout window: holdoutStartDate (${startDate}) must be <= holdoutEndDate (${endDate}).`,
    );
  }
  if (startDate <= normalizedMainEndDate) {
    throw new Error(
      `Invalid holdout window: holdoutStartDate (${startDate}) must be after walk-forward endDate (${normalizedMainEndDate}).`,
    );
  }

  return { hasHoldout: true, startDate, endDate };
}

function normalizeWalkForwardConfig(config: WalkForwardConfig): Required<WalkForwardConfig> {
  return {
    initialTrainSize: config.initialTrainSize,
    testSize: config.testSize,
    stepSize: config.stepSize ?? config.testSize,
    purgeSize: config.purgeSize ?? 0,
    embargoSize: config.embargoSize ?? 0,
    maxFolds: config.maxFolds ?? Number.MAX_SAFE_INTEGER,
  };
}

function buildWeekdayDates(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${asDateOnly(startDate)}T00:00:00.000Z`);
  const end = new Date(`${asDateOnly(endDate)}T00:00:00.000Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function validateUniverseManifest(manifest: UniverseManifest): UniverseManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Universe manifest must be a JSON object.');
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('Universe manifest requires a non-empty "name".');
  }
  if (!Array.isArray(manifest.tickers) || manifest.tickers.length === 0) {
    throw new Error('Universe manifest requires a non-empty "tickers" array.');
  }
  const seen = new Set<string>();
  const tickers = manifest.tickers.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Universe ticker at index ${index} is invalid.`);
    }
    const ticker = String(item.ticker ?? '').trim().toUpperCase();
    if (!ticker) throw new Error(`Universe ticker at index ${index} is missing "ticker".`);
    if (seen.has(ticker)) throw new Error(`Universe manifest contains duplicate ticker "${ticker}".`);
    seen.add(ticker);
    return {
      ticker,
      region: typeof item.region === 'string' ? item.region : undefined,
      sector: typeof item.sector === 'string' ? item.sector : undefined,
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    };
  });
  return {
    name: manifest.name,
    description: manifest.description,
    survivorshipBiasWarning: manifest.survivorshipBiasWarning,
    tickers,
  };
}

export async function loadUniverseManifest(manifestPath = DEFAULT_MANIFEST_PATH): Promise<UniverseManifest> {
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as UniverseManifest;
  return validateUniverseManifest(parsed);
}

function foldMetadataWithDates(
  fold: WalkForwardFold,
  orderedDates: string[],
): {
  fold: number;
  trainStartDate: string;
  trainEndDate: string;
  testStartDate: string;
  testEndDate: string;
  purgeDates: string[];
  embargoDates: string[];
} {
  return {
    fold: fold.fold,
    trainStartDate: fold.trainDates[0] ?? '',
    trainEndDate: fold.trainDates[fold.trainDates.length - 1] ?? '',
    testStartDate: fold.testDates[0] ?? '',
    testEndDate: fold.testDates[fold.testDates.length - 1] ?? '',
    purgeDates: fold.purgeIndices.map((index) => orderedDates[index]).filter(Boolean),
    embargoDates: fold.embargoIndices.map((index) => orderedDates[index]).filter(Boolean),
  };
}

export async function runParityWalkForwardValidation(
  config: ParityWalkForwardConfig,
  deps: ParityWalkForwardDependencies = {},
): Promise<ParityWalkForwardReport> {
  const manifestPath = config.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const loadManifest = deps.loadManifestFn ?? loadUniverseManifest;
  const buildParityValidation = deps.buildParityValidationReportFn ?? buildParityValidationReport;
  const buildMetrics = deps.buildParityMetricsReportFn ?? buildParityMetricsReport;
  const now = deps.nowFn ?? (() => new Date());
  const orderedDatesFactory = deps.orderedDatesFn ?? buildWeekdayDates;

  const manifest = await loadManifest(manifestPath);
  const normalizedManifest = validateUniverseManifest(manifest);
  const resolvedWalkForward = normalizeWalkForwardConfig(config.walkForward);
  const holdoutWindow = validateHoldoutWindow(
    config.endDate,
    config.holdoutStartDate,
    config.holdoutEndDate,
  );

  const warnings = new Set<string>();
  const survivorshipBiasWarning =
    normalizedManifest.survivorshipBiasWarning ??
    'Survivorship-bias warning: fixed universe manifests are not survivorship-free.';
  warnings.add(survivorshipBiasWarning);
  warnings.add('Evaluation-only protocol: outputs are for validation and not execution PnL or trading instructions.');

  const orderedDates = orderedDatesFactory(config.startDate, config.endDate)
    .map(asDateOnly)
    .sort((a, b) => a.localeCompare(b));
  const folds = buildPurgedWalkForwardFolds(orderedDates, resolvedWalkForward);
  const foldValidation = validatePurgedWalkForwardFolds(folds);
  if (!foldValidation.isValid) {
    for (const issue of foldValidation.issues) warnings.add(issue);
  }
  if (!folds.length) {
    warnings.add('No walk-forward folds were generated for the provided date range/config.');
  }

  const foldEvaluations: FoldEvaluationSummary[] = [];
  for (const fold of folds) {
    const testStartDate = fold.testDates[0];
    const testEndDate = fold.testDates[fold.testDates.length - 1];
    if (!testStartDate || !testEndDate) continue;

    const validationReport = await buildParityValidation({
      ...(config.parityValidation ?? {}),
      tickers: normalizedManifest.tickers.map((item) => item.ticker),
      startDate: testStartDate,
      endDate: testEndDate,
    });
    const metrics = buildMetrics(validationReport, config.parityMetrics);
    for (const warning of validationReport.warnings) warnings.add(`[fold ${fold.fold}] ${warning}`);
    for (const warning of metrics.warnings) warnings.add(`[fold ${fold.fold}] ${warning}`);

    const baseMeta = foldMetadataWithDates(fold, orderedDates);
    foldEvaluations.push({
      ...baseMeta,
      validationRows: validationReport.summary.rows,
      validationWarnings: validationReport.warnings.slice().sort((a, b) => a.localeCompare(b)),
      metrics,
    });
  }

  let holdout: HoldoutEvaluationSummary | null = null;
  if (holdoutWindow.hasHoldout) {
    const holdoutStartDate = holdoutWindow.startDate as string;
    const holdoutEndDate = holdoutWindow.endDate as string;
    const holdoutValidation = await buildParityValidation({
      ...(config.parityValidation ?? {}),
      tickers: normalizedManifest.tickers.map((item) => item.ticker),
      startDate: holdoutStartDate,
      endDate: holdoutEndDate,
    });
    const holdoutMetrics = buildMetrics(holdoutValidation, config.parityMetrics);
    for (const warning of holdoutValidation.warnings) warnings.add(`[holdout] ${warning}`);
    for (const warning of holdoutMetrics.warnings) warnings.add(`[holdout] ${warning}`);
    holdout = {
      startDate: holdoutStartDate,
      endDate: holdoutEndDate,
      validationRows: holdoutValidation.summary.rows,
      validationWarnings: holdoutValidation.warnings.slice().sort((a, b) => a.localeCompare(b)),
      metrics: holdoutMetrics,
    };
  }

  return {
    generatedAt: now().toISOString(),
    mode: 'evaluation_only',
    universe: {
      manifestPath,
      manifestName: normalizedManifest.name,
      tickers: normalizedManifest.tickers.slice().sort((a, b) => a.ticker.localeCompare(b.ticker)),
      tickerCount: normalizedManifest.tickers.length,
      survivorshipBiasWarning,
    },
    dateWindow: {
      startDate: asDateOnly(config.startDate),
      endDate: asDateOnly(config.endDate),
    },
    walkForward: {
      config: resolvedWalkForward,
      folds: folds
        .map((fold) => foldMetadataWithDates(fold, orderedDates))
        .sort((a, b) => a.fold - b.fold),
      foldEvaluations: foldEvaluations.sort((a, b) => a.fold - b.fold),
    },
    holdout,
    warnings: Array.from(warnings).sort((a, b) => a.localeCompare(b)),
  };
}

export async function persistParityWalkForwardReport(
  report: ParityWalkForwardReport,
): Promise<{ jsonPath: string }> {
  const dir = path.join(process.cwd(), '.dexter', 'signal-engine', 'validation');
  await mkdir(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(
    dir,
    `parity-walk-forward-${report.dateWindow.startDate}-${report.dateWindow.endDate}-${stamp}.json`,
  );
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  return { jsonPath };
}

export { DEFAULT_MANIFEST_PATH };
