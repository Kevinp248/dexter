#!/usr/bin/env bun
import { runWeeklyReviewCli } from './weekly-review.js';

runWeeklyReviewCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOENT')) {
    console.error(
      'Weekly review failed: paper-trade CSV not found. Create .dexter/signal-engine/paper-trade-log.csv using docs/paper-trade-log-template.md, then retry `bun run review:weekly`.',
    );
  } else {
    console.error(`Weekly review failed: ${message}`);
  }
  process.exit(1);
});
