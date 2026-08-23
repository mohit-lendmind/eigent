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

// M5 (FR-015) — the indicative-copy gate. Criteria/affordability output is
// indicative and adviser-only; its user-facing copy must never overclaim. This
// gate scans the M5 surface copy (the crm.criteria / crm.affordability /
// crm.scenario i18n subtrees, in every locale, plus the M5 UI components) and
// fails on the overclaim vocabulary: "eligible"/"eligibility" (implies a lender
// decision), "guaranteed" (an indicative figure is never guaranteed), and
// "whole of market" (a curated pack is not the whole market — MCOB 4.4A).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The overclaim vocabulary. Case-insensitive. "guaranteed" is banned as the
// adjective; honest copy says "indicative", never "guaranteed".
const FORBIDDEN = [
  { re: /eligib(le|ility)/i, term: 'eligible/eligibility' },
  { re: /guaranteed/i, term: 'guaranteed' },
  { re: /whole[\s-]of[\s-]market/i, term: 'whole of market' },
];

// The M5 copy subtrees inside every crm.json locale.
const M5_NAMESPACES = ['criteria', 'affordability', 'scenario'];

// The M5 UI components (scanned when present). Additive: absent files are skipped.
const M5_UI_FILES = [
  'src/crm/ui/ScenarioBoard.tsx',
  'src/crm/ui/AffordabilityPanel.tsx',
  'src/crm/ui/ScenarioComparison.tsx',
  'src/crm/ui/CriteriaOverride.tsx',
  'src/crm/ui/CriteriaPackEditor.tsx',
];

const offenders = [];

function walkStrings(node, pathPrefix, onString) {
  if (typeof node === 'string') {
    onString(node, pathPrefix);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walkStrings(v, `${pathPrefix}[${i}]`, onString));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      walkStrings(v, pathPrefix ? `${pathPrefix}.${k}` : k, onString);
    }
  }
}

function checkText(text, where) {
  for (const { re, term } of FORBIDDEN) {
    if (re.test(text)) {
      offenders.push({ where, term, text: text.trim().slice(0, 120) });
    }
  }
}

// 1) i18n copy — the crm.json M5 subtrees, every locale.
const localesDir = path.join(repoRoot, 'src/i18n/locales');
if (fs.existsSync(localesDir)) {
  for (const locale of fs.readdirSync(localesDir)) {
    const crmPath = path.join(localesDir, locale, 'crm.json');
    if (!fs.existsSync(crmPath)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(crmPath, 'utf-8'));
    } catch (err) {
      offenders.push({ where: `${locale}/crm.json`, term: 'invalid JSON', text: String(err) });
      continue;
    }
    for (const ns of M5_NAMESPACES) {
      if (json[ns] === undefined) continue;
      walkStrings(json[ns], `${locale}/crm.json:${ns}`, checkText);
    }
  }
}

// 2) M5 UI component source (string/JSX literals scanned line-by-line).
for (const rel of M5_UI_FILES) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  const lines = fs.readFileSync(abs, 'utf-8').split('\n');
  lines.forEach((line, i) => checkText(line, `${rel}:${i + 1}`));
}

if (offenders.length > 0) {
  console.error('check-indicative-copy: M5 surface copy overclaims:');
  for (const o of offenders) {
    console.error(`  [${o.term}] ${o.where}: ${o.text}`);
  }
  console.error(
    '\nCriteria/affordability output is indicative + adviser-only. Use honest copy ("indicative", "may differ", "not assessed") — never eligible/guaranteed/whole of market.'
  );
  process.exit(1);
}

console.log('check-indicative-copy: OK (no overclaim vocabulary in M5 surface copy)');
