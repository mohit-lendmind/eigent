#!/usr/bin/env node
// Source gate: this fork's desktop talks only to an aion edge, so no CAMEL
// framework code and no Python service of its own may re-enter the tree — not
// as source, not as a build step, not as a leftover reference in config.
//
// A re-import would be silent: the desktop would still start, and the
// regression would only surface as a fat package or a second control plane.
// So the check runs on git-tracked source, with an explicit allowlist for the
// three legitimate reasons a match can appear.
//
// Its subject is the whole git-tracked repository — docs, CI workflows and
// dotfiles included, since that is where an install step reappears first. No
// Bazel filegroup here declares that set, so this gate runs from `pnpm lint`
// rather than as a js_test; hosting it over :desktop_sources would silently
// stop covering README.md and .github/.
//
// Usage: node scripts/check-no-legacy-backend.mjs
// Exits 1 with the offending path:line on any violation.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
}).trim();

const tracked = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf-8',
  cwd: repoRoot,
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean);

// Whole files exempt from the content scan.
const EXEMPT_FILE = [
  // This gate names what it forbids.
  /^scripts\/check-no-legacy-backend\.mjs$/,
  // The package gate's forbidden-path patterns name the same things.
  /^scripts\/inspect-package\.mjs$/,
  // Dependency lockfiles: transitive package names are not ours to choose.
  /^pnpm-lock\.yaml$/,
  /^MODULE\.bazel\.lock$/,
  // Vendored third-party dist output.
  /^package\//,
  // Skill payloads execute in the aion cell, not on the desktop.
  /^resources\/example-skills\//,
  // CodeQL's language list is boilerplate from the upstream action.
  /^\.github\/(workflows\/codeql\.yml|codeql\/codeql-config\.yml)$/,
];

// Substrings that make an individual matched line legitimate.
const EXEMPT_LINE = [
  // Unrelated word: casing helpers in dependency and vendored code.
  'camelCase',
  'camelcase',
  'decamelize',
  // node-pty ships a prebuilt native helper; nothing to do with a Python tree.
  "node-pty's prebuilt",
];

const CONTENT_RULES = [
  {
    name: 'camel-reference',
    re: /camel/i,
    why: 'the CAMEL framework is not part of this fork',
    // These two docs exist partly to say what was removed. Waiving one rule
    // rather than the whole file keeps the Python-runtime rules live in them,
    // which is where an upstream install step would be copied back in.
    exempt: [/^README\.md$/, /^CONTRIBUTING\.md$/],
  },
  {
    name: 'python-service-runtime',
    re: /\buvicorn\b|\buv sync\b|\buv run\b|pyproject\.toml|site-packages|pyvenv\.cfg|(^|[^\w.])\.venv\b/,
    why: 'the desktop runs no Python service of its own',
  },
  {
    name: 'local-backend-tree',
    re: /(^|[\s'"`(/])(backend|server)\/(?!README)[\w.-]+\.py\b/,
    why: 'Eigent’s backend/ and server/ Python trees were removed',
  },
];

// Paths that may not come back at all, regardless of content.
const FORBIDDEN_PATH = [
  { name: 'python-source', re: /\.pyi?$/ },
  { name: 'python-project', re: /(^|\/)(pyproject\.toml|uv\.lock|requirements[^/]*\.txt)$/ },
  { name: 'backend-tree', re: /^(backend|server)\// },
  { name: 'prebuilt-payload', re: /^resources\/prebuilt\// },
];

const violations = [];

for (const rel of tracked) {
  for (const { name, re } of FORBIDDEN_PATH) {
    if (re.test(rel) && !EXEMPT_FILE.some((x) => x.test(rel))) {
      violations.push({ kind: name, at: rel, line: '(path)' });
    }
  }

  if (EXEMPT_FILE.some((x) => x.test(rel))) continue;

  const full = path.join(repoRoot, rel);
  let buf;
  try {
    buf = fs.readFileSync(full);
  } catch {
    continue; // submodule or broken link
  }
  if (buf.includes(0)) continue; // binary
  const lines = buf.toString('utf-8').split('\n');
  for (const [i, line] of lines.entries()) {
    if (EXEMPT_LINE.some((x) => line.includes(x))) continue;
    for (const { name, re, why, exempt } of CONTENT_RULES) {
      if (exempt?.some((x) => x.test(rel))) continue;
      if (re.test(line)) {
        violations.push({
          kind: name,
          at: `${rel}:${i + 1}`,
          line: line.trim().slice(0, 120),
          why,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `check-no-legacy-backend: ${violations.length} violation(s) in ${tracked.length} tracked files\n`
  );
  for (const v of violations) {
    console.error(`  [${v.kind}] ${v.at}`);
    if (v.why) console.error(`      ${v.why}`);
    if (v.line !== '(path)') console.error(`      > ${v.line}`);
  }
  console.error(
    '\nIf a match is legitimate, add it to EXEMPT_FILE, EXEMPT_LINE, or a single' +
      "\nrule's `exempt` list — with the reason."
  );
  process.exit(1);
}

console.log(
  `check-no-legacy-backend: clean (${tracked.length} tracked files scanned)`
);
