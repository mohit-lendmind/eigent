// WP3 packaged Electron E2E (doc 10 §11): when EIGENT_E2E_PACKAGED_APP
// points at the unsigned package (the electron-builder release dir, a
// .app bundle, or an -unpacked dir), the suites "install" it by copying it
// into a fresh temp location — a packaged app must run from outside the
// build tree, like a user install — and launch that binary instead of dev
// Electron. The same specs then exercise the identical E2E contract.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface PackagedInstall {
  executablePath: string;
  installDir: string;
}

function findAppRoot(source: string): string {
  if (/\.app$/.test(source) || /-unpacked$/.test(source)) return source;
  const found: string[] = [];
  const stack = [source];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (/\.app$/.test(entry.name) || /-unpacked$/.test(entry.name)) {
        found.push(full);
      } else if (path.relative(source, full).split(path.sep).length <= 2) {
        stack.push(full);
      }
    }
  }
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one packaged app under ${source}, found: ${
        found.join(', ') || '(none)'
      }`
    );
  }
  return found[0];
}

export function installPackagedApp(source: string): PackagedInstall {
  const appRoot = findAppRoot(source);
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-install-'));
  const dest = path.join(installDir, path.basename(appRoot));
  // cp -R preserves the mac bundle's Framework symlinks and executable
  // bits; it also materializes Bazel's output-tree symlinks as real files.
  execFileSync('cp', ['-RL', appRoot, dest]);
  // Bazel outputs are read-only and cp preserves that; a user install
  // (Finder DMG copy) is owner-writable, so match that.
  execFileSync('chmod', ['-R', 'u+w', dest]);
  let executablePath: string;
  if (process.platform === 'darwin') {
    const macOsDir = path.join(dest, 'Contents', 'MacOS');
    const [binary, ...rest] = fs.readdirSync(macOsDir);
    if (!binary || rest.length > 0) {
      throw new Error(`expected one binary in ${macOsDir}`);
    }
    executablePath = path.join(macOsDir, binary);
  } else {
    // linux-unpacked/win-unpacked keep the binary at the root.
    const candidates = fs
      .readdirSync(dest)
      .filter((f) => /^eigent(\.exe)?$/i.test(f));
    if (candidates.length !== 1) {
      throw new Error(`expected one eigent binary at the root of ${dest}`);
    }
    executablePath = path.join(dest, candidates[0]);
  }
  return { executablePath, installDir };
}
