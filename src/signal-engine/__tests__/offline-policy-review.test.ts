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
    const scenarioManifestFile = path.join(tmpDir, 'offline-calibration-scenarios.v1.json');

    await writeJson(scenarioManifestFile, {
      version: 'test-v1',
      scenarios: [
        {
          id: 'baseline',
          name: 'Baseline',
          description: 'Baseline policy',
          policy: {
            buyScoreThreshold: 0.5,
            sellScoreThreshold: -0.45,
            buyRiskThreshold: 0.35,
            buyScoreThresholdAddRiskOff: 0.12,
          },
        },
        {
          id: 'thresholds_only',
          name: 'Thresholds only',
          description: 'Moderate threshold softening',
          policy: {
            buyScoreThreshold: 0.35,
            sellScoreThreshold: -0.35,
            buyRiskThreshold: 0.35,
            buyScoreThresholdAddRiskOff: 0.12,
          },
        },
        {
          id: 'thresholds_with_reweight',
          name: 'Thresholds + reweight',
          description: 'Moderate thresholds and reduced valuation weight',
          policy: {
            buyScoreThreshold: 0.35,
            sellScoreThreshold: -0.35,
            buyRiskThreshold: 0.35,
            buyScoreThresholdAddRiskOff: 0.12,
          },
          aggregateWeights: {
            technical: 0.39,
            fundamentals: 0.31,
            valuation: 0.12,
            sentiment: 0.18,
          },
        },
      ],
    });

    await writeJson(parityFile, {
      config: { tickers: ['MSFT', 'AAPL'], startDate: '2026-01-01', endDate: '2026-01-31' },
      rows: [
        {
          asOfDate: '2026-01-02',
          ticker: 'AAPL',
          aggregateScore: 0.4,
          riskScore: 0.7,
          technicalScore: 0.4,
          fundamentalsScore: 0.5,
          valuationScore: -1,
          sentimentScore: 0.1,
          regimeState: 'risk_on',
          rawAction: 'HOLD',
          finalAction: 'HOLD',
        },
        {
          asOfDate: '2026-01-03',
          ticker: 'MSFT',
          aggregateScore: -0.3,
          riskScore: 0.8,
          technicalScore: -0.3,
          fundamentalsScore: -0.2,
          valuationScore: -1,
          sentimentScore: 0,
          regimeState: 'risk_off',
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
                technicalScore: 0.02,
                fundamentalsScore: 0.2,
                valuationScore: -1,
                sentimentScore: 0.05,
                regimeState: 'risk_off',
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
                technicalScore: 0.35,
                fundamentalsScore: 0.2,
                valuationScore: -1,
                sentimentScore: 0.1,
                regimeState: 'risk_on',
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
      files: [parityFile, walkForwardFile, summaryOnlyFile],
      scenarioManifestPath: scenarioManifestFile,
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
      report.replay.actionCountsByThresholdReplaySet.map((item) => [item.thresholdSet, item.actionCounts]),
    );
    expect(report.replay.thresholdReplayBaselineSetName).toBe('A');
    expect(report.replay.actionCountsThresholdReplayBaseline).toEqual({ BUY: 0, SELL: 0, HOLD: 4 });

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

    expect(report.replay.actionCountsByThresholdReplaySet.map((item) => item.thresholdSet)).toEqual([
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

    expect(report.calibrationScenarios).not.toBeNull();
    const scenarioIds = report.calibrationScenarios?.scenarios.map((item) => item.id);
    expect(scenarioIds).toEqual(['baseline', 'thresholds_only', 'thresholds_with_reweight']);
  });

  test('calibration scenarios include baseline-vs-scenario comparison with HOLD attribution', async () => {
    const report = await buildFixtureReport();
    expect(report.calibrationScenarios).not.toBeNull();
    const scenarios = report.calibrationScenarios?.scenarios ?? [];
    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    expect(report.calibrationScenarios?.baselineScenarioId).toBe('baseline');

    const baseline = byId.get('baseline');
    const thresholdsOnly = byId.get('thresholds_only');
    const thresholdsWithReweight = byId.get('thresholds_with_reweight');
    expect(baseline?.actionCounts).toEqual({ BUY: 0, SELL: 0, HOLD: 4 });
    expect(thresholdsOnly?.actionCounts).toEqual({ BUY: 2, SELL: 0, HOLD: 2 });
    expect(thresholdsWithReweight?.actionCounts).toEqual({ BUY: 0, SELL: 0, HOLD: 4 });

    expect(thresholdsOnly?.holdFlipAttribution).toEqual({
      baselineHoldRows: 4,
      holdToBuy: 2,
      holdToSell: 0,
      holdToNonHold: 2,
      holdStayedHold: 2,
    });
    expect(thresholdsOnly?.deltaVsBaseline).toEqual({
      buyDelta: 2,
      sellDelta: 0,
      holdDelta: -2,
      holdToNonHoldDelta: 2,
    });
    expect(thresholdsWithReweight?.diagnostics.rowsUsingReweightedAggregate).toBe(4);
    expect(thresholdsWithReweight?.diagnostics.rowsMissingComponentBreakdownForReweight).toBe(0);
    expect(thresholdsWithReweight?.diagnostics.rowsUsingRiskOffUplift).toBe(2);
  });

  test('distinguishes threshold replay baseline from scenario baseline for risk_off rows', async () => {
    const rowsFile = path.join(tmpDir, 'risk-off-row.json');
    const scenarioManifestFile = path.join(tmpDir, 'scenario-manifest.json');

    await writeJson(rowsFile, {
      rows: [
        {
          asOfDate: '2026-01-06',
          ticker: 'AAPL',
          aggregateScore: 0.52,
          riskScore: 0.9,
          technicalScore: 0.5,
          fundamentalsScore: 0.5,
          valuationScore: 0.2,
          sentimentScore: 0.4,
          regimeState: 'risk_off',
          rawAction: 'HOLD',
          finalAction: 'HOLD',
        },
      ],
    });
    await writeJson(scenarioManifestFile, {
      version: 'test-risk-off',
      scenarios: [
        {
          id: 'baseline',
          name: 'Baseline',
          description: 'Baseline with risk-off uplift',
          policy: {
            buyScoreThreshold: 0.5,
            sellScoreThreshold: -0.45,
            buyRiskThreshold: 0.35,
            buyScoreThresholdAddRiskOff: 0.12,
          },
        },
      ],
    });

    const report = await buildOfflinePolicyReviewReport({
      files: [rowsFile],
      scenarioManifestPath: scenarioManifestFile,
    });

    // Threshold replay Set A does not include regime buy uplift and BUYs this row.
    expect(report.replay.actionCountsThresholdReplayBaseline).toEqual({ BUY: 1, SELL: 0, HOLD: 0 });

    // Calibration baseline includes risk-off uplift and therefore keeps this row HOLD.
    const baselineScenario = report.calibrationScenarios?.scenarios.find((scenario) => scenario.id === 'baseline');
    expect(baselineScenario?.actionCounts).toEqual({ BUY: 0, SELL: 0, HOLD: 1 });
    expect(baselineScenario?.holdFlipAttribution.baselineHoldRows).toBe(1);
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
