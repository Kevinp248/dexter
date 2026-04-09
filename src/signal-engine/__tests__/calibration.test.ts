import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  applyCalibrationProposal,
  createCalibrationProposal,
  gateCalibrationProposal,
  saveCalibrationProposal,
} from '../calibration.js';
import { PostmortemIncident } from '../postmortem.js';

describe('calibration pipeline', () => {
  test('gate blocks proposal when checks fail', async () => {
    const incidents: PostmortemIncident[] = [
      {
        id: 'inc-1',
        createdAt: '2026-04-09T12:00:00.000Z',
        ticker: 'AAPL',
        type: 'loss',
        severity: 'high',
        summary: 'Loss',
        trigger: { resultPct: -3, expectedEdgeAfterCostsBps: 100, divergenceBps: 400 },
        rootCauseHypotheses: ['Data fallback was used; signal quality may be reduced'],
        recommendations: ['Retry after close'],
        evidence: {
          claim: 'test',
          retrievedAt: '2026-04-09T12:00:00.000Z',
          accepted: [],
          rejected: [],
        },
      },
    ];

    const proposal = createCalibrationProposal(incidents, '2026-04-09T12:00:00.000Z');
    const gated = await gateCalibrationProposal(proposal, {
      run: async (_cmd, args) => !args.includes('test:signals'),
    });

    expect(gated.status).toBe('blocked');
    expect(gated.gate?.typecheckPassed).toBe(true);
    expect(gated.gate?.signalTestsPassed).toBe(false);
  });

  test('apply requires ready state and writes overrides with manual approval', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'dexter-calibration-'));
    const previousCwd = process.cwd();
    process.chdir(tmp);
    try {
      const proposal = {
        id: 'proposal-20260409120000',
        createdAt: '2026-04-09T12:00:00.000Z',
        status: 'ready',
        rationale: 'test',
        expectedImpact: 'test',
        basedOnIncidentIds: ['inc-1'],
        changes: [
          {
            path: 'actions.buyScoreThreshold',
            before: 0.5,
            after: 0.55,
            reason: 'tighten',
          },
        ],
      } as const;

      await saveCalibrationProposal(proposal as any);
      const result = await applyCalibrationProposal(proposal as any, 'Kevin');
      const raw = await readFile(
        path.join(tmp, '.dexter', 'signal-engine', 'config-overrides.json'),
        'utf8',
      );
      const parsed = JSON.parse(raw) as { actions?: { buyScoreThreshold?: number } };

      expect(result.proposal.status).toBe('applied');
      expect(parsed.actions?.buyScoreThreshold).toBe(0.55);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
