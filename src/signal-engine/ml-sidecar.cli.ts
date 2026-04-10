#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import path from 'node:path';
import { stat } from 'node:fs/promises';

type CliArgs = {
  datasetPath: string;
  outputDir: string;
  targetHorizon: '1d' | '5d';
  pythonBin: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    datasetPath: '',
    outputDir: path.join(process.cwd(), '.dexter', 'signal-engine', 'ml'),
    targetHorizon: '1d',
    pythonBin: process.env.PYTHON_BIN || 'python3',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dataset' && argv[i + 1]) {
      args.datasetPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--output-dir' && argv[i + 1]) {
      args.outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--target' && argv[i + 1]) {
      const target = argv[i + 1].toLowerCase();
      if (target === '1d' || target === '5d') args.targetHorizon = target;
      i += 1;
      continue;
    }
    if (arg === '--python' && argv[i + 1]) {
      args.pythonBin = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.datasetPath) {
    throw new Error('Missing required --dataset path.');
  }
  await stat(args.datasetPath);
  const script = path.join(process.cwd(), 'scripts', 'ml', 'train_eval.py');
  const child = spawn(
    args.pythonBin,
    [script, '--dataset', args.datasetPath, '--output-dir', args.outputDir, '--target-horizon', args.targetHorizon],
    { stdio: 'inherit' },
  );
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ML sidecar exited with code ${code}`));
    });
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ML sidecar run failed: ${message}`);
  process.exit(1);
});
