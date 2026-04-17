import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ReplayAction = 'BUY' | 'SELL' | 'HOLD';
export type ThresholdSetName = 'A' | 'B' | 'C' | 'D';
export type ValuationCaseName = 'saved' | '-0.5' | '-0.25' | '0';

export interface ThresholdSet {
  name: ThresholdSetName;
  buyThreshold: number;
  sellThreshold: number;
}

export interface OfflinePolicyReviewConfig {
  directories?: string[];
  files?: string[];
  outputPath?: string;
}

export interface ArtifactCoverage {
  path: string;
  artifactType: 'parity_validation' | 'parity_walk_forward' | 'unknown';
  rowPayloadCount: number;
  replayableRowCount: number;
  symbols: string[];
  startDate: string | null;
  endDate: string | null;
  notes: string[];
}

export interface ReplayableRow {
  artifactPath: string;
  ticker: string | null;
  asOfDate: string | null;
  aggregateScore: number;
  riskScore: number;
  valuationScore: number | null;
  rawAction: string | null;
  finalAction: string | null;
}

export interface ActionCounts {
  BUY: number;
  SELL: number;
  HOLD: number;
}

export interface CombinedMatrixCell {
  thresholdSet: ThresholdSetName;
  valuationCase: ValuationCaseName;
  actionCounts: ActionCounts;
  holdToNonHoldFlips: number;
}

export interface OfflinePolicyReviewReport {
  generatedAt: string;
  config: {
    directories: string[];
    files: string[];
    thresholdSets: ThresholdSet[];
    valuationCases: ValuationCaseName[];
    buyRiskThreshold: number;
    valuationWeight: number;
  };
  artifacts: ArtifactCoverage[];
  replay: {
    totalRowPayloadsFound: number;
    replayableRows: number;
    currentThresholdSetName: ThresholdSetName;
    actionCountsCurrent: ActionCounts;
    actionCountsByThresholdSet: Array<{
      thresholdSet: ThresholdSetName;
      buyThreshold: number;
      sellThreshold: number;
      actionCounts: ActionCounts;
    }>;
    holdFlipAttribution: {
      baselineHoldRows: number;
      thresholdOnly: number;
      valuationOnly: number;
      combinedOnly: number;
      noFlip: number;
      totalFlippedByAnyScenario: number;
    };
    valuationSensitivity: {
      cases: Array<{
        valuationCase: ValuationCaseName;
        actionCountsAtSetA: ActionCounts;
        holdToNonHoldFlipsAtSetA: number;
      }>;
    };
    combinedThresholdValuationMatrix: CombinedMatrixCell[];
  };
  warnings: string[];
}

const DEFAULT_DIRECTORIES = [path.join(process.cwd(), '.dexter', 'signal-engine', 'validation')];
const BUY_RISK_THRESHOLD = 0.35;
const VALUATION_WEIGHT = 0.18;

const THRESHOLD_SETS: ThresholdSet[] = [
  { name: 'A', buyThreshold: 0.5, sellThreshold: -0.45 },
  { name: 'B', buyThreshold: 0.35, sellThreshold: -0.35 },
  { name: 'C', buyThreshold: 0.25, sellThreshold: -0.25 },
  { name: 'D', buyThreshold: 0.15, sellThreshold: -0.15 },
];

const VALUATION_CASES: ValuationCaseName[] = ['saved', '-0.5', '-0.25', '0'];

function round(value: number, digits = 8): number {
  return Number(value.toFixed(digits));
}

function actionCountsEmpty(): ActionCounts {
  return { BUY: 0, SELL: 0, HOLD: 0 };
}

function toActionCounts(map: Map<ReplayAction, number>): ActionCounts {
  return {
    BUY: map.get('BUY') ?? 0,
    SELL: map.get('SELL') ?? 0,
    HOLD: map.get('HOLD') ?? 0,
  };
}

function classifyAction(
  aggregateScore: number,
  riskScore: number,
  thresholdSet: ThresholdSet,
): ReplayAction {
  if (aggregateScore >= thresholdSet.buyThreshold && riskScore > BUY_RISK_THRESHOLD) return 'BUY';
  if (aggregateScore <= thresholdSet.sellThreshold) return 'SELL';
  return 'HOLD';
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function asDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  return value.slice(0, 10);
}

function asTicker(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized : null;
}

function inferArtifactType(payload: Record<string, unknown>): ArtifactCoverage['artifactType'] {
  if (Array.isArray(payload.rows) || Array.isArray(payload.validationRows)) return 'parity_validation';
  if (payload.walkForward && typeof payload.walkForward === 'object') return 'parity_walk_forward';
  return 'unknown';
}

function pushRowsFromArray(
  rows: unknown,
  artifactPath: string,
  output: ReplayableRow[],
): number {
  if (!Array.isArray(rows)) return 0;
  let count = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    count += 1;
    const rec = row as Record<string, unknown>;
    const aggregateScore = asNumber(rec.aggregateScore);
    const riskScore = asNumber(rec.riskScore);
    if (aggregateScore === null || riskScore === null) continue;
    output.push({
      artifactPath,
      ticker: asTicker(rec.ticker),
      asOfDate: asDate(rec.asOfDate),
      aggregateScore,
      riskScore,
      valuationScore: asNumber(rec.valuationScore),
      rawAction: typeof rec.rawAction === 'string' ? rec.rawAction : null,
      finalAction: typeof rec.finalAction === 'string' ? rec.finalAction : null,
    });
  }
  return count;
}

function collectRows(
  payload: Record<string, unknown>,
  artifactPath: string,
): { rowPayloadCount: number; rows: ReplayableRow[] } {
  const rows: ReplayableRow[] = [];
  let rowPayloadCount = 0;

  rowPayloadCount += pushRowsFromArray(payload.rows, artifactPath, rows);
  rowPayloadCount += pushRowsFromArray(payload.validationRows, artifactPath, rows);

  const walkForward = payload.walkForward;
  if (walkForward && typeof walkForward === 'object') {
    const wf = walkForward as Record<string, unknown>;
    if (Array.isArray(wf.foldEvaluations)) {
      for (const fold of wf.foldEvaluations) {
        if (!fold || typeof fold !== 'object') continue;
        const foldRec = fold as Record<string, unknown>;
        rowPayloadCount += pushRowsFromArray(foldRec.validationRows, artifactPath, rows);
        rowPayloadCount += pushRowsFromArray(foldRec.rows, artifactPath, rows);
      }
    }
    if (Array.isArray(wf.folds)) {
      for (const fold of wf.folds) {
        if (!fold || typeof fold !== 'object') continue;
        const foldRec = fold as Record<string, unknown>;
        rowPayloadCount += pushRowsFromArray(foldRec.validationRows, artifactPath, rows);
        rowPayloadCount += pushRowsFromArray(foldRec.rows, artifactPath, rows);
      }
    }
  }

  const holdout = payload.holdout;
  if (holdout && typeof holdout === 'object') {
    const hold = holdout as Record<string, unknown>;
    rowPayloadCount += pushRowsFromArray(hold.validationRows, artifactPath, rows);
    rowPayloadCount += pushRowsFromArray(hold.rows, artifactPath, rows);
  }

  return { rowPayloadCount, rows };
}

function uniqSorted(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function summarizeArtifact(
  artifactPath: string,
  payload: Record<string, unknown>,
  rows: ReplayableRow[],
  rowPayloadCount: number,
): ArtifactCoverage {
  const symbols = uniqSorted(rows.map((row) => row.ticker));
  const dates = uniqSorted(rows.map((row) => row.asOfDate));
  const notes: string[] = [];
  if (rowPayloadCount === 0) notes.push('No row payloads found in artifact.');
  if (rowPayloadCount > 0 && rows.length === 0) {
    notes.push('Row payloads found, but none were replayable (missing aggregateScore/riskScore).');
  }

  if (!symbols.length) {
    const universe = payload.universe;
    if (universe && typeof universe === 'object') {
      const effective = (universe as Record<string, unknown>).effectiveTickers;
      if (Array.isArray(effective)) {
        const inferred = uniqSorted(effective.map((value) => (typeof value === 'string' ? value : null)));
        if (inferred.length) {
          symbols.push(...inferred);
          notes.push('Symbols inferred from universe.effectiveTickers metadata.');
        }
      }
    }
    const config = payload.config;
    if (!symbols.length && config && typeof config === 'object') {
      const tickers = (config as Record<string, unknown>).tickers;
      if (Array.isArray(tickers)) {
        const inferred = uniqSorted(tickers.map((value) => (typeof value === 'string' ? value : null)));
        if (inferred.length) {
          symbols.push(...inferred);
          notes.push('Symbols inferred from config.tickers metadata.');
        }
      }
    }
  }

  let startDate = dates[0] ?? null;
  let endDate = dates[dates.length - 1] ?? null;
  if (!startDate || !endDate) {
    const dateWindow = payload.dateWindow;
    if (dateWindow && typeof dateWindow === 'object') {
      const dw = dateWindow as Record<string, unknown>;
      startDate = startDate ?? asDate(dw.startDate);
      endDate = endDate ?? asDate(dw.endDate);
      if (startDate || endDate) {
        notes.push('Date window inferred from dateWindow metadata.');
      }
    }
  }
  if (!startDate || !endDate) {
    const config = payload.config;
    if (config && typeof config === 'object') {
      const cfg = config as Record<string, unknown>;
      startDate = startDate ?? asDate(cfg.startDate);
      endDate = endDate ?? asDate(cfg.endDate);
      if (startDate || endDate) {
        notes.push('Date window inferred from config metadata.');
      }
    }
  }

  return {
    path: artifactPath,
    artifactType: inferArtifactType(payload),
    rowPayloadCount,
    replayableRowCount: rows.length,
    symbols,
    startDate,
    endDate,
    notes,
  };
}

async function listJsonFilesInDirectory(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function resolveInputFiles(config: OfflinePolicyReviewConfig): Promise<{ directories: string[]; files: string[] }> {
  const explicitFilesRaw = config.files ?? [];
  const shouldUseDefaultDirectories =
    config.directories === undefined && explicitFilesRaw.length === 0;
  const directories = shouldUseDefaultDirectories
    ? DEFAULT_DIRECTORIES.map((dir) => path.resolve(dir))
    : (config.directories ?? []).map((dir) => path.resolve(dir));
  const explicitFiles = explicitFilesRaw.map((file) => path.resolve(file));
  const scanned = (
    await Promise.all(directories.map((directory) => listJsonFilesInDirectory(directory)))
  ).flat();

  const files = Array.from(new Set([...scanned, ...explicitFiles])).sort((a, b) => a.localeCompare(b));
  return { directories, files };
}

function valuationOverride(value: ValuationCaseName, saved: number | null): number | null {
  if (value === 'saved') return saved;
  if (value === '-0.5') return -0.5;
  if (value === '-0.25') return -0.25;
  if (value === '0') return 0;
  return saved;
}

function scoreWithValuation(row: ReplayableRow, valuationCase: ValuationCaseName): number {
  const override = valuationOverride(valuationCase, row.valuationScore);
  if (row.valuationScore === null || override === null) return row.aggregateScore;
  const delta = (override - row.valuationScore) * VALUATION_WEIGHT;
  return round(row.aggregateScore + delta, 8);
}

function computeReport(
  rows: ReplayableRow[],
  totalRowPayloadsFound: number,
): OfflinePolicyReviewReport['replay'] {
  const setA = THRESHOLD_SETS[0];
  const actionCountsBySet = THRESHOLD_SETS.map((thresholdSet) => {
    const map = new Map<ReplayAction, number>();
    for (const row of rows) {
      const action = classifyAction(row.aggregateScore, row.riskScore, thresholdSet);
      map.set(action, (map.get(action) ?? 0) + 1);
    }
    return {
      thresholdSet: thresholdSet.name,
      buyThreshold: thresholdSet.buyThreshold,
      sellThreshold: thresholdSet.sellThreshold,
      actionCounts: toActionCounts(map),
    };
  });

  const actionCountsCurrent = actionCountsBySet.find((row) => row.thresholdSet === 'A')?.actionCounts ??
    actionCountsEmpty();

  const baselineHolds = rows.filter(
    (row) => classifyAction(row.aggregateScore, row.riskScore, setA) === 'HOLD',
  );

  let thresholdOnly = 0;
  let valuationOnly = 0;
  let combinedOnly = 0;
  let noFlip = 0;
  for (const row of baselineHolds) {
    const thresholdFlip = THRESHOLD_SETS.slice(1).some((thresholdSet) =>
      classifyAction(row.aggregateScore, row.riskScore, thresholdSet) !== 'HOLD',
    );

    const valuationFlip = VALUATION_CASES
      .filter((valuationCase) => valuationCase !== 'saved')
      .some((valuationCase) =>
        classifyAction(scoreWithValuation(row, valuationCase), row.riskScore, setA) !== 'HOLD',
      );

    const combinedFlip = THRESHOLD_SETS.slice(1).some((thresholdSet) =>
      VALUATION_CASES.filter((valuationCase) => valuationCase !== 'saved').some((valuationCase) =>
        classifyAction(scoreWithValuation(row, valuationCase), row.riskScore, thresholdSet) !== 'HOLD',
      ),
    );

    if (thresholdFlip && !valuationFlip) {
      thresholdOnly += 1;
    } else if (valuationFlip && !thresholdFlip) {
      valuationOnly += 1;
    } else if (combinedFlip) {
      combinedOnly += 1;
    } else {
      noFlip += 1;
    }

  }
  const totalFlippedByAnyScenario = thresholdOnly + valuationOnly + combinedOnly;

  const valuationCases = VALUATION_CASES.map((valuationCase) => {
    const map = new Map<ReplayAction, number>();
    let holdToNonHoldFlipsAtSetA = 0;
    for (const row of rows) {
      const baseline = classifyAction(row.aggregateScore, row.riskScore, setA);
      const score = scoreWithValuation(row, valuationCase);
      const replay = classifyAction(score, row.riskScore, setA);
      map.set(replay, (map.get(replay) ?? 0) + 1);
      if (baseline === 'HOLD' && replay !== 'HOLD') holdToNonHoldFlipsAtSetA += 1;
    }
    return {
      valuationCase,
      actionCountsAtSetA: toActionCounts(map),
      holdToNonHoldFlipsAtSetA,
    };
  });

  const combinedThresholdValuationMatrix: CombinedMatrixCell[] = [];
  for (const thresholdSet of THRESHOLD_SETS) {
    for (const valuationCase of VALUATION_CASES) {
      const map = new Map<ReplayAction, number>();
      let holdToNonHoldFlips = 0;
      for (const row of rows) {
        const baseline = classifyAction(row.aggregateScore, row.riskScore, setA);
        const replay = classifyAction(
          scoreWithValuation(row, valuationCase),
          row.riskScore,
          thresholdSet,
        );
        map.set(replay, (map.get(replay) ?? 0) + 1);
        if (baseline === 'HOLD' && replay !== 'HOLD') holdToNonHoldFlips += 1;
      }
      combinedThresholdValuationMatrix.push({
        thresholdSet: thresholdSet.name,
        valuationCase,
        actionCounts: toActionCounts(map),
        holdToNonHoldFlips,
      });
    }
  }

  return {
    totalRowPayloadsFound,
    replayableRows: rows.length,
    currentThresholdSetName: 'A',
    actionCountsCurrent,
    actionCountsByThresholdSet: actionCountsBySet,
    holdFlipAttribution: {
      baselineHoldRows: baselineHolds.length,
      thresholdOnly,
      valuationOnly,
      combinedOnly,
      noFlip,
      totalFlippedByAnyScenario,
    },
    valuationSensitivity: {
      cases: valuationCases,
    },
    combinedThresholdValuationMatrix,
  };
}

export async function buildOfflinePolicyReviewReport(
  config: OfflinePolicyReviewConfig = {},
): Promise<OfflinePolicyReviewReport> {
  const { directories, files } = await resolveInputFiles(config);
  const warnings = new Set<string>();
  const artifacts: ArtifactCoverage[] = [];
  const replayableRows: ReplayableRow[] = [];
  let totalRowPayloadsFound = 0;

  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        warnings.add(`Skipping non-object JSON artifact: ${filePath}`);
        continue;
      }
      const { rowPayloadCount, rows } = collectRows(parsed, filePath);
      totalRowPayloadsFound += rowPayloadCount;
      artifacts.push(summarizeArtifact(filePath, parsed, rows, rowPayloadCount));
      replayableRows.push(...rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.add(`Failed to read ${filePath}: ${message}`);
    }
  }

  artifacts.sort((a, b) => a.path.localeCompare(b.path));
  replayableRows.sort((a, b) => {
    const byDate = (a.asOfDate ?? '').localeCompare(b.asOfDate ?? '');
    if (byDate !== 0) return byDate;
    const byTicker = (a.ticker ?? '').localeCompare(b.ticker ?? '');
    if (byTicker !== 0) return byTicker;
    const byArtifact = a.artifactPath.localeCompare(b.artifactPath);
    if (byArtifact !== 0) return byArtifact;
    return a.aggregateScore - b.aggregateScore;
  });

  if (!files.length) warnings.add('No input JSON files found from configured directories/files.');
  if (!replayableRows.length) {
    warnings.add('No replayable rows found (requires aggregateScore + riskScore per row).');
  }

  const report: OfflinePolicyReviewReport = {
    generatedAt: new Date().toISOString(),
    config: {
      directories,
      files,
      thresholdSets: THRESHOLD_SETS,
      valuationCases: VALUATION_CASES,
      buyRiskThreshold: BUY_RISK_THRESHOLD,
      valuationWeight: VALUATION_WEIGHT,
    },
    artifacts,
    replay: computeReport(replayableRows, totalRowPayloadsFound),
    warnings: Array.from(warnings).sort((a, b) => a.localeCompare(b)),
  };

  return report;
}

function defaultOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'validation',
    `offline-policy-review-${stamp}.json`,
  );
}

export async function persistOfflinePolicyReviewReport(
  report: OfflinePolicyReviewReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
