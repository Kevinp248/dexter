import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { SignalPayload } from './models.js';
import { normalizeActionForMode } from './action-normalization.js';

type ScanOutput = {
  generatedAt: string;
  alerts: SignalPayload[];
};

const PAPER_TRADE_HEADERS = [
  'Date',
  'Ticker',
  'signalRawAction',
  'action',
  'finalAction',
  'Confidence',
  'Decision',
  'Direction',
  'Entry Price',
  'Position Size (shares)',
  'Notional',
  'Cost Estimate (USD)',
  'Expected Edge Pre-Cost (bps)',
  'Expected Edge Post-Cost (bps)',
  'Min Edge Threshold (bps)',
  'Cost Changed Action',
  'Cost Assumption Source',
  'Cost Assumption Version',
  'Cost Assumption Snapshot',
  'Key Delta Drivers',
  'Risk Checks',
  'Reason for Override',
  'Exit Date',
  'Exit Price',
  'Result (%)',
  'Fallback Had Fallback',
  'Fallback Reason',
  'Fallback Retry Suggestion',
  'Notes / Lessons',
] as const;

function defaultPaperTradeLogPath(): string {
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'paper-trade-log.csv');
}

function toCsvCell(value: string | number | boolean): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function roundTo(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function directionFromAction(action: string): string {
  const normalized = normalizeActionForMode(action, 'long_only', {
    longShares: 0,
    shortShares: 0,
  });
  const canonical = normalized.canonicalAction;
  if (canonical === 'BUY') return 'long';
  if (canonical === 'SELL') return 'exit long';
  return 'none';
}

function decisionFromAction(action: string): string {
  const normalized = normalizeActionForMode(action, 'long_only', {
    longShares: 0,
    shortShares: 0,
  });
  return normalized.canonicalAction === 'HOLD' ? 'skip' : 'trade';
}

function normalizeForLog(
  action: SignalPayload['action'],
  finalAction: SignalPayload['finalAction'],
  position: SignalPayload['positionContext'],
): { action: string; finalAction: string } {
  const normalizedAction = normalizeActionForMode(action, 'long_only', position);
  const normalizedFinalAction = normalizeActionForMode(finalAction, 'long_only', position);
  return {
    action: normalizedAction.canonicalAction,
    finalAction: normalizedFinalAction.canonicalAction,
  };
}

async function ensureHeader(logPath: string): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const expectedHeader = PAPER_TRADE_HEADERS.join(',');
  try {
    const existing = await readFile(logPath, 'utf8');
    const lines = existing.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!lines.length) {
      await writeFile(logPath, `${expectedHeader}\n`, 'utf8');
      return;
    }
    const currentHeader = lines[0].trim();
    if (currentHeader === expectedHeader) return;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${logPath}.migrated-${ts}`;
    await rename(logPath, rotatedPath);
    await writeFile(logPath, `${expectedHeader}\n`, 'utf8');
    return;
  } catch {
    // File doesn't exist yet, create below.
  }
  await writeFile(logPath, `${expectedHeader}\n`, 'utf8');
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

async function loadExistingDateTickerKeys(logPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(logPath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length <= 1) return new Set();

    const keys = new Set<string>();
    for (const line of lines.slice(1)) {
      const cols = splitCsvLine(line);
      const date = cols[0]?.trim();
      const ticker = cols[1]?.trim().toUpperCase();
      if (date && ticker) keys.add(`${date}::${ticker}`);
    }
    return keys;
  } catch {
    return new Set();
  }
}

function alertToCsvRow(alert: SignalPayload): string {
  const normalized = normalizeForLog(
    alert.action,
    alert.finalAction,
    alert.positionContext,
  );
  const fallbackEvents = alert.fallbackPolicy.events.filter((event) => event.fallbackUsed);
  const fallbackReason =
    fallbackEvents.map((event) => event.reason).join(' | ') || '';
  const fallbackRetrySuggestion =
    fallbackEvents.map((event) => event.retrySuggestion).join(' | ') || '';
  const positionSize =
    alert.positionContext.longShares > 0
      ? alert.positionContext.longShares
      : alert.positionContext.shortShares > 0
        ? alert.positionContext.shortShares
        : alert.executionPlan.estimatedShares;
  const notional =
    positionSize > 0
      ? roundTo(positionSize * alert.positionPerformance.markPrice, 2)
      : roundTo(alert.executionPlan.notionalUsd, 2);

  const rowValues: Array<string | number | boolean> = [
    alert.generatedAt.slice(0, 10),
    alert.ticker,
    alert.rawAction,
    normalized.action,
    normalized.finalAction,
    roundTo(alert.confidence, 2),
    decisionFromAction(normalized.finalAction),
    directionFromAction(normalized.finalAction),
    roundTo(alert.positionPerformance.markPrice, 2),
    positionSize,
    notional,
    roundTo(alert.executionPlan.costEstimate.estimatedRoundTripCostUsd, 2),
    roundTo(alert.executionPlan.costEstimate.expectedEdgePreCostBps, 2),
    roundTo(alert.executionPlan.costEstimate.expectedEdgePostCostBps, 2),
    roundTo(alert.executionPlan.costEstimate.minEdgeThresholdBps, 2),
    alert.executionPlan.costEstimate.costChangedAction,
    alert.executionPlan.costEstimate.assumptionSource,
    alert.executionPlan.costEstimate.assumptionVersion,
    alert.executionPlan.costEstimate.assumptionSnapshotId,
    alert.delta.topDrivers.join('; '),
    alert.reasoning.risk.checks.join('; ') || 'none',
    '',
    '',
    '',
    '',
    alert.fallbackPolicy.hadFallback,
    fallbackReason,
    fallbackRetrySuggestion,
    `Auto-log from scan ${alert.generatedAt}${alert.actionNormalizationNote ? ` | ${alert.actionNormalizationNote}` : ''}`,
  ];

  return rowValues.map(toCsvCell).join(',');
}

export async function appendScanAlertsToPaperTradeLog(
  scan: ScanOutput,
  logPath = defaultPaperTradeLogPath(),
): Promise<{ path: string; rowsAppended: number; rowsSkipped: number }> {
  await ensureHeader(logPath);
  if (!scan.alerts.length) return { path: logPath, rowsAppended: 0, rowsSkipped: 0 };

  const existingKeys = await loadExistingDateTickerKeys(logPath);
  const rowsToAppend: string[] = [];
  let rowsSkipped = 0;

  for (const alert of scan.alerts) {
    const key = `${alert.generatedAt.slice(0, 10)}::${alert.ticker.toUpperCase()}`;
    if (existingKeys.has(key)) {
      rowsSkipped += 1;
      continue;
    }
    existingKeys.add(key);
    rowsToAppend.push(alertToCsvRow(alert));
  }

  if (!rowsToAppend.length) {
    return { path: logPath, rowsAppended: 0, rowsSkipped };
  }

  await appendFile(logPath, `${rowsToAppend.join('\n')}\n`, 'utf8');
  return { path: logPath, rowsAppended: rowsToAppend.length, rowsSkipped };
}
