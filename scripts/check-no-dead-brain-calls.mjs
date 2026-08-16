#!/usr/bin/env node
// Keeps the two retired HTTP clients from coming back.
//
// One resolved a backend this fork no longer ships: its endpoint IPC answered
// nothing and the fallback was the empty string, so every call landed on a
// relative URL that failed without a visible error. A screen built on it was
// clickable and inert, which is the worst failure mode a UI has — it looks like
// it worked. The other read Eigent's hosted cloud, which holds no aion tenant's
// data. Both are deleted; the aion edge (src/api/aion/v1/transport.ts) is the
// only remote this app has.
//
// The tables below are empty and must stay that way. Naming one of these
// exports anywhere in git-tracked source — a comment counts, because naming one
// is how the next call site gets written — fails the gate. The per-file ceiling
// machinery is kept so a deliberate, reviewed exception is recordable rather
// than requiring the gate to be switched off.
//
// A count that DROPS also fails. A stale ceiling is how a gate rots into
// decoration — if you retired a call, record it.
//
// Its subject is git-tracked source, and it runs from `pnpm lint` rather than as
// a js_test so it also covers files no Bazel filegroup declares.
//
// Usage:
//   node scripts/check-no-dead-brain-calls.mjs
//   node scripts/check-no-dead-brain-calls.mjs --update   # only to record a reviewed exception

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim();

const SELF = 'scripts/check-no-dead-brain-calls.mjs';

// This file names every export it forbids, so it cannot be its own subject.
const EXEMPT_FILE = [new RegExp(`^${SELF.replace('.', '\\.')}$`)];

const RULES = [
  {
    key: 'dead',
    // Named exports of the getBaseURL() client. Matched on the identifier so a
    // re-export or a renamed import still counts.
    re: /\b(fetchGet|fetchPost|fetchPut|fetchPatch|fetchDelete|fetchPostForm|uploadFileToBrain|sseTransport|getBaseURL|resetBaseURL)\b/,
    why: 'names the deleted local-backend client — a call on it fails silently',
  },
  {
    key: 'hosted',
    re: /\b(proxyFetchGet|proxyFetchPost|proxyFetchPut|proxyFetchPatch|proxyFetchDelete|getProxyBaseURL|uploadFile)\b/,
    why: "names the deleted hosted-cloud client, which held no aion tenant's data",
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
          'Both HTTP clients are deleted, so both tables are empty and are ' +
          'meant to stay that way. Regenerate with ' +
          '`node scripts/check-no-dead-brain-calls.mjs --update` only to record ' +
          'a reviewed exception, and say in the PR why the reference is not a ' +
          'new call site.',
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
      '\n  Both clients are deleted. A reference to one is either a call site that\n' +
        '  cannot serve an aion tenant, or a name that invites one — read the data\n' +
        '  from the edge (src/api/aion/v1/transport.ts) instead.\n' +
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
  remaining.dead === 0 && remaining.hosted === 0
    ? 'check-no-dead-brain-calls: clean (both clients retired)'
    : `check-no-dead-brain-calls: at baseline (dead: ${remaining.dead}, ` +
        `hosted: ${remaining.hosted} reference(s))`
);
