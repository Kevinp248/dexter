import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { SignalPayload } from './models.js';

type ScanOutput = {
  generatedAt: string;
  alerts: SignalPayload[];
};

const PAPER_TRADE_HEADERS = [
  'Date',
  'Ticker',
  'action',
  'finalAction',
  'Confidence',
  'Decision',
  'Direction',
  'Entry Price',
  'Position Size (shares)',
  'Notional',
  'Cost Estimate (USD)',
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

function directionFromAction(action: SignalPayload['finalAction']): string {
  if (action === 'BUY') return 'long';
  if (action === 'SELL') return 'exit long';
  if (action === 'COVER') return 'cover short';
  return 'none';
}

function decisionFromAction(action: SignalPayload['finalAction']): string {
  return action === 'HOLD' ? 'skip' : 'trade';
}

async function ensureHeader(logPath: string): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  try {
    const existing = await readFile(logPath, 'utf8');
    if (existing.trim().length > 0) return;
  } catch {
    // File doesn't exist yet, create below.
  }
  await writeFile(logPath, `${PAPER_TRADE_HEADERS.join(',')}\n`, 'utf8');
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
    alert.action,
    alert.finalAction,
    roundTo(alert.confidence, 2),
    decisionFromAction(alert.finalAction),
    directionFromAction(alert.finalAction),
    roundTo(alert.positionPerformance.markPrice, 2),
    positionSize,
    notional,
    roundTo(alert.executionPlan.costEstimate.estimatedRoundTripCostUsd, 2),
    alert.delta.topDrivers.join('; '),
    alert.reasoning.risk.checks.join('; ') || 'none',
    '',
    '',
    '',
    '',
    alert.fallbackPolicy.hadFallback,
    fallbackReason,
    fallbackRetrySuggestion,
    `Auto-log from scan ${alert.generatedAt}`,
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
