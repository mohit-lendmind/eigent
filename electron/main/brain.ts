// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

// Compile-time seam for the legacy local Brain (Python backend) lifecycle.
// `__EIGENT_THIN__` is a Vite define: `true` in the thin (release) package,
// where the branches below are dead code and Rollup drops the dynamic
// imports — init.ts, install-deps.ts, and everything they pull in never
// enter the bundle. The legacy (comparison, non-release) build defines it
// `false` and behaves exactly as before through the lazy imports.

import type { BrowserWindow } from 'electron';
import type { PromiseReturnType } from './install-deps';

export type { PromiseReturnType } from './install-deps';

export const THIN_BUILD: boolean = __EIGENT_THIN__;

const THIN_MESSAGE =
  'This build has no local backend; it requires remote-backend configuration.';

export async function checkToolInstalled(): Promise<PromiseReturnType> {
  if (THIN_BUILD) return { success: false, message: THIN_MESSAGE };
  const m = await import('./init');
  return m.checkToolInstalled();
}

export async function startBackend(
  setPort?: (port: number) => void,
  extraEnv: Record<string, string> = {}
): Promise<any> {
  if (THIN_BUILD) throw new Error(THIN_MESSAGE);
  const m = await import('./init');
  return m.startBackend(setPort, extraEnv);
}

export async function checkAndInstallDepsOnUpdate(props: {
  win: BrowserWindow;
  forceInstall?: boolean;
}): Promise<PromiseReturnType> {
  if (THIN_BUILD) return { success: false, message: THIN_MESSAGE };
  const m = await import('./install-deps');
  return m.checkAndInstallDepsOnUpdate(props);
}

export async function getInstallationStatus(): Promise<{
  isInstalling: boolean;
  hasLockFile: boolean;
}> {
  if (THIN_BUILD) return { isInstalling: false, hasLockFile: false };
  const m = await import('./install-deps');
  return m.getInstallationStatus();
}
