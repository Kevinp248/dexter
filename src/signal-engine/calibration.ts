import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SIGNAL_CONFIG, SignalEngineConfig } from './config.js';
import { PostmortemIncident } from './postmortem.js';

export type ProposalStatus = 'draft' | 'ready' | 'blocked' | 'applied';

export interface ParameterChange {
  path: string;
  before: number;
  after: number;
  reason: string;
}

export interface CalibrationProposal {
  id: string;
  createdAt: string;
  status: ProposalStatus;
  rationale: string;
  expectedImpact: string;
  basedOnIncidentIds: string[];
  changes: ParameterChange[];
  gate?: GateResult;
  approvedBy?: string;
  appliedAt?: string;
}

export interface GateResult {
  checkedAt: string;
  typecheckPassed: boolean;
  signalTestsPassed: boolean;
  walkForwardPassed: boolean;
  passed: boolean;
}

export interface GateRunner {
  run: (cmd: string, args: string[]) => Promise<boolean>;
}

function calibrationDir(): string {
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'calibration');
}

function proposalDir(): string {
  return path.join(calibrationDir(), 'proposals');
}

function overridePath(): string {
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'config-overrides.json');
}

function proposalPath(id: string): string {
  return path.join(proposalDir(), `${id}.json`);
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function getNumberAtPath(root: unknown, dottedPath: string): number {
  const keys = dottedPath.split('.');
  let cursor: unknown = root;
  for (const key of keys) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
      throw new Error(`Invalid config path: ${dottedPath}`);
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor !== 'number' || !Number.isFinite(cursor)) {
    throw new Error(`Path is not numeric: ${dottedPath}`);
  }
  return cursor;
}

function setNumberAtPath(
  root: Record<string, unknown>,
  dottedPath: string,
  value: number,
): void {
  const keys = dottedPath.split('.');
  let cursor = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = cursor[key];
    if (!next || typeof next !== 'object') {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function buildProposalId(createdAt: string): string {
  const stamp = createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  return `proposal-${stamp}`;
}

function deriveChanges(incidents: PostmortemIncident[]): ParameterChange[] {
  const changes: ParameterChange[] = [];
  const losses = incidents.filter((incident) => incident.type === 'loss').length;
  const divergence = incidents.filter((incident) => incident.type === 'edge_divergence').length;
  const fallbackHeavy = incidents.filter((incident) =>
    incident.rootCauseHypotheses.some((value) => value.toLowerCase().includes('fallback')),
  ).length;

  if (losses >= 2) {
    const before = SIGNAL_CONFIG.actions.buyScoreThreshold;
    const after = round4(Math.min(before + 0.05, 0.75));
    if (after !== before) {
      changes.push({
        path: 'actions.buyScoreThreshold',
        before,
        after,
        reason: 'Multiple loss incidents suggest tightening BUY threshold.',
      });
    }
  }

  if (divergence >= 2) {
    const before = SIGNAL_CONFIG.execution.defaultMinimumEdgeAfterCostsBps;
    const after = round4(Math.min(before + 5, 80));
    if (after !== before) {
      changes.push({
        path: 'execution.defaultMinimumEdgeAfterCostsBps',
        before,
        after,
        reason: 'Repeated edge divergence suggests requiring more post-cost edge.',
      });
    }
  }

  if (fallbackHeavy >= 2) {
    const before = SIGNAL_CONFIG.aggregateWeights.sentiment;
    const after = round4(Math.max(before - 0.03, 0.05));
    if (after !== before) {
      changes.push({
        path: 'aggregateWeights.sentiment',
        before,
        after,
        reason: 'Frequent fallback incidents reduce reliability of sentiment input.',
      });
    }
  }

  return changes;
}

export function createCalibrationProposal(
  incidents: PostmortemIncident[],
  createdAt = new Date().toISOString(),
): CalibrationProposal {
  const changes = deriveChanges(incidents);
  const id = buildProposalId(createdAt);
  return {
    id,
    createdAt,
    status: 'draft',
    rationale:
      incidents.length > 0
        ? 'Generated from incident patterns observed in postmortem reports.'
        : 'No incidents detected; proposal remains no-op for audit completeness.',
    expectedImpact:
      changes.length > 0
        ? 'Reduce false-positive trades and improve realized edge consistency.'
        : 'No parameter change suggested from current incident sample.',
    basedOnIncidentIds: incidents.map((incident) => incident.id),
    changes,
  };
}

export async function saveCalibrationProposal(
  proposal: CalibrationProposal,
): Promise<{ path: string }> {
  const target = proposalPath(proposal.id);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(proposal, null, 2), 'utf8');
  return { path: target };
}

export async function loadCalibrationProposal(idOrPath: string): Promise<CalibrationProposal> {
  const target = idOrPath.endsWith('.json') ? idOrPath : proposalPath(idOrPath);
  const raw = await readFile(target, 'utf8');
  return JSON.parse(raw) as CalibrationProposal;
}

async function defaultRunCommand(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', env: process.env });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

export async function gateCalibrationProposal(
  proposal: CalibrationProposal,
  runner: GateRunner = { run: defaultRunCommand },
): Promise<CalibrationProposal> {
  const typecheckPassed = await runner.run('npm', ['run', 'typecheck']);
  const signalTestsPassed = await runner.run('npm', ['run', 'test:signals']);
  const walkForwardPassed = await runner.run('npm', ['run', 'test:walkforward']);

  const gate: GateResult = {
    checkedAt: new Date().toISOString(),
    typecheckPassed,
    signalTestsPassed,
    walkForwardPassed,
    passed: typecheckPassed && signalTestsPassed && walkForwardPassed,
  };

  return {
    ...proposal,
    gate,
    status: gate.passed ? 'ready' : 'blocked',
  };
}

export async function loadIncidentsForCalibration(
  incidentPath = path.join(process.cwd(), '.dexter', 'signal-engine', 'incidents.jsonl'),
): Promise<PostmortemIncident[]> {
  try {
    const raw = await readFile(incidentPath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const incidents: PostmortemIncident[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as PostmortemIncident;
        if (parsed.id && parsed.ticker) incidents.push(parsed);
      } catch {
        // Ignore malformed incident rows.
      }
    }
    return incidents;
  } catch {
    return [];
  }
}

export async function listCalibrationProposals(): Promise<string[]> {
  try {
    const entries = await readdir(proposalDir(), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export async function applyCalibrationProposal(
  proposal: CalibrationProposal,
  approvedBy: string,
): Promise<{ proposal: CalibrationProposal; overrideFilePath: string }> {
  if (proposal.status !== 'ready') {
    throw new Error('Proposal must be in ready state before apply');
  }
  if (!approvedBy.trim()) {
    throw new Error('Manual approval identity is required');
  }

  let currentOverrides: Record<string, unknown> = {};
  try {
    const raw = await readFile(overridePath(), 'utf8');
    currentOverrides = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    currentOverrides = {};
  }

  for (const change of proposal.changes) {
    // Validate that path is still numeric in current runtime config.
    getNumberAtPath(SIGNAL_CONFIG as unknown as Record<string, unknown>, change.path);
    setNumberAtPath(currentOverrides, change.path, change.after);
  }

  await mkdir(path.dirname(overridePath()), { recursive: true });
  await writeFile(overridePath(), JSON.stringify(currentOverrides, null, 2), 'utf8');

  const applied: CalibrationProposal = {
    ...proposal,
    status: 'applied',
    approvedBy: approvedBy.trim(),
    appliedAt: new Date().toISOString(),
  };
  await saveCalibrationProposal(applied);
  return { proposal: applied, overrideFilePath: overridePath() };
}

export function applyOverridesToConfig(
  baseConfig: SignalEngineConfig,
  overrides: Record<string, unknown>,
): SignalEngineConfig {
  const merged = JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>;

  const walk = (prefix: string, value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      if (typeof value === 'number') setNumberAtPath(merged, prefix, value);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      walk(nextPrefix, child);
    }
  };

  walk('', overrides);
  return merged as unknown as SignalEngineConfig;
}
