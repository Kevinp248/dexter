import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runDailyScan } from './index.js';
import { loadPreviousSignalsByTicker, saveLatestScan } from './history.js';
import { loadPositionContexts, loadPositionState } from './portfolio-ledger.js';
import { appendScanAlertsToPaperTradeLog } from './paper-trade-log.js';
import { parsePaperTradeCsv, summarizeWeeklyReview } from './weekly-review.js';
import { summarizeSignalQuality } from './signal-quality.js';
import { generatePostmortemIncidents, persistPostmortemIncidents } from './postmortem.js';
import { ScanOptions } from './models.js';

export interface DailyOperatorOptions {
  tickers?: string[];
  includePostmortem?: boolean;
  includeResearch?: boolean;
}

export interface DailyOperatorResult {
  generatedAt: string;
  alertsGenerated: number;
  csv: {
    rowsAppended: number;
    rowsSkipped: number;
  };
  weekly: {
    closedTrades: number;
    winRatePct: number | null;
  };
  quality: {
    overallHitRatePct: number | null;
  };
  incidentsWritten: number;
  nextActions: string[];
}

function historyLogPath(): string {
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'scan-history.jsonl');
}

async function appendScanSnapshot(scan: unknown): Promise<void> {
  const target = historyLogPath();
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(scan)}\n`, 'utf8');
}

async function loadPaperTradeRows(): Promise<ReturnType<typeof parsePaperTradeCsv>> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), '.dexter', 'signal-engine', 'paper-trade-log.csv'),
      'utf8',
    );
    return parsePaperTradeCsv(raw);
  } catch {
    return [];
  }
}

function buildNextActions(scan: Awaited<ReturnType<typeof runDailyScan>>): string[] {
  const actions: string[] = [];
  for (const alert of scan.alerts) {
    if (alert.finalAction === 'HOLD') {
      actions.push(
        `${alert.ticker}: HOLD (confidence ${alert.confidence.toFixed(1)}). Re-check tomorrow unless thesis changes.`,
      );
      continue;
    }
    if (!alert.executionPlan.constraints.isAllowed) {
      actions.push(
        `${alert.ticker}: ${alert.finalAction} blocked by constraints (${alert.executionPlan.constraints.blockedReasons.join('; ')}).`,
      );
      continue;
    }
    if (!alert.executionPlan.costEstimate.isTradeableAfterCosts) {
      actions.push(
        `${alert.ticker}: ${alert.finalAction} edge fails cost filter. Wait for stronger setup.`,
      );
      continue;
    }
    actions.push(
      `${alert.ticker}: consider manual ${alert.finalAction}. Log fill with bun run trade:ledger record ... after execution.`,
    );
  }
  return actions;
}

export async function runDailyOperator(
  options: DailyOperatorOptions = {},
): Promise<DailyOperatorResult> {
  const includePostmortem = options.includePostmortem ?? true;
  const includeResearch = options.includeResearch ?? false;

  const positionStateSnapshot = await loadPositionState();
  const storedPositions = await loadPositionContexts();
  const scanOptions: ScanOptions = {
    tickers: options.tickers,
    positions: Object.keys(storedPositions).length ? storedPositions : undefined,
    positionStatesByTicker: positionStateSnapshot?.positions,
    previousSignalsByTicker: await loadPreviousSignalsByTicker(),
  };

  const scan = await runDailyScan(scanOptions);
  await saveLatestScan(scan);
  await appendScanSnapshot(scan);
  const appendResult = await appendScanAlertsToPaperTradeLog(scan);

  const rows = await loadPaperTradeRows();
  const weekly = summarizeWeeklyReview(rows, { days: 7 });
  const quality = summarizeSignalQuality(rows, { days: 30 });

  let incidentsWritten = 0;
  if (includePostmortem) {
    const incidents = await generatePostmortemIncidents(rows, scan, positionStateSnapshot, {
      includeResearch,
    });
    const persisted = await persistPostmortemIncidents(incidents);
    incidentsWritten = persisted.rowsWritten;
  }

  const nextActions = buildNextActions(scan);
  return {
    generatedAt: new Date().toISOString(),
    alertsGenerated: scan.alerts.length,
    csv: {
      rowsAppended: appendResult.rowsAppended,
      rowsSkipped: appendResult.rowsSkipped,
    },
    weekly: {
      closedTrades: weekly.closedTrades,
      winRatePct: weekly.winRatePct,
    },
    quality: {
      overallHitRatePct: quality.overallHitRatePct,
    },
    incidentsWritten,
    nextActions,
  };
}

export function formatDailyOperatorSummary(
  result: DailyOperatorResult,
  includePostmortem: boolean,
): string[] {
  const lines = [
    'Daily operator run completed',
    `Generated alerts: ${result.alertsGenerated}`,
    `CSV appended: ${result.csv.rowsAppended}, skipped: ${result.csv.rowsSkipped}`,
    `Weekly closed trades: ${result.weekly.closedTrades}, win rate: ${result.weekly.winRatePct ?? '-'}%`,
    `30d hit rate: ${result.quality.overallHitRatePct ?? '-'}%`,
  ];
  if (includePostmortem) {
    lines.push(`Postmortem incidents written: ${result.incidentsWritten}`);
  }
  lines.push('Today next actions:');
  for (const item of result.nextActions) {
    lines.push(`- ${item}`);
  }
  return lines;
}
