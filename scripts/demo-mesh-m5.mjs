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

// The scripted M5 demo (SC-005/007). Runs unattended, no UI, zero setup, on the
// hand-tuned SYNTHETIC 12-lender pack + a synthetic applicant — no real lender
// data, no real client PII. It walks the reasoning core end to end:
//   1. ELIMINATE-WITH-REASONS — assess the panel against the pack; every excluded
//      lender carries a structured why-not (rule + cited text + input + delta).
//   2. COUNTERFACTUAL — re-run against a larger deposit WITHOUT mutating the base;
//      show the lender verdict flips and the max/monthly deltas.
//   3. SIDE-BY-SIDE — the base + two counterfactuals as a comparison.
//   4. THE HONESTY SPINE — assertIndicative refuses a client surface, a non-
//      indicative payload, unverified income (G9), a mistagged surface; and a G6
//      override is a HUMAN act that folds the ORIGINAL verdict + raises G6.
//   5. KILL-THE-LAPTOP — the override-written chain re-verifies (tamper-evident).
// A transcript + JSON evidence land in test-results/demo-mesh-m5/.
//
// The CRM lives in TypeScript behind the '@' → src alias; plain node can't load
// it. So we esbuild-bundle a tiny TS entry (resolving '@' → src and '@test' →
// test) into ESM, shim a Map-backed localStorage, then import and run it.

import esbuild from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');
const TEST = path.join(ROOT, 'test');
const OUT_DIR = path.join(ROOT, 'test-results', 'demo-mesh-m5');

// zustand's persist middleware reads localStorage lazily; a browser-shaped,
// Map-backed shim keeps the stores happy under plain node.
function installLocalStorageShim() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(String(k), String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

// The TS entry — bundled, not run as-is. Every audit fact below is read from the
// shipped pure engine / choke-point / writer; the harness only orchestrates.
const ENTRY_TS = `
import '@/crm';
import { clearAllCrmState } from '@/crm';
import { verifyChain, decodeCaseLogEntry } from '@/crm/agentContracts';
import { CRITERIA_SURFACE_CLASS } from '@/crm/agentContracts/criteriaAffordability';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import { recordCriteriaOverride } from '@/crm/agents/criteriaOverride';
import { assertIndicative } from '@/crm/criteria/assertIndicative';
import { applyDelta, buildBaseScenario, diffScenarios } from '@/crm/criteria/counterfactual';
import { SYNTHETIC_CASE_FACTS, SYNTHETIC_CRITERIA_PACK, SYNTHETIC_EXPECTED, SYNTHETIC_LENDER_PANEL } from '@/crm/fixtures/criteriaPack';
import { FakeEdge } from '@test/unit/crm/fakeEdge';

const FIRM = 'lendmind';
const ADVISER = 'adviser-jo';
const CASE = 'c417';
const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

const AFFORDABILITY_INPUTS = [
  { key: 'annualIncomePence', valuePence: 6_000_000, provenance: 'det', sourceRef: 'doc:payslip' },
  { key: 'termYears', value: 25, provenance: 'det', sourceRef: 'app:term' },
  { key: 'rateBps', value: 499, provenance: 'det', sourceRef: 'product:rate' },
  { key: 'incomeMultiple', value: 4.5, provenance: 'det', sourceRef: 'product:lti' },
];

const BASIS = {
  pack: SYNTHETIC_CRITERIA_PACK,
  caseFacts: SYNTHETIC_CASE_FACTS,
  lenderPanel: SYNTHETIC_LENDER_PANEL,
  affordabilityInputs: AFFORDABILITY_INPUTS,
  stressRateBps: 700,
  caseId: CASE,
};

async function readChain(edge, projectId, caseId) {
  const prefix = 'lm/case/' + caseId + '/';
  const list = await edge.listArtifacts(projectId, {});
  const entries = [];
  for (const artifact of list.artifacts) {
    if (!artifact.name.startsWith(prefix)) continue;
    if (artifact.name.endsWith('facts.json')) continue;
    const access = await edge.getArtifact(projectId, artifact.artifact_id, { inline: true });
    entries.push(decodeCaseLogEntry(JSON.parse(access.content)));
  }
  return entries.sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0));
}

export async function run() {
  resetCaseProjectCaches();
  clearAllCrmState();
  const edge = new FakeEdge();
  configureAgentEdge(edge);

  // ---- 1. ELIMINATE-WITH-REASONS -----------------------------------------
  const base = buildBaseScenario(BASIS);
  const results = base.criteria.results;
  const excluded = results.filter((r) => r.verdict !== 'pass');
  const everyExcludedHasReason = excluded.every((r) => r.reasons.length > 0);
  const knownAnswerMatches = results.every(
    (r) => SYNTHETIC_EXPECTED[r.lenderId] && SYNTHETIC_EXPECTED[r.lenderId].verdict === r.verdict
  );
  const step1 = {
    panelSize: results.length,
    passes: results.filter((r) => r.verdict === 'pass').length,
    refers: results.filter((r) => r.verdict === 'refer').length,
    fails: results.filter((r) => r.verdict === 'fail').length,
    everyExcludedHasReason,
    knownAnswerMatches,
    sampleWhyNot: excluded.slice(0, 3).map((r) => ({
      lenderId: r.lenderId,
      verdict: r.verdict,
      ruleKey: r.reasons[0].ruleKey,
      delta: r.reasons[0].delta,
      inputProvenance: r.reasons[0].inputProvenance,
    })),
  };

  // ---- 2. COUNTERFACTUAL — a larger deposit, base untouched ---------------
  const larger = applyDelta(base, { depositPence: 9_000_000 });
  const diff = diffScenarios(base, larger);
  const step2 = {
    baseUntouched: base.criteria.results.filter((r) => r.verdict === 'pass').length === step1.passes,
    flips: diff.lenderFlips.map((f) => f.lenderId + ': ' + f.from + '→' + f.to),
    maxBorrowDeltaPence: diff.maxBorrowDeltaPence,
    monthlyAtRateDeltaPence: diff.monthlyAtRateDeltaPence,
    idempotent: applyDelta(base, { depositPence: 9_000_000 }).scenarioId === larger.scenarioId,
  };

  // ---- 3. SIDE-BY-SIDE — base + two counterfactuals -----------------------
  const higherRate = applyDelta(base, { rateBps: 699 });
  const scenarios = [base, larger, higherRate];
  const step3 = {
    columns: scenarios.length,
    passesPerColumn: scenarios.map((s) => s.criteria.results.filter((r) => r.verdict === 'pass').length),
    allAdviserOnly: scenarios.every((s) => s.criteria.surfaceClass === 'adviser-only' && s.affordability.surfaceClass === 'adviser-only'),
    allIndicative: scenarios.every((s) => s.affordability.indicative === true),
  };

  // ---- 4. THE HONESTY SPINE — the choke-point + a G6 override -------------
  const okAdviser = assertIndicative(base.criteria, { surface: 'adviser' });
  const clientBlocked = assertIndicative(base.criteria, { surface: 'client' });
  const g9Blocked = assertIndicative(base.affordability, { surface: 'adviser', g9Verified: false });
  const notIndicative = assertIndicative({ ...base.affordability, indicative: false }, { surface: 'adviser' });
  const wrongSurface = assertIndicative({ ...base.criteria, surfaceClass: 'client-facing' }, { surface: 'adviser' });

  // A G6 override is a HUMAN act: it refuses an empty rationale, folds the
  // ORIGINAL verdict, and raises the compliance-flagged G6 gate.
  const cavendish = results.find((r) => r.lenderId === 'lender-cavendish');
  const refusedEmpty = await recordCriteriaOverride({
    caseId: CASE, firmId: FIRM, adviserId: ADVISER,
    lenderId: 'lender-cavendish', originalVerdict: cavendish.verdict, overrideVerdict: 'pass',
    rationale: '   ', now: NOW,
  });
  const override = await recordCriteriaOverride({
    caseId: CASE, firmId: FIRM, adviserId: ADVISER,
    lenderId: 'lender-cavendish', originalVerdict: cavendish.verdict, overrideVerdict: 'pass',
    rationale: 'Deposit top-up agreed; LTV drops under the 70% cap.', now: NOW,
  });
  const step4 = {
    okAdviser: okAdviser.ok,
    clientBlocked: clientBlocked.ok === false ? clientBlocked.reason : 'NOT-BLOCKED',
    g9Blocked: g9Blocked.ok === false ? g9Blocked.reason : 'NOT-BLOCKED',
    notIndicativeBlocked: notIndicative.ok === false ? notIndicative.reason : 'NOT-BLOCKED',
    wrongSurfaceBlocked: wrongSurface.ok === false ? wrongSurface.reason : 'NOT-BLOCKED',
    emptyRationaleRefused: refusedEmpty.ok === false ? refusedEmpty.reason : 'NOT-REFUSED',
    overrideOk: override.ok,
    overrideOriginalVerdict: override.ok ? override.record.originalVerdict : null,
    overrideAdviser: override.ok ? override.record.adviserId : null,
    overrideRaisesFlag: override.ok ? override.record.raisesComplianceFlag : null,
    overrideGate: override.ok ? override.gate.gateId : null,
  };

  // ---- 5. KILL-THE-LAPTOP — the override-written chain re-verifies --------
  const projectId = edge.projects.keys().next().value;
  const chain = await readChain(edge, projectId, CASE);
  const chainVerify = await verifyChain(chain);
  const step5 = {
    chainLength: chain.length,
    chainVerified: chainVerify.ok,
    surfaceClass: CRITERIA_SURFACE_CLASS,
  };

  configureAgentEdge(null);
  return { step1, step2, step3, step4, step5 };
}
`;

async function bundleEntry() {
  const result = await esbuild.build({
    stdin: {
      contents: ENTRY_TS,
      resolveDir: SRC,
      sourcefile: 'demo-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    alias: { '@': SRC, '@test': TEST },
    define: {
      'import.meta.env': JSON.stringify({ DEV: false, MODE: 'production' }),
    },
    external: ['node:*'],
    write: false,
  });
  return result.outputFiles[0].text;
}

// Self-validating: the demo asserts the audit facts it prints, so a green exit
// means the spine actually behaved (not merely that the script ran).
function assert(cond, msg) {
  if (!cond) throw new Error(`demo assertion failed: ${msg}`);
}

function validate(r) {
  // 1. eliminate-with-reasons
  assert(r.step1.panelSize === 12, 'step1 whole synthetic panel assessed');
  assert(r.step1.passes > 0 && r.step1.refers > 0 && r.step1.fails > 0, 'step1 every verdict class present');
  assert(r.step1.everyExcludedHasReason, 'step1 every excluded lender carries a why-not');
  assert(r.step1.knownAnswerMatches, 'step1 every lender lands its known-answer verdict');
  // 2. counterfactual
  assert(r.step2.baseUntouched, 'step2 the base is not mutated by the counterfactual');
  assert(r.step2.idempotent, 'step2 the same delta re-runs to the same scenario id');
  // 3. side-by-side
  assert(r.step3.columns === 3, 'step3 base + two counterfactuals');
  assert(r.step3.allAdviserOnly, 'step3 every column is adviser-only');
  assert(r.step3.allIndicative, 'step3 every affordability figure is indicative');
  // 4. HONESTY SPINE
  assert(r.step4.okAdviser === true, 'step4 the adviser surface is allowed');
  assert(r.step4.clientBlocked === 'client-surface', 'step4 a client surface is refused');
  assert(r.step4.g9Blocked === 'g9-unverified', 'step4 unverified income is refused (G9)');
  assert(r.step4.notIndicativeBlocked === 'not-indicative', 'step4 a non-indicative payload is refused');
  assert(r.step4.wrongSurfaceBlocked === 'wrong-surface', 'step4 a mistagged surface is refused');
  assert(r.step4.emptyRationaleRefused === 'rationale-required', 'step4 an empty override rationale is refused');
  assert(r.step4.overrideOk === true, 'step4 the override commits');
  assert(r.step4.overrideOriginalVerdict === 'fail', 'step4 the override folds the ORIGINAL machine verdict');
  assert(r.step4.overrideAdviser === 'adviser-jo', 'step4 the override is a human act (adviser)');
  assert(r.step4.overrideRaisesFlag === true, 'step4 the override raises a compliance flag');
  assert(r.step4.overrideGate === 'G6', 'step4 the override raises G6');
  // 5. kill-the-laptop
  assert(r.step5.chainLength === 2, 'step5 the override folds two chained entries (override + gate-raise)');
  assert(r.step5.chainVerified === true, 'step5 the override-written chain re-verifies');
  assert(r.step5.surfaceClass === 'adviser-only', 'step5 the surface class is adviser-only');
}

function transcript(r, elapsedMs) {
  const L = [];
  L.push('=== mesh-m5 criteria & affordability demo (SC-005/007) ===');
  L.push('SYNTHETIC DATA ONLY — hand-tuned 12-lender pack + a synthetic applicant.');
  L.push('');
  L.push('1. Eliminate-with-reasons → assess the panel against the pack');
  L.push(`   panel / pass / refer / fail : ${r.step1.panelSize} / ${r.step1.passes} / ${r.step1.refers} / ${r.step1.fails}`);
  L.push(`   every excluded has a why-not: ${r.step1.everyExcludedHasReason ? '✓' : '✗'}`);
  L.push(`   known-answer match          : ${r.step1.knownAnswerMatches ? '✓' : '✗'}`);
  for (const w of r.step1.sampleWhyNot) {
    L.push(`     - ${w.lenderId} [${w.verdict}] ${w.ruleKey}: ${w.delta}`);
  }
  L.push('');
  L.push('2. Counterfactual → a larger deposit, the base untouched');
  L.push(`   base untouched / idempotent : ${r.step2.baseUntouched ? '✓' : '✗'} / ${r.step2.idempotent ? '✓' : '✗'}`);
  L.push(`   lender flips                : ${r.step2.flips.length ? r.step2.flips.join(', ') : '(none)'}`);
  L.push(`   max-borrow Δ / monthly Δ    : ${r.step2.maxBorrowDeltaPence} / ${r.step2.monthlyAtRateDeltaPence} pence`);
  L.push('');
  L.push('3. Side-by-side → base + two counterfactuals');
  L.push(`   columns / passes            : ${r.step3.columns} / [${r.step3.passesPerColumn.join(', ')}]`);
  L.push(`   all adviser-only / indicative: ${r.step3.allAdviserOnly ? '✓' : '✗'} / ${r.step3.allIndicative ? '✓' : '✗'}`);
  L.push('');
  L.push('4. THE HONESTY SPINE → the choke-point + a G6 override');
  L.push(`   adviser surface allowed     : ${r.step4.okAdviser ? '✓' : '✗'}`);
  L.push(`   client surface refused      : ${r.step4.clientBlocked}`);
  L.push(`   unverified income refused   : ${r.step4.g9Blocked}`);
  L.push(`   non-indicative refused      : ${r.step4.notIndicativeBlocked}`);
  L.push(`   mistagged surface refused   : ${r.step4.wrongSurfaceBlocked}`);
  L.push(`   empty rationale refused     : ${r.step4.emptyRationaleRefused}`);
  L.push(`   override folds original     : ${r.step4.overrideOriginalVerdict} (by ${r.step4.overrideAdviser}, flag: ${r.step4.overrideRaisesFlag})`);
  L.push(`   override raises gate         : ${r.step4.overrideGate}`);
  L.push('');
  L.push('5. Kill-the-laptop → the override-written chain re-verifies');
  L.push(`   chain length / verified     : ${r.step5.chainLength} / ${r.step5.chainVerified ? '✓' : '✗'}`);
  L.push('');
  L.push(`All audit facts asserted. Elapsed ${elapsedMs} ms.`);
  L.push('');
  return L.join('\n');
}

// The Map-backed shim isn't the exact object zustand's persist probe expects, so
// each store write logs a benign "storage currently unavailable" warning. Drop
// just that line; any other warning still surfaces.
function muteZustandPersistNoise() {
  const original = console.warn.bind(console);
  console.warn = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('zustand persist middleware')
    ) {
      return;
    }
    original(...args);
  };
}

async function main() {
  const started = Date.now();
  installLocalStorageShim();
  muteZustandPersistNoise();

  const code = await bundleEntry();
  await mkdir(OUT_DIR, { recursive: true });
  const bundlePath = path.join(OUT_DIR, '.demo-bundle.mjs');
  await writeFile(bundlePath, code, 'utf8');

  let mod;
  try {
    mod = await import(pathToFileURL(bundlePath).href);
  } finally {
    await rm(bundlePath, { force: true });
  }

  const result = await mod.run();
  validate(result);

  const elapsedMs = Date.now() - started;
  const text = transcript(result, elapsedMs);
  process.stdout.write(text + '\n');

  await Promise.all([
    writeFile(
      path.join(OUT_DIR, 'demo-result.json'),
      JSON.stringify({ ...result, elapsedMs }, null, 2),
      'utf8'
    ),
    writeFile(path.join(OUT_DIR, 'transcript.txt'), text, 'utf8'),
  ]);
}

main().catch((err) => {
  process.stderr.write(`\ndemo failed: ${err?.stack || err}\n`);
  process.exit(1);
});
