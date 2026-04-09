import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PreviousSignalSnapshot, SignalPayload } from './models.js';

type ScanOutput = {
  generatedAt: string;
  alerts: SignalPayload[];
};

function historyPath(): string {
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'last-scan.json');
}

export async function loadPreviousSignalsByTicker(): Promise<
  Record<string, PreviousSignalSnapshot>
> {
  try {
    const raw = await readFile(historyPath(), 'utf8');
    const parsed = JSON.parse(raw) as ScanOutput;
    const byTicker: Record<string, PreviousSignalSnapshot> = {};
    for (const alert of parsed.alerts ?? []) {
      byTicker[alert.ticker] = {
        generatedAt: alert.generatedAt,
        action: alert.action,
        finalAction: alert.finalAction,
        confidence: alert.confidence,
        aggregateScore: alert.reasoning.aggregateScore,
        weightedInputs: alert.reasoning.weightedInputs,
      };
    }
    return byTicker;
  } catch {
    return {};
  }
}

export async function saveLatestScan(scan: ScanOutput): Promise<void> {
  const target = historyPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(scan, null, 2), 'utf8');
}
