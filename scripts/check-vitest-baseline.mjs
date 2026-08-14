#!/usr/bin/env node
// Gates the vitest suite against a recorded baseline of pre-existing failures.
//
// The suite inherits 23 failing files from upstream, so `vitest run` can never
// be a pass/fail gate on its own — a red run says nothing about the change that
// produced it. This compares the run against test/vitest-baseline.json and
// fails on movement in either direction:
//
//   - a file that starts failing, or fails more than recorded  -> regression
//   - a file that stops failing, or fails less than recorded   -> the baseline
//     is stale, and leaving it stale is how a gate rots into decoration
//   - fewer tests collected than recorded -> tests were deleted, which would
//     otherwise be a silent way to make the numbers look better
//
// The failure set is deterministic (verified across repeated full runs), so an
// exact match is a fair thing to demand.
//
// Usage:
//   node scripts/check-vitest-baseline.mjs
//   node scripts/check-vitest-baseline.mjs --update   # after fixing tests
//   node scripts/check-vitest-baseline.mjs --report path/to/vitest.json
//     (compare an existing JSON report instead of running the suite)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'test', 'vitest-baseline.json');

const args = process.argv.slice(2);
const update = args.includes('--update');
const reportFlag = args.indexOf('--report');
const existingReport = reportFlag === -1 ? null : args[reportFlag + 1];

function runSuite() {
  const outputFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-baseline-')),
    'report.json'
  );
  const vitest = path.join(REPO_ROOT, 'node_modules', '.bin', 'vitest');
  if (!fs.existsSync(vitest)) {
    console.error(`vitest not found at ${vitest} — run an install first.`);
    process.exit(2);
  }
  // The suite's own exit code is expected to be non-zero; the verdict is the
  // comparison below, not vitest's status.
  const result = spawnSync(
    vitest,
    ['run', '--reporter=json', `--outputFile=${outputFile}`],
    { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  if (!fs.existsSync(outputFile)) {
    console.error('vitest produced no JSON report; it likely failed to start.');
    console.error(result.stdout?.slice(-4000) ?? '');
    process.exit(2);
  }
  return outputFile;
}

/** Failing files -> count of failed assertions. A file that fails to collect
 *  reports zero failed assertions, so presence in this map is what marks a
 *  file as failing, not the count. */
function failuresByFile(report) {
  const failing = {};
  for (const file of report.testResults ?? []) {
    const failed = (file.assertionResults ?? []).filter(
      (assertion) => assertion.status === 'failed'
    ).length;
    if (failed === 0 && file.status !== 'failed') continue;
    const rel = path.relative(REPO_ROOT, file.name).split(path.sep).join('/');
    failing[rel] = failed;
  }
  return failing;
}

const reportPath = existingReport ?? runSuite();
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
const actual = failuresByFile(report);
const totalTests = report.numTotalTests ?? 0;

if (update) {
  const next = {
    _comment:
      'Pre-existing vitest failures inherited from upstream. Regenerate with `pnpm check:vitest-baseline -- --update` and explain the movement in your PR.',
    totalTests,
    totalFailedTests: report.numFailedTests ?? 0,
    failingFiles: Object.fromEntries(
      Object.keys(actual)
        .sort()
        .map((file) => [file, actual[file]])
    ),
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `vitest-baseline: recorded ${Object.keys(actual).length} failing file(s), ` +
      `${next.totalFailedTests} failed of ${totalTests} tests`
  );
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(
    `no baseline at ${path.relative(REPO_ROOT, BASELINE_PATH)} — create it with --update`
  );
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
const expected = baseline.failingFiles ?? {};

const regressions = [];
const improvements = [];

for (const [file, failed] of Object.entries(actual)) {
  if (!(file in expected)) {
    regressions.push(`${file}: newly failing (${failed} failed test(s))`);
  } else if (failed > expected[file]) {
    regressions.push(`${file}: ${expected[file]} -> ${failed} failed test(s)`);
  }
}
for (const [file, failed] of Object.entries(expected)) {
  if (!(file in actual)) {
    improvements.push(`${file}: now fully passing`);
  } else if (actual[file] < failed) {
    improvements.push(`${file}: ${failed} -> ${actual[file]} failed test(s)`);
  }
}
if (totalTests < baseline.totalTests) {
  regressions.push(
    `${baseline.totalTests - totalTests} test(s) disappeared from the suite ` +
      `(${baseline.totalTests} -> ${totalTests})`
  );
}

if (regressions.length > 0) {
  console.error('vitest-baseline: FAILED — the suite got worse\n');
  for (const line of regressions) console.error(`  ${line}`);
  if (improvements.length > 0) {
    console.error('\nalso improved (fix the regressions first, then --update):');
    for (const line of improvements) console.error(`  ${line}`);
  }
  process.exit(1);
}

if (improvements.length > 0) {
  console.error('vitest-baseline: FAILED — the suite improved, so tighten it\n');
  for (const line of improvements) console.error(`  ${line}`);
  console.error(
    '\nRun `pnpm check:vitest-baseline -- --update` and commit the result.'
  );
  process.exit(1);
}

console.log(
  `vitest-baseline: unchanged (${Object.keys(actual).length} failing file(s), ` +
    `${report.numFailedTests ?? 0} failed of ${totalTests} tests)`
);
