#!/usr/bin/env bun
import path from 'node:path';
import {
  applyCalibrationProposal,
  createCalibrationProposal,
  gateCalibrationProposal,
  listCalibrationProposals,
  loadCalibrationProposal,
  loadIncidentsForCalibration,
  saveCalibrationProposal,
} from './calibration.js';

type Command = 'propose' | 'gate' | 'apply' | 'list';

type CliArgs = {
  command: Command;
  proposal?: string;
  incidentsPath: string;
  approveBy?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const commandRaw = (argv[0] ?? 'list').toLowerCase();
  const command: Command =
    commandRaw === 'propose' ||
    commandRaw === 'gate' ||
    commandRaw === 'apply' ||
    commandRaw === 'list'
      ? commandRaw
      : 'list';
  const args: CliArgs = {
    command,
    incidentsPath: path.join(process.cwd(), '.dexter', 'signal-engine', 'incidents.jsonl'),
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--proposal' || arg === '-p') && argv[i + 1]) {
      args.proposal = argv[i + 1];
      i += 1;
      continue;
    }
    if ((arg === '--incidents' || arg === '-i') && argv[i + 1]) {
      args.incidentsPath = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--approve-by' && argv[i + 1]) {
      args.approveBy = argv[i + 1].trim();
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'list') {
    const proposals = await listCalibrationProposals();
    console.log(JSON.stringify({ proposals }, null, 2));
    return;
  }

  if (args.command === 'propose') {
    const incidents = await loadIncidentsForCalibration(args.incidentsPath);
    const proposal = createCalibrationProposal(incidents);
    const saved = await saveCalibrationProposal(proposal);
    console.log(
      JSON.stringify(
        {
          proposalId: proposal.id,
          status: proposal.status,
          changes: proposal.changes,
          basedOnIncidents: incidents.length,
          path: saved.path,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!args.proposal) {
    throw new Error('command requires --proposal <id|path>');
  }

  if (args.command === 'gate') {
    const proposal = await loadCalibrationProposal(args.proposal);
    const gated = await gateCalibrationProposal(proposal);
    const saved = await saveCalibrationProposal(gated);
    console.log(
      JSON.stringify(
        {
          proposalId: gated.id,
          status: gated.status,
          gate: gated.gate,
          path: saved.path,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!args.approveBy) {
    throw new Error('apply requires --approve-by "<your name>"');
  }
  const proposal = await loadCalibrationProposal(args.proposal);
  const applied = await applyCalibrationProposal(proposal, args.approveBy);
  console.log(
    JSON.stringify(
      {
        proposalId: applied.proposal.id,
        status: applied.proposal.status,
        approvedBy: applied.proposal.approvedBy,
        appliedAt: applied.proposal.appliedAt,
        overrideFilePath: applied.overrideFilePath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Calibration command failed: ${message}`);
  process.exit(1);
});
