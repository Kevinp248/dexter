#!/usr/bin/env bun
import { formatDailyOperatorSummary, runDailyOperator } from './daily-operator.js';

type CliArgs = {
  tickers?: string[];
  includePostmortem: boolean;
  includeResearch: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    includePostmortem: true,
    includeResearch: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tickers' && argv[i + 1]) {
      args.tickers = argv[i + 1]
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--skip-postmortem') {
      args.includePostmortem = false;
      continue;
    }
    if (arg === '--with-research') {
      args.includeResearch = true;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runDailyOperator({
    tickers: args.tickers,
    includePostmortem: args.includePostmortem,
    includeResearch: args.includeResearch,
  });
  const lines = formatDailyOperatorSummary(result, args.includePostmortem);
  for (const line of lines) {
    console.log(line);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Daily operator failed: ${message}`);
  process.exit(1);
});
