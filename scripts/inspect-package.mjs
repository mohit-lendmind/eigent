#!/usr/bin/env node
// Package inspection gate (doc 10 §11 LVG): asserts the packaged desktop app
// carries no runtime of its own beyond Electron — everything it executes runs
// in the aion cell, reached over the edge API. Violations are the doc's closed
// list: .py files, a Python/uv/uvicorn runtime, an embedded service payload, a
// Go harness/service binary, a local database, provider SDK/key material, a
// Docker socket client, or an internal (non-edge) service endpoint.
//
// Usage: node scripts/inspect-package.mjs <release-dir-or-app-root>
//   e.g. release            (auto-discovers mac-arm64/Eigent.app,
//                            linux-unpacked, win-unpacked)
//   e.g. release/mac-arm64/Eigent.app
// Prints a JSON report to stdout; exits 1 on any violation.
//
// asar archives are read with a built-in header parser (16-byte pickle
// prelude + JSON index) so the gate has no dependency on @electron/asar,
// which is only a transitive dep and not linkable under rules_js.

import fs from 'node:fs';
import path from 'node:path';

const argRoot = process.argv[2];
if (!argRoot || !fs.existsSync(argRoot)) {
  console.error(
    'usage: inspect-package.mjs <release dir, .app bundle, or unpacked dir>'
  );
  process.exit(2);
}

// Accept either the electron-builder output root or a specific app root.
function discoverAppRoot(root) {
  if (/\.app$/.test(root) || /-unpacked$/.test(root)) return root;
  const candidates = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (/\.app$/.test(entry.name) || /-unpacked$/.test(entry.name)) {
        candidates.push(full);
      } else if (path.relative(root, full).split(path.sep).length <= 2) {
        stack.push(full);
      }
    }
  }
  if (candidates.length !== 1) {
    console.error(
      `expected exactly one packaged app under ${root}, found: ${
        candidates.join(', ') || '(none)'
      }`
    );
    process.exit(2);
  }
  return candidates[0];
}

const appRoot = discoverAppRoot(argRoot);
const violations = [];

// --- forbidden path patterns ------------------------------------------------

const FORBIDDEN_PATH = [
  { name: 'python-source', re: /\.pyc?$|\.pyo$|\.pyi$/ },
  {
    name: 'python-uv-runtime',
    re: /(^|\/)(python[0-9.]*|uv|uvx|uvicorn|bun)(\.exe)?$/,
  },
  {
    name: 'embedded-service-payload',
    re: /(^|\/)(backend|prebuilt|uv_python|terminal_venv)(\/|$)/,
  },
  { name: 'venv', re: /(^|\/)(\.venv|venv|site-packages|pyvenv\.cfg)(\/|$)/ },
  { name: 'local-database', re: /\.(sqlite3?|db)$/ },
  {
    name: 'go-service-binary',
    re: /(^|\/)aion-(server|edge|ops-api|ops-worker|docker-sandbox)[^/]*$/,
  },
];

function checkPath(rel, provenance) {
  for (const { name, re } of FORBIDDEN_PATH) {
    if (re.test(rel)) violations.push({ kind: name, path: provenance });
  }
}

// --- file-tree scan ---------------------------------------------------------

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink() || entry.isFile()) {
      files.push(full);
    } else if (entry.isDirectory()) {
      walk(full, files);
    }
  }
  return files;
}

const allFiles = walk(appRoot).map((f) => path.relative(appRoot, f));
for (const rel of allFiles) checkPath(rel, rel);

// --- asar reader ------------------------------------------------------------

// asar layout: UInt32LE pickle sizes at offsets 0/4/8/12, header JSON at 16;
// file payloads start at 8 + headerPickleSize (readUInt32LE(4)).
function readAsar(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  const prelude = Buffer.alloc(16);
  fs.readSync(fd, prelude, 0, 16, 0);
  const headerPickleSize = prelude.readUInt32LE(4);
  const headerStringLength = prelude.readUInt32LE(12);
  const headerBuf = Buffer.alloc(headerStringLength);
  fs.readSync(fd, headerBuf, 0, headerStringLength, 16);
  return {
    fd,
    header: JSON.parse(headerBuf.toString('utf-8')),
    dataOffset: 8 + headerPickleSize,
  };
}

function* asarEntries(node, prefix = '') {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.files) {
      yield* asarEntries(child, rel);
    } else {
      yield { rel, entry: child };
    }
  }
}

function readAsarFile(archive, entry) {
  // Unpacked entries live in app.asar.unpacked/, already covered by the
  // file-tree scan; links have no payload of their own.
  if (entry.unpacked || entry.link !== undefined) return null;
  const buf = Buffer.alloc(entry.size);
  fs.readSync(archive.fd, buf, 0, entry.size, archive.dataOffset + Number(entry.offset));
  return buf;
}

// --- asar listing + bundle string scan --------------------------------------

// The main/preload bundles must not embed a Docker socket client, provider
// credential env names (provider keys live server-side; the desktop only
// ever holds the edge API key), or internal service endpoints (the desktop
// only ever knows the edge URL it is configured with).
const FORBIDDEN_STRING = [
  { name: 'docker-socket', re: /\/var\/run\/docker\.sock/ },
  {
    name: 'provider-key-env',
    re: /(ANTHROPIC|OPENAI|GEMINI|GOOGLE_API|MOONSHOT|OPENROUTER|BRAVE_SEARCH)_API_KEY/,
  },
  {
    name: 'internal-service-endpoint',
    re: /AION_OPS_GRPC|AION_INFERENCE_GRPC|AION_SANDBOX_GRPC/,
  },
];

let asarArchives = 0;
let bundlesScanned = 0;
for (const rel of allFiles.filter((f) => f.endsWith('.asar'))) {
  asarArchives++;
  const archive = readAsar(path.join(appRoot, rel));
  try {
    for (const { rel: inner, entry } of asarEntries(archive.header)) {
      checkPath(inner, `${rel}!${inner}`);
      if (/^dist-electron\/(main|preload)\/.*\.(js|mjs|cjs)$/.test(inner)) {
        const buf = readAsarFile(archive, entry);
        if (buf === null) continue;
        bundlesScanned++;
        const text = buf.toString('utf-8');
        for (const { name, re } of FORBIDDEN_STRING) {
          if (re.test(text)) {
            violations.push({ kind: name, path: `${rel}!${inner}` });
          }
        }
      }
    }
  } finally {
    fs.closeSync(archive.fd);
  }
}

// --- report -----------------------------------------------------------------

const report = {
  app_root: appRoot,
  files_scanned: allFiles.length,
  asar_archives: asarArchives,
  bundles_scanned: bundlesScanned,
  violations,
};
console.log(JSON.stringify(report, null, 2));
if (bundlesScanned === 0) {
  console.error('no main/preload bundles found inside any asar — wrong input?');
  process.exit(2);
}
process.exit(violations.length === 0 ? 0 : 1);
