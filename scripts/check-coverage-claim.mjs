#!/usr/bin/env node
// M4 (FR-008) — the wholeOfMarket lint gate. It is the SECOND belt behind
// makeCoverage() (src/crm/connectors/coverage.ts), which refuses at construction
// a coverage whose statement overclaims. This gate scans git-tracked runtime
// source (src/ + resources/lm-skills/) for the literal phrase "whole of market"
// and fails on any occurrence, because a sourcing surface must never tell an
// adviser it searched the whole market when MCOB 4.4A coverage is a curated
// best-buy table (MSE) or a firm panel. The single legitimate use of the exact
// words is the negation "not whole of market" (the MSE coverage statement), so
// that form is allowed. A definition site or a reviewed exception carries an
// explicit `lm-coverage-allow` marker on the same line.
//
// Zero tolerance, no baseline: the phrase either appears (and fails) or does
// not. It runs from vitest (test/unit/crm/coverage.test.ts spawns it) so CI
// enforces it without a package.json/gates.yml change; it is also runnable by
// hand:
//   node scripts/check-coverage-claim.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim();

const SELF = 'scripts/check-coverage-claim.mjs';

// The normalized forbidden phrase. Kept identical to WHOLE_OF_MARKET_PHRASE in
// coverage.ts so the two belts agree on exactly what is forbidden.
const PHRASE = 'whole of market';

// Only runtime source is in scope: what ships to an adviser. Tests and specs
// legitimately quote the phrase to prove the gate works or to describe it.
const SCOPE = [/^src\//, /^resources\/lm-skills\//];

// The definition site names the phrase to forbid it, so it cannot be its own
// subject. The gate script likewise.
const EXEMPT_FILE = [
  /^src\/crm\/connectors\/coverage\.ts$/,
  new RegExp(`^${SELF.replace(/\./g, '\\.')}$`),
];

// A same-line marker records a deliberate, reviewed exception.
const ALLOW_MARKER = 'lm-coverage-allow';

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf-8',
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

function normalize(line) {
  return line.toLowerCase().replace(/\s+/g, ' ');
}

const violations = [];

for (const rel of trackedFiles()) {
  if (!SCOPE.some((x) => x.test(rel))) continue;
  if (!/\.(ts|tsx|js|jsx|mjs|md|json)$/.test(rel)) continue;
  if (EXEMPT_FILE.some((x) => x.test(rel))) continue;
  let buf;
  try {
    buf = fs.readFileSync(path.join(repoRoot, rel));
  } catch {
    continue;
  }
  if (buf.includes(0)) continue;
  const lines = buf.toString('utf-8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const norm = normalize(raw);
    if (!norm.includes(PHRASE)) continue;
    if (norm.includes(`not ${PHRASE}`)) continue; // the legitimate negation
    if (raw.includes(ALLOW_MARKER)) continue; // reviewed exception
    violations.push({ rel, line: i + 1, text: raw.trim() });
  }
}

if (violations.length > 0) {
  console.error('check-coverage-claim: FAILED\n');
  for (const { rel, line, text } of violations) {
    console.error(`  ${rel}:${line}: ${text}`);
  }
  console.error(
    '\n  A sourcing surface must not claim "whole of market" (MCOB 4.4A): MSE is a\n' +
      '  curated best-buy table and a licensed portal is a firm panel. State the\n' +
      '  real coverage via makeCoverage() with wholeOfMarket:false. The only\n' +
      '  allowed use of the exact words is the negation "not whole of market".\n'
  );
  process.exit(1);
}

console.log('check-coverage-claim: clean (no "whole of market" overclaim)');
