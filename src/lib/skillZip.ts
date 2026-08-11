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

import { parseSkillMd, type SkillMeta } from './skillToolkit';

/**
 * Client-side zip extraction for the remote skills path: in remote mode the
 * archive never reaches the local brain, so the renderer unpacks it and feeds
 * one PUT per contained skill. Layout matches the local importer: either one
 * skill at the archive root (SKILL.md top-level) or one folder per skill
 * (<folder>/SKILL.md); anything without a parseable SKILL.md is skipped.
 */
export interface ZipSkill {
  /** Folder name inside the archive ('' for a root-level skill). */
  folderName: string;
  meta: SkillMeta;
  /** Companion files, paths relative to the skill folder, content base64. */
  files: Array<{ path: string; contentBase64: string }>;
}

const SKILL_FILE = 'SKILL.md';

export async function extractSkillsFromZip(
  buffer: ArrayBuffer
): Promise<ZipSkill[]> {
  // Lazy-loaded: the unzip dependency stays out of the startup bundle.
  const { unzipSync } = await import('fflate');
  const entries = unzipSync(new Uint8Array(buffer));

  const byFolder = new Map<string, Map<string, Uint8Array>>();
  for (const [rawPath, bytes] of Object.entries(entries)) {
    const path = rawPath.replace(/\\/g, '/');
    if (path.endsWith('/')) continue; // directory rows
    const segments = path.split('/').filter(Boolean);
    if (segments.some((s) => s === '__MACOSX' || s.startsWith('.'))) continue;
    if (segments.some((s) => s === '..')) continue;
    const folder = segments.length > 1 ? segments[0] : '';
    const rel = segments.slice(folder ? 1 : 0).join('/');
    if (!rel) continue;
    let files = byFolder.get(folder);
    if (!files) {
      files = new Map();
      byFolder.set(folder, files);
    }
    files.set(rel, bytes);
  }

  const skills: ZipSkill[] = [];
  for (const [folderName, files] of byFolder) {
    const skillMd = files.get(SKILL_FILE);
    if (!skillMd) continue;
    const meta = parseSkillMd(new TextDecoder().decode(skillMd));
    if (!meta) continue;
    const companions: ZipSkill['files'] = [];
    for (const [path, bytes] of files) {
      if (path === SKILL_FILE) continue;
      companions.push({ path, contentBase64: bytesToBase64(bytes) });
    }
    companions.sort((a, b) => a.path.localeCompare(b.path));
    skills.push({ folderName, meta, files: companions });
  }
  skills.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
  return skills;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
