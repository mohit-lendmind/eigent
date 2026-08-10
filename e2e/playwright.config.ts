// Playwright config for the M4-I development Electron E2E (doc 10 §10):
// drives the REAL desktop app in remote-backend mode against the eigent-local
// Compose edge. One worker, serial — the suite shares one Compose stack and
// one Electron instance per test group.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../test-results/e2e-report.json' }]],
  outputDir: '../test-results/e2e-artifacts',
  use: {
    trace: 'retain-on-failure',
  },
});
