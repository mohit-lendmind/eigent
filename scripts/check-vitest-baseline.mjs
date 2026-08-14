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
// The failure set is deterministic within one environment (verified across
// repeated full runs), so an exact match is a fair thing to demand. It is NOT
// portable across Node majors: the baseline is recorded on the supported Node
// line, and running the suite on an unsupported one produces failures that
// belong to the runtime rather than to the code. This script says so rather
// than letting them read as regressions.
//
// Usage:
//   node scripts/check-vitest-baseline.mjs
//   node scripts/check-vitest-baseline.mjs --update   # after fixing tests
//   node scripts/check-vitest-baseline.mjs --report path/to/vitest.json
//     (compare an existing JSON report instead of running the suite — this is
//      how the baseline is regenerated from a CI run's uploaded report)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'test', 'vitest-baseline.json');
// Gitignored, and uploaded as a CI artifact so a failing run can be diagnosed
// without re-running it.
const REPORT_PATH = path.join(REPO_ROOT, 'test-results', 'vitest-report.json');

const args = process.argv.slice(2);
const update = args.includes('--update');
const reportFlag = args.indexOf('--report');
const existingReport = reportFlag === -1 ? null : args[reportFlag + 1];

/** The Node line the baseline was recorded on, from package.json engines. */
function supportedNodeMajors() {
  const { engines } = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')
  );
  const range = engines?.node ?? '';
  const min = Number(/>=\s*(\d+)/.exec(range)?.[1] ?? NaN);
  const max = Number(/<\s*(\d+)/.exec(range)?.[1] ?? NaN);
  return { min, max, range };
}

function warnOnUnsupportedNode() {
  const { min, max, range } = supportedNodeMajors();
  const current = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(min) || Number.isNaN(max)) return;
  if (current >= min && current < max) return;
  console.error(
    `WARNING: running on Node ${process.versions.node}, outside package.json ` +
      `engines (${range}). The baseline is recorded on the supported line, so ` +
      `differences reported below may belong to the runtime, not to your change.\n`
  );
}

function runSuite() {
  warnOnUnsupportedNode();
  const outputFile = REPORT_PATH;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
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
  // Stamped beside the report so `--update --report` on a downloaded CI
  // artifact records CI's runtime rather than the machine doing the download,
  // and can strip CI's checkout path off the absolute test file names.
  fs.writeFileSync(
    path.join(path.dirname(outputFile), 'environment.json'),
    `${JSON.stringify(currentEnvironment(), null, 2)}\n`
  );
  return outputFile;
}

function currentEnvironment() {
  return {
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
    repoRoot: REPO_ROOT,
  };
}

/** Where a report was produced, from the sibling stamp if there is one — a
 *  report handed over with `--report` may come from another machine. */
function environmentOf(reportPath) {
  const stamp = path.join(path.dirname(reportPath), 'environment.json');
  if (!fs.existsSync(stamp)) return currentEnvironment();
  try {
    return { ...currentEnvironment(), ...JSON.parse(fs.readFileSync(stamp, 'utf-8')) };
  } catch {
    return currentEnvironment();
  }
}

/** Failing files -> count of failed assertions. A file that fails to collect
 *  reports zero failed assertions, so presence in this map is what marks a
 *  file as failing, not the count. */
function failuresByFile(report, reportRoot) {
  const failing = {};
  for (const file of report.testResults ?? []) {
    const failed = (file.assertionResults ?? []).filter(
      (assertion) => assertion.status === 'failed'
    ).length;
    if (failed === 0 && file.status !== 'failed') continue;
    const rel = path.relative(reportRoot, file.name).split(path.sep).join('/');
    failing[rel] = failed;
  }
  return failing;
}

const reportPath = existingReport ?? runSuite();
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
const { repoRoot, ...recordedOn } = environmentOf(reportPath);
const actual = failuresByFile(report, repoRoot);
const totalTests = report.numTotalTests ?? 0;

if (update) {
  const next = {
    _comment:
      'Pre-existing vitest failures inherited from upstream, as they fail in CI. Regenerate from a CI run: download the `test-results` artifact and run `pnpm check:vitest-baseline -- --update --report <path>`. Explain the movement in your PR.',
    recordedOn,
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

/** A differing runtime explains far more movement than any one change does, so
 *  say it before the developer starts bisecting their own diff. */
function environmentNote() {
  const was = baseline.recordedOn;
  if (!was) return '';
  if (was.node === recordedOn.node && was.platform === recordedOn.platform) {
    return '';
  }
  return (
    `\nThis run is Node ${recordedOn.node} on ${recordedOn.platform}; the ` +
    `baseline was recorded on Node ${was.node} / ${was.platform}. Differences ` +
    `may belong to the runtime rather than to your change — the CI run is the ` +
    `authority.\n`
  );
}

if (regressions.length > 0) {
  console.error('vitest-baseline: FAILED — the suite got worse\n');
  for (const line of regressions) console.error(`  ${line}`);
  if (improvements.length > 0) {
    console.error('\nalso improved (fix the regressions first, then --update):');
    for (const line of improvements) console.error(`  ${line}`);
  }
  console.error(environmentNote());
  process.exit(1);
}

if (improvements.length > 0) {
  console.error('vitest-baseline: FAILED — the suite improved, so tighten it\n');
  for (const line of improvements) console.error(`  ${line}`);
  console.error(
    '\nIf this is a CI run, regenerate the baseline from its `test-results`' +
      '\nartifact — `--update --report <path>` — and commit the result.'
  );
  console.error(environmentNote());
  process.exit(1);
}

console.log(
  `vitest-baseline: unchanged (${Object.keys(actual).length} failing file(s), ` +
    `${report.numFailedTests ?? 0} failed of ${totalTests} tests)`
);
