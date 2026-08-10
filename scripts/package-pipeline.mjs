#!/usr/bin/env node
// WP2 Bazel package pipeline (doc 10 §11): `bazel run //:package_pipeline`.
//
// electron-builder v26 collects production node modules by running
// `pnpm list --prod` — that needs a real pnpm-installed workspace, which the
// rules_js bin tree is not (its store is .aspect_rules_js, so the collector
// sees zero deps there). The pipeline therefore packages IN the source
// workspace, but from DECLARED Bazel outputs: it stages the bazel-built
// dist/ and dist-electron/ tree artifacts (the //:prebuild_compile thin
// vite build in this binary's runfiles) over the workspace copies first, so
// the app payload is exactly what Bazel built.
//
// Steps: stage bazel outputs → electron-builder --dir (unsigned) →
// inspect-thin-package gate → package-report (manifest/SBOM/version/
// checksums). The dependency query report is emitted by the evidence
// driver (`bazel query "deps(//:package_pipeline)"`) since bazel cannot
// re-enter itself while a run command holds the workspace lock.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (!workspace) {
  console.error('run this via: bazel run //:package_pipeline');
  process.exit(2);
}

// cwd is the runfiles _main dir; the tree artifacts sit next to this script.
const RUNFILES_ROOT = process.cwd();
for (const dir of ['dist', 'dist-electron']) {
  const src = path.join(RUNFILES_ROOT, dir);
  if (!fs.existsSync(path.join(src, dir === 'dist' ? 'index.html' : 'main'))) {
    console.error(`bazel output ${dir}/ not found in runfiles at ${src}`);
    process.exit(2);
  }
  const dest = path.join(workspace, dir);
  fs.rmSync(dest, { recursive: true, force: true });
  // -L: runfiles stage tree artifacts as symlinks; the workspace copy must
  // be real files so electron-builder packages content, not links.
  execFileSync('cp', ['-RL', src, dest]);
  execFileSync('chmod', ['-R', 'u+w', dest]);
  console.log(`staged bazel-built ${dir}/ into workspace`);
}

const run = (cmd, args, extraEnv = {}) =>
  execFileSync(cmd, args, {
    cwd: workspace,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });

console.log('packaging unsigned thin app (electron-builder --dir)…');
run(
  path.join(workspace, 'node_modules', '.bin', 'electron-builder'),
  ['--dir', '--publish', 'never', '--config', 'electron-builder.json', '-c.npmRebuild=false'],
  { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
);

console.log('running package inspection gate…');
run(process.execPath, [path.join(workspace, 'scripts', 'inspect-thin-package.mjs'), 'release']);

console.log('emitting package reports…');
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: workspace,
  encoding: 'utf-8',
}).trim();
run(
  process.execPath,
  [path.join(workspace, 'scripts', 'package-report.mjs'), 'release', 'package-report'],
  { EIGENT_GIT_SHA: gitSha }
);

console.log('package pipeline complete: release/ + package-report/');
