import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildOfflinePolicyReviewReport,
  type OfflinePolicyReviewReport,
} from '../validation/offline-policy-review.js';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('offline policy review', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'offline-policy-review-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function buildFixtureReport(): Promise<OfflinePolicyReviewReport> {
    const parityFile = path.join(tmpDir, 'parity-validation-a.json');
    const walkForwardFile = path.join(tmpDir, 'parity-walk-forward-b.json');
    const summaryOnlyFile = path.join(tmpDir, 'parity-walk-forward-summary.json');

    await writeJson(parityFile, {
      config: { tickers: ['MSFT', 'AAPL'], startDate: '2026-01-01', endDate: '2026-01-31' },
      rows: [
        {
          asOfDate: '2026-01-02',
          ticker: 'AAPL',
          aggregateScore: 0.4,
          riskScore: 0.7,
          valuationScore: -1,
          rawAction: 'HOLD',
          finalAction: 'HOLD',
        },
        {
          asOfDate: '2026-01-03',
          ticker: 'MSFT',
          aggregateScore: -0.3,
          riskScore: 0.8,
          valuationScore: -1,
          rawAction: 'HOLD',
          finalAction: 'HOLD',
        },
      ],
    });

    await writeJson(walkForwardFile, {
      dateWindow: { startDate: '2026-01-01', endDate: '2026-02-01' },
      universe: { effectiveTickers: ['NVDA'] },
      walkForward: {
        foldEvaluations: [
          {
            validationRows: [
              {
                asOfDate: '2026-01-04',
                ticker: 'NVDA',
                aggregateScore: 0.02,
                riskScore: 0.6,
                valuationScore: -1,
                rawAction: 'HOLD',
                finalAction: 'HOLD',
              },
            ],
          },
          {
            validationRows: [
              {
                asOfDate: '2026-01-05',
                ticker: 'TSLA',
                aggregateScore: 0.35,
                riskScore: 0.9,
                valuationScore: -1,
                rawAction: 'HOLD',
                finalAction: 'HOLD',
              },
            ],
          },
        ],
      },
    });

    await writeJson(summaryOnlyFile, {
      dateWindow: { startDate: '2026-01-01', endDate: '2026-03-31' },
      walkForward: { folds: [] },
      warnings: ['metadata only'],
    });

    return buildOfflinePolicyReviewReport({
      directories: [tmpDir],
    });
  }

  test('parses replayable row artifacts correctly and includes per-artifact coverage', async () => {
    const report = await buildFixtureReport();

    expect(report.artifacts).toHaveLength(3);
    expect(report.replay.replayableRows).toBe(4);
    expect(report.replay.totalRowPayloadsFound).toBe(4);

    const parityCoverage = report.artifacts.find((item) => item.path.endsWith('parity-validation-a.json'));
    expect(parityCoverage).toBeDefined();
    expect(parityCoverage?.artifactType).toBe('parity_validation');
    expect(parityCoverage?.rowPayloadCount).toBe(2);
    expect(parityCoverage?.replayableRowCount).toBe(2);

    const walkForwardCoverage = report.artifacts.find((item) =>
      item.path.endsWith('parity-walk-forward-b.json'),
    );
    expect(walkForwardCoverage?.artifactType).toBe('parity_walk_forward');
    expect(walkForwardCoverage?.rowPayloadCount).toBe(2);
    expect(walkForwardCoverage?.replayableRowCount).toBe(2);
    expect(walkForwardCoverage?.symbols).toEqual(['NVDA', 'TSLA']);

    const summaryOnlyCoverage = report.artifacts.find((item) =>
      item.path.endsWith('parity-walk-forward-summary.json'),
    );
    expect(summaryOnlyCoverage?.rowPayloadCount).toBe(0);
    expect(summaryOnlyCoverage?.replayableRowCount).toBe(0);
    expect(summaryOnlyCoverage?.notes.some((note) => note.includes('No row payloads found'))).toBe(true);
  });

  test('ignores summary-only artifacts without crashing', async () => {
    const summaryOnly = path.join(tmpDir, 'summary-only.json');
    await writeJson(summaryOnly, {
      walkForward: { folds: [] },
      holdout: null,
    });

    const report = await buildOfflinePolicyReviewReport({ files: [summaryOnly] });
    expect(report.replay.replayableRows).toBe(0);
    expect(report.warnings.some((warning) => warning.includes('No replayable rows found'))).toBe(true);
  });

  test('computes threshold sensitivity correctly', async () => {
    const report = await buildFixtureReport();

    const bySet = new Map(
      report.replay.actionCountsByThresholdSet.map((item) => [item.thresholdSet, item.actionCounts]),
    );

    expect(bySet.get('A')).toEqual({ BUY: 0, SELL: 0, HOLD: 4 });
    expect(bySet.get('B')).toEqual({ BUY: 2, SELL: 0, HOLD: 2 });
    expect(bySet.get('C')).toEqual({ BUY: 2, SELL: 1, HOLD: 1 });
    expect(bySet.get('D')).toEqual({ BUY: 2, SELL: 1, HOLD: 1 });
  });

  test('computes valuation-only and combined sensitivity correctly', async () => {
    const report = await buildFixtureReport();

    expect(report.replay.holdFlipAttribution.baselineHoldRows).toBe(4);
    expect(report.replay.holdFlipAttribution.thresholdOnly).toBe(1);
    expect(report.replay.holdFlipAttribution.valuationOnly).toBe(0);
    expect(report.replay.holdFlipAttribution.combinedOnly).toBe(3);
    expect(report.replay.holdFlipAttribution.noFlip).toBe(0);
    expect(report.replay.holdFlipAttribution.totalFlippedByAnyScenario).toBe(4);
    expect(report.replay.holdFlipAttribution.totalFlippedByAnyScenario).toBe(
      report.replay.holdFlipAttribution.thresholdOnly +
        report.replay.holdFlipAttribution.valuationOnly +
        report.replay.holdFlipAttribution.combinedOnly,
    );
    expect(report.replay.holdFlipAttribution.totalFlippedByAnyScenario).toBe(
      report.replay.holdFlipAttribution.baselineHoldRows -
        report.replay.holdFlipAttribution.noFlip,
    );

    const valuationCases = new Map(
      report.replay.valuationSensitivity.cases.map((item) => [item.valuationCase, item]),
    );
    expect(valuationCases.get('saved')?.actionCountsAtSetA).toEqual({ BUY: 0, SELL: 0, HOLD: 4 });
    expect(valuationCases.get('0')?.actionCountsAtSetA).toEqual({ BUY: 2, SELL: 0, HOLD: 2 });
    expect(valuationCases.get('0')?.holdToNonHoldFlipsAtSetA).toBe(2);

    const combinedCell = report.replay.combinedThresholdValuationMatrix.find(
      (item) => item.thresholdSet === 'D' && item.valuationCase === '0',
    );
    expect(combinedCell).toBeDefined();
    expect(combinedCell?.actionCounts).toEqual({ BUY: 3, SELL: 0, HOLD: 1 });
    expect(combinedCell?.holdToNonHoldFlips).toBe(3);
  });

  test('deterministic output ordering', async () => {
    const report = await buildFixtureReport();

    const artifactPaths = report.artifacts.map((item) => item.path);
    const sortedArtifactPaths = [...artifactPaths].sort((a, b) => a.localeCompare(b));
    expect(artifactPaths).toEqual(sortedArtifactPaths);

    expect(report.replay.actionCountsByThresholdSet.map((item) => item.thresholdSet)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);

    const matrixOrder = report.replay.combinedThresholdValuationMatrix.map(
      (item) => `${item.thresholdSet}|${item.valuationCase}`,
    );
    expect(matrixOrder[0]).toBe('A|saved');
    expect(matrixOrder[matrixOrder.length - 1]).toBe('D|0');
  });

  test('empty input set handled cleanly', async () => {
    const report = await buildOfflinePolicyReviewReport({
      directories: [path.join(tmpDir, 'missing-dir')],
    });

    expect(report.artifacts).toHaveLength(0);
    expect(report.replay.replayableRows).toBe(0);
    expect(report.warnings.some((warning) => warning.includes('No input JSON files found'))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('No replayable rows found'))).toBe(true);
  });
});
