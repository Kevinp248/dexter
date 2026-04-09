import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PositionStateSnapshot } from './portfolio-ledger.js';
import { formatEvidenceBundle, runGroundedSearch } from './grounded-research.js';
import { SignalPayload } from './models.js';
import { parsePaperTradeCsv, PaperTradeRow } from './weekly-review.js';

export type IncidentType = 'loss' | 'edge_divergence';

export interface PostmortemIncident {
  id: string;
  createdAt: string;
  ticker: string;
  type: IncidentType;
  severity: 'high' | 'medium';
  summary: string;
  trigger: {
    resultPct: number;
    expectedEdgeAfterCostsBps: number | null;
    divergenceBps: number | null;
  };
  rootCauseHypotheses: string[];
  recommendations: string[];
  evidence: ReturnType<typeof formatEvidenceBundle>;
}

type ScanOutput = {
  generatedAt: string;
  alerts: SignalPayload[];
};

export interface PostmortemOptions {
  lossThresholdPct: number;
  divergenceThresholdBps: number;
  includeResearch: boolean;
}

const DEFAULT_OPTIONS: PostmortemOptions = {
  lossThresholdPct: -2,
  divergenceThresholdBps: 150,
  includeResearch: false,
};

function defaultIncidentPath(): string {
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'incidents.jsonl');
}

function makeIncidentId(ticker: string, createdAt: string, type: IncidentType): string {
  return `${createdAt.slice(0, 10)}-${ticker}-${type}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeRootCauses(alert: SignalPayload | undefined): string[] {
  if (!alert) return ['No aligned scan snapshot found for ticker'];
  const causes: string[] = [];
  if (alert.fallbackPolicy.hadFallback) {
    causes.push('Data fallback was used; signal quality may be reduced');
  }
  if (alert.reasoning.risk.checks.length > 0) {
    causes.push(`Risk checks triggered: ${alert.reasoning.risk.checks.join('; ')}`);
  }
  if (alert.confidence >= 70) {
    causes.push('High-confidence signal underperformed; threshold may be too permissive');
  }
  if (alert.executionPlan.costEstimate.expectedEdgeAfterCostsBps <= 0) {
    causes.push('Signal edge after cost was weak; execution realism likely eroded outcome');
  }
  if (!causes.length) {
    causes.push('Market regime drift or idiosyncratic news may have invalidated thesis');
  }
  return causes;
}

function buildRecommendations(alert: SignalPayload | undefined): string[] {
  if (!alert) {
    return ['Re-run scan and confirm a fresh signal snapshot exists before new entries.'];
  }
  const recommendations: string[] = [];
  if (alert.fallbackPolicy.hadFallback) {
    const retryHints = alert.fallbackPolicy.events
      .filter((event) => event.fallbackUsed)
      .map((event) => event.retrySuggestion)
      .filter(Boolean);
    if (retryHints.length > 0) {
      recommendations.push(...retryHints);
    }
  }
  recommendations.push(
    'Review this ticker in the next daily scan and only act on finalAction with no policy violations.',
  );
  recommendations.push(
    'If similar incidents repeat, open a calibration proposal instead of changing rules ad hoc.',
  );
  return [...new Set(recommendations)];
}

function buildIncidentSummary(ticker: string, type: IncidentType, resultPct: number): string {
  if (type === 'loss') {
    return `${ticker} closed trade loss ${resultPct.toFixed(2)}% breached loss threshold`;
  }
  return `${ticker} realized outcome diverged from expected edge`;
}

async function buildEvidence(
  claim: string,
  includeResearch: boolean,
): Promise<ReturnType<typeof formatEvidenceBundle>> {
  if (!includeResearch) {
    return formatEvidenceBundle(claim, []);
  }
  const results = await runGroundedSearch(claim);
  return formatEvidenceBundle(claim, results);
}

export async function generatePostmortemIncidents(
  rows: PaperTradeRow[],
  scan: ScanOutput,
  positionState: PositionStateSnapshot | null,
  options: Partial<PostmortemOptions> = {},
): Promise<PostmortemIncident[]> {
  const resolved: PostmortemOptions = { ...DEFAULT_OPTIONS, ...options };
  const byTicker = Object.fromEntries(scan.alerts.map((alert) => [alert.ticker, alert]));
  const incidents: PostmortemIncident[] = [];

  for (const row of rows) {
    if (row.resultPct === null) continue;
    const alert = byTicker[row.ticker];
    const expectedEdgeAfterCostsBps = alert?.executionPlan.costEstimate.expectedEdgeAfterCostsBps ?? null;
    const realizedBps = row.resultPct * 100;
    const divergenceBps =
      expectedEdgeAfterCostsBps === null ? null : expectedEdgeAfterCostsBps - realizedBps;

    const lossTriggered = row.resultPct <= resolved.lossThresholdPct;
    const divergenceTriggered =
      divergenceBps !== null && divergenceBps >= resolved.divergenceThresholdBps;

    if (!lossTriggered && !divergenceTriggered) continue;

    const createdAt = new Date().toISOString();
    const type: IncidentType = lossTriggered ? 'loss' : 'edge_divergence';
    const evidenceClaim = `${row.ticker} trade deviation diagnostics ${scan.generatedAt}`;
    const evidence = await buildEvidence(evidenceClaim, resolved.includeResearch);
    const hasPosition = Boolean(positionState?.positions?.[row.ticker]);
    const rootCauseHypotheses = summarizeRootCauses(alert);
    if (hasPosition) {
      rootCauseHypotheses.push('Ticker still has position history in ledger; include execution timeline review.');
    }

    incidents.push({
      id: makeIncidentId(row.ticker, createdAt, type),
      createdAt,
      ticker: row.ticker,
      type,
      severity: lossTriggered ? 'high' : 'medium',
      summary: buildIncidentSummary(row.ticker, type, row.resultPct),
      trigger: {
        resultPct: row.resultPct,
        expectedEdgeAfterCostsBps,
        divergenceBps,
      },
      rootCauseHypotheses: [...new Set(rootCauseHypotheses)],
      recommendations: buildRecommendations(alert),
      evidence,
    });
  }

  return incidents;
}

export async function persistPostmortemIncidents(
  incidents: PostmortemIncident[],
  targetPath = defaultIncidentPath(),
): Promise<{ path: string; rowsWritten: number }> {
  if (!incidents.length) return { path: targetPath, rowsWritten: 0 };
  await mkdir(path.dirname(targetPath), { recursive: true });
  const lines = incidents.map((incident) => JSON.stringify(incident)).join('\n');
  await appendFile(targetPath, `${lines}\n`, 'utf8');
  return { path: targetPath, rowsWritten: incidents.length };
}

export async function loadLatestScan(
  scanPath = path.join(process.cwd(), '.dexter', 'signal-engine', 'last-scan.json'),
): Promise<ScanOutput> {
  const raw = await readFile(scanPath, 'utf8');
  return JSON.parse(raw) as ScanOutput;
}

export async function loadPaperTradeRows(
  logPath = path.join(process.cwd(), '.dexter', 'signal-engine', 'paper-trade-log.csv'),
): Promise<PaperTradeRow[]> {
  const raw = await readFile(logPath, 'utf8');
  return parsePaperTradeCsv(raw);
}
