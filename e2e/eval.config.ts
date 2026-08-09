// One-off evaluation driver config (task: deep-research financial-analysis
// evaluation on the live eigent-local stack). Not part of the committed test
// suites: *.eval.ts is disjoint from the *.e2e.ts testMatch on purpose.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.eval.ts',
  // A real-model deep-research run is minutes of tool loops; the spec's own
  // RUN_TIMEOUT_MS (25 min) plus setup/replay must fit inside this.
  timeout: 1_800_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results/eval-artifacts',
  use: { trace: 'off' },
});
