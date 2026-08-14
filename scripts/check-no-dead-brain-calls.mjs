#!/usr/bin/env node
// Ratchet on the two non-aion HTTP clients in src/api/http.ts.
//
// `getBaseURL()` resolves a backend this fork no longer ships: the
// `get-backend-port` IPC answers nothing, VITE_BRAIN_ENDPOINT is unset, and the
// fallback is the empty string — so every fetchGet/fetchPost/… lands on a
// relative URL that fails without a visible error. A screen built on it is
// clickable and inert, which is the worst failure mode a UI has: it looks like
// it worked. `getProxyBaseURL()` is the separate hosted cloud, still live but
// not part of the aion product plane, and it retires the same way.
//
// Neither can be deleted in one pass, so this gate freezes the blast radius
// instead: every file that reaches either client today is listed below with its
// reference count, and the gate fails when a file gains references or a new
// file appears. Each milestone that re-points a surface at the edge lowers its
// number here; the finish line is both tables empty.
//
// A count that DROPS also fails. A stale ceiling is how a ratchet rots into
// decoration — if you retired a call, record it.
//
// Its subject is git-tracked source, and it runs from `pnpm lint` rather than as
// a js_test so it also covers files no Bazel filegroup declares.
//
// Usage:
//   node scripts/check-no-dead-brain-calls.mjs
//   node scripts/check-no-dead-brain-calls.mjs --update   # after re-pointing a surface

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim();

const SELF = 'scripts/check-no-dead-brain-calls.mjs';

// The client definitions themselves, and the test that pins their behaviour.
// Exempt as whole files: they are what the ratchet counts down to, and counting
// them would report progress every time the implementation is refactored.
const EXEMPT_FILE = [
  new RegExp(`^${SELF.replace('.', '\\.')}$`),
  /^src\/api\/http\.ts$/,
  /^test\/unit\/api\/http\.test\.ts$/,
  // Fetch doubles: they exist to keep these clients out of a test's real
  // network path, so a reference here is the opposite of a new call site.
  /^test\/mocks\//,
];

const RULES = [
  {
    key: 'dead',
    // Named exports of the getBaseURL() client. Matched on the identifier so a
    // re-export or a renamed import still counts.
    re: /\b(fetchGet|fetchPost|fetchPut|fetchPatch|fetchDelete|fetchPostForm|uploadFileToBrain|sseTransport|getBaseURL|resetBaseURL)\b/,
    why: 'resolves the local backend this fork removed — the call fails silently',
  },
  {
    key: 'hosted',
    re: /\b(proxyFetchGet|proxyFetchPost|proxyFetchPut|proxyFetchPatch|proxyFetchDelete|getProxyBaseURL|uploadFile)\b/,
    why: "reads Eigent's hosted cloud, which holds no aion tenant's data",
  },
];

const BASELINE_PATH = path.join(
  repoRoot,
  'test',
  'dead-brain-calls-baseline.json'
);

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf-8',
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

/** Reference counts per rule key, keyed by repo-relative path. */
function measure() {
  const counts = Object.fromEntries(RULES.map((rule) => [rule.key, {}]));
  for (const rel of trackedFiles()) {
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(rel)) continue;
    if (EXEMPT_FILE.some((x) => x.test(rel))) continue;
    let buf;
    try {
      buf = fs.readFileSync(path.join(repoRoot, rel));
    } catch {
      continue; // submodule or broken link
    }
    if (buf.includes(0)) continue;
    for (const line of buf.toString('utf-8').split('\n')) {
      for (const { key, re } of RULES) {
        if (re.test(line)) counts[key][rel] = (counts[key][rel] ?? 0) + 1;
      }
    }
  }
  return counts;
}

const measured = measure();

if (process.argv.includes('--update')) {
  const total = Object.values(measured).reduce(
    (sum, files) => sum + Object.values(files).reduce((a, b) => a + b, 0),
    0
  );
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        _comment:
          'Ceiling for references to the two non-aion HTTP clients, per file. ' +
          'Regenerate with `node scripts/check-no-dead-brain-calls.mjs --update` ' +
          'when a milestone re-points a surface at the aion edge, and say which ' +
          'surface moved in the PR. Both tables empty is the goal.',
        ...Object.fromEntries(
          RULES.map(({ key }) => [
            key,
            Object.fromEntries(
              Object.entries(measured[key]).sort(([a], [b]) =>
                a.localeCompare(b)
              )
            ),
          ])
        ),
      },
      null,
      2
    )}\n`
  );
  console.log(
    `check-no-dead-brain-calls: recorded ${total} reference(s) across ` +
      `${new Set(RULES.flatMap(({ key }) => Object.keys(measured[key]))).size} file(s)`
  );
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(
    `check-no-dead-brain-calls: ${path.relative(repoRoot, BASELINE_PATH)} is ` +
      'missing. Record it with --update.'
  );
  process.exit(2);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
const regressions = [];
const stale = [];

for (const { key, why } of RULES) {
  const recorded = baseline[key] ?? {};
  for (const [rel, count] of Object.entries(measured[key])) {
    const allowed = recorded[rel] ?? 0;
    if (count > allowed) {
      regressions.push({ key, rel, count, allowed, why });
    }
  }
  for (const [rel, allowed] of Object.entries(recorded)) {
    const count = measured[key][rel] ?? 0;
    if (count < allowed) stale.push({ key, rel, count, allowed });
  }
}

if (regressions.length > 0 || stale.length > 0) {
  console.error('check-no-dead-brain-calls: FAILED\n');
  for (const { key, rel, count, allowed, why } of regressions) {
    console.error(
      `  [${key}] ${rel}: ${allowed} allowed -> ${count} reference(s)`
    );
    console.error(`      ${why}`);
  }
  if (regressions.length > 0) {
    console.error(
      '\n  A new call site on either client is a new surface that cannot serve an\n' +
        '  aion tenant. Read the data from the edge (src/api/aion/v1/transport.ts)\n' +
        '  instead.\n' +
        '\n  A mention in a comment counts as a reference and is meant to: naming one\n' +
        '  of these functions is how the next call site gets written. Describe the\n' +
        '  client rather than naming its exports.\n'
    );
  }
  for (const { key, rel, count, allowed } of stale) {
    console.error(`  [${key}] ${rel}: ${allowed} allowed but only ${count} found`);
  }
  if (stale.length > 0) {
    console.error(
      '\n  The ceiling above is stale — that is progress, so record it:\n' +
        '    node scripts/check-no-dead-brain-calls.mjs --update\n'
    );
  }
  process.exit(1);
}

const remaining = Object.fromEntries(
  RULES.map(({ key }) => [
    key,
    Object.values(measured[key]).reduce((a, b) => a + b, 0),
  ])
);
console.log(
  `check-no-dead-brain-calls: at baseline (dead: ${remaining.dead}, ` +
    `hosted: ${remaining.hosted} reference(s))`
);
