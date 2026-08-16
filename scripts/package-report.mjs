#!/usr/bin/env node
// WP2 package reports (doc 10 §11): given the electron-builder --dir output,
// emit a file manifest (per-file sha256), a CycloneDX SBOM derived from the
// production dependency graph in pnpm-lock.yaml, a version manifest, and
// checksums.txt. Run from the repo root (package.json + pnpm-lock.yaml in
// cwd), as the Bazel target does via chdir.
//
// Usage: node scripts/package-report.mjs <release-dir> <out-dir>

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const [releaseDir, outDir] = process.argv.slice(2);
if (!releaseDir || !outDir || !fs.existsSync(releaseDir)) {
  console.error('usage: package-report.mjs <release-dir> <out-dir>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

// --- file manifest + checksums ----------------------------------------------

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

const manifest = [];
for (const full of walk(releaseDir).sort()) {
  const rel = path.relative(releaseDir, full);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) {
    // Hash the link target, not the (possibly directory) destination.
    const target = fs.readlinkSync(full);
    manifest.push({
      path: rel,
      type: 'symlink',
      target,
      sha256: crypto.createHash('sha256').update(`link:${target}`).digest('hex'),
    });
  } else {
    manifest.push({
      path: rel,
      type: 'file',
      size: stat.size,
      sha256: crypto
        .createHash('sha256')
        .update(fs.readFileSync(full))
        .digest('hex'),
    });
  }
}

const checksumLines = manifest.map((m) => `${m.sha256}  ${m.path}`);
// One digest over the sorted per-file digests identifies the whole package.
const packageDigest = crypto
  .createHash('sha256')
  .update(checksumLines.join('\n') + '\n')
  .digest('hex');

fs.writeFileSync(
  path.join(outDir, 'file-manifest.json'),
  JSON.stringify({ release_dir: releaseDir, package_digest: packageDigest, files: manifest }, null, 2)
);
fs.writeFileSync(path.join(outDir, 'checksums.txt'), checksumLines.join('\n') + '\n');

// --- SBOM from pnpm-lock production graph -----------------------------------

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const lock = YAML.parse(fs.readFileSync('pnpm-lock.yaml', 'utf-8'));

// pnpm lockfile v9: importers['.'].dependencies pins the root production
// versions; snapshots['name@version(peers)'] holds the transitive graph;
// packages['name@version'] holds resolution integrity.
const rootDeps = lock.importers?.['.']?.dependencies ?? {};
const snapshots = lock.snapshots ?? {};
const lockPackages = lock.packages ?? {};

const seen = new Map(); // 'name@fullVersion' -> {name, version, integrity}
const queue = Object.entries(rootDeps).map(([name, spec]) => ({
  name,
  version: spec.version,
}));
while (queue.length) {
  const { name, version } = queue.pop();
  const key = `${name}@${version}`;
  if (seen.has(key)) continue;
  const bareVersion = version.replace(/\(.*\)$/, '');
  const integrity =
    lockPackages[`${name}@${bareVersion}`]?.resolution?.integrity ?? null;
  seen.set(key, { name, version: bareVersion, integrity });
  const snap = snapshots[key] ?? snapshots[`${name}@${bareVersion}`];
  for (const [depName, depVersion] of Object.entries({
    ...(snap?.dependencies ?? {}),
    ...(snap?.optionalDependencies ?? {}),
  })) {
    queue.push({ name: depName, version: depVersion });
  }
}

const components = [...seen.values()]
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  .map(({ name, version, integrity }) => ({
    type: 'library',
    name,
    version,
    purl: `pkg:npm/${name.replaceAll('@', '%40')}@${version}`,
    ...(integrity ? { hashes: [{ alg: 'SHA-512', content: integrity }] } : {}),
  }));

fs.writeFileSync(
  path.join(outDir, 'sbom.cdx.json'),
  JSON.stringify(
    {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      version: 1,
      metadata: {
        component: {
          type: 'application',
          name: pkg.name,
          version: pkg.version,
        },
      },
      components,
    },
    null,
    2
  )
);

// --- version manifest ---------------------------------------------------------

fs.writeFileSync(
  path.join(outDir, 'version-manifest.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      thin_build: true,
      electron: pkg.devDependencies?.electron ?? null,
      electron_builder: pkg.devDependencies?.['electron-builder'] ?? null,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      // Stamped by the evidence pipeline (no .git inside Bazel actions).
      git_sha: process.env.EIGENT_GIT_SHA ?? 'unstamped',
      package_digest: packageDigest,
      production_dependency_count: components.length,
    },
    null,
    2
  )
);

console.log(
  `package-report: ${manifest.length} files, ${components.length} production deps, digest ${packageDigest.slice(0, 16)}…`
);
