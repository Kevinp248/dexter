#!/usr/bin/env bun
import {
  appendFillAndRebuild,
  rebuildAndPersistPositionState,
  loadPositionState,
  type FillInput,
} from './portfolio-ledger.js';

type CliArgs = {
  command: 'record' | 'show' | 'rebuild';
  ticker?: string;
  side?: FillInput['side'];
  quantity?: number;
  price?: number;
  feeUsd?: number;
  source?: FillInput['source'];
  note?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const command = (argv[0] ?? 'show').toLowerCase();
  const args: CliArgs = {
    command:
      command === 'record' || command === 'rebuild' || command === 'show'
        ? command
        : 'show',
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--ticker' || arg === '-t') && argv[i + 1]) {
      args.ticker = argv[i + 1].trim().toUpperCase();
      i += 1;
      continue;
    }
    if ((arg === '--side' || arg === '-s') && argv[i + 1]) {
      args.side = argv[i + 1].trim().toUpperCase() as FillInput['side'];
      i += 1;
      continue;
    }
    if ((arg === '--qty' || arg === '-q') && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.quantity = Math.floor(value);
      i += 1;
      continue;
    }
    if ((arg === '--price' || arg === '-p') && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.price = value;
      i += 1;
      continue;
    }
    if (arg === '--fee' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) args.feeUsd = value;
      i += 1;
      continue;
    }
    if (arg === '--source' && argv[i + 1]) {
      const value = argv[i + 1].trim().toLowerCase();
      if (value === 'manual' || value === 'signal') {
        args.source = value;
      }
      i += 1;
      continue;
    }
    if (arg === '--note' && argv[i + 1]) {
      args.note = argv[i + 1];
      i += 1;
    }
  }

  return args;
}

function requireRecordArgs(args: CliArgs): asserts args is CliArgs & {
  ticker: string;
  side: FillInput['side'];
  quantity: number;
  price: number;
} {
  if (!args.ticker || !args.side || !args.quantity || !args.price) {
    throw new Error(
      'record requires --ticker, --side (BUY|SELL|SHORT|COVER), --qty, and --price',
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'rebuild') {
    const snapshot = await rebuildAndPersistPositionState();
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (args.command === 'record') {
    requireRecordArgs(args);
    const result = await appendFillAndRebuild({
      ticker: args.ticker,
      side: args.side,
      quantity: args.quantity,
      price: args.price,
      feeUsd: args.feeUsd ?? 0,
      source: args.source ?? 'manual',
      note: args.note ?? '',
    });
    console.log(
      JSON.stringify(
        {
          recordedFill: result.fill,
          positions: result.snapshot.positions,
          totals: result.snapshot.totals,
        },
        null,
        2,
      ),
    );
    return;
  }

  const snapshot = await loadPositionState();
  if (!snapshot) {
    console.log(
      'No position state found. Record your first trade: bun run trade:ledger record --ticker AAPL --side BUY --qty 10 --price 200',
    );
    return;
  }
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Trade ledger command failed: ${message}`);
  process.exit(1);
});
