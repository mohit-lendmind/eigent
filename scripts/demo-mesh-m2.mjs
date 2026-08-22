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

// The scripted M2 demo (FR-022 / SC-007). Runs unattended, no UI, against the
// same FakeEdge test double the unit suite uses — so every fact is produced by
// the shipped agent code, not a parallel mock. It walks the first-open journey:
// seed a firm's case index → run a watcher pass (propose-only) → begin an
// onboarding draft (G1 raised, nothing sent) → approve the send (logged to the
// tamper-evident chain) → export v2 (chain re-verified) → print the three
// leading-indicator metrics. A transcript + JSON evidence land in
// test-results/demo-mesh-m2/.
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
const OUT_DIR = path.join(ROOT, 'test-results', 'demo-mesh-m2');

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

// The TS entry — bundled, not run as-is. Importing '@/crm' for its side effects
// wires every side-bus at module load. Every audit fact below is read from the
// shipped agent/fold/export surface; the harness only orchestrates and records.
const ENTRY_TS = `
import '@/crm';
import { clearAllCrmState, exportCaseFileV2, seedCrmGoldenPath } from '@/crm';
import { decodeFirmConfig, verifyChain, decodeCaseLogEntry } from '@/crm/agentContracts';
import { resetCaseProjectCaches, firmCoordinatorProject } from '@/crm/agents/caseProject';
import { encodeJsonAttachment } from '@/crm/agents/codec';
import { configureAgentEdge } from '@/crm/agents/edge';
import { publishCasePointer } from '@/crm/agents/firmIndex';
import { resetWatcherState, runWatcherPass } from '@/crm/agents/watcher';
import { beginOnboarding, approveOnboardingSend } from '@/crm/agents/onboarding';
import { foldEntries } from '@/crm/fold/caseLogFold';
import { useCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { computeLeadingMetrics, selectLeadingMetrics, MINUTES_SAVED_PER_DRAFT, MINUTES_SAVED_PER_WATCHER_DECISION } from '@/crm/ui/leadingMetrics';
import { FakeEdge } from '@test/unit/crm/fakeEdge';

const FIRM = 'firm-demo';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 1, 9, 0, 0);

function firmConfig() {
  return decodeFirmConfig({
    firmId: FIRM,
    disclosureTextRefs: ['IDD-2026', 'ESIS-terms', 'fee-agreement-v3'],
  });
}

function caseProjectId(caseId: string): string {
  return 'proj_case_' + caseId;
}

// Publish a case into the firm index + stash its facts in the case Project.
async function seedCase(edge: FakeEdge, caseId: string, facts: Record<string, unknown>) {
  const projectId = caseProjectId(caseId);
  edge.seedProject(projectId);
  await edge.uploadAttachment(projectId, {
    name: 'lm/case/' + caseId + '/facts.json',
    media_type: 'application/json',
    data_base64: encodeJsonAttachment(facts),
  });
  await publishCasePointer({
    caseId,
    firmId: FIRM,
    aionProjectId: projectId,
    stage: 'application',
    logHeadSeq: '5',
    updatedAt: 1,
  });
}

async function readJson(edge: FakeEdge, projectId: string, name: string) {
  const list = await edge.listArtifacts(projectId, { name });
  const newest = list.artifacts?.[0];
  if (!newest) return null;
  const access = await edge.getArtifact(projectId, newest.artifact_id, { inline: true });
  return JSON.parse(access.content!);
}

async function readChain(edge: FakeEdge, projectId: string, caseId: string) {
  const prefix = 'lm/case/' + caseId + '/';
  const list = await edge.listArtifacts(projectId, {});
  const entries = [] as any[];
  for (const artifact of list.artifacts) {
    if (!artifact.name.startsWith(prefix)) continue;
    if (artifact.name.endsWith('facts.json')) continue;
    const access = await edge.getArtifact(projectId, artifact.artifact_id, { inline: true });
    entries.push(decodeCaseLogEntry(JSON.parse(access.content!)));
  }
  return entries.sort((a, b) =>
    BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0
  );
}

export async function run() {
  resetWatcherState();
  resetCaseProjectCaches();
  clearAllCrmState();
  const edge = new FakeEdge();
  configureAgentEdge(edge);

  // ---- 1. Seed the firm index → run a watcher pass (propose-only) ----------
  await seedCase(edge, 'w-rate', { fixedRateEndAt: NOW + 30 * DAY, lastActivityAt: NOW - 1 * DAY });
  await seedCase(edge, 'w-stall', { lastActivityAt: NOW - 30 * DAY });
  await seedCase(edge, 'w-quiet', { lastActivityAt: NOW - 1 * DAY });

  const report = await runWatcherPass(FIRM, { now: NOW, firmConfig: firmConfig() });
  const coordId = await firmCoordinatorProject(FIRM);
  const rateDecision = await readJson(edge, coordId, 'lm/watcher/' + report.passId + '/w-rate.json');
  const g7 = Object.values(useCrmEventLogStore.getState().openGates).find(
    (g) => g.gateId === 'G7' && g.caseId === 'w-rate'
  );
  const step1 = {
    scanned: report.scanned,
    decided: report.decided,
    skipped: report.skipped,
    breakerTrips: report.breakerTrips,
    consistent: report.skipped + report.decided + report.breakerTrips === report.scanned,
    providerCalls: report.spend.providerCalls,
    costMicroGbp: report.spend.costMicroGbp,
    fxEffectiveDate: report.spend.fxEffectiveDate,
    proposeOnly: edge.commands.length === 0,
    rateDecisionKind: rateDecision ? (rateDecision.payload as any).kind : null,
    rateDirectiveEmpty: rateDecision ? (rateDecision.payload as any).directive === undefined : null,
    g7Raised: g7 ? g7.status : null,
  };

  // ---- 2. Begin onboarding on the seeded demo case → G1 raised, nothing sent
  // The v2 compliance export needs a folded case record, so onboard the
  // golden-path case the fixture seeds into the cases store.
  seedCrmGoldenPath({ ignoreDevGate: true });
  const DEMO_CASE = 'c417';
  const started = await beginOnboarding({
    caseId: DEMO_CASE,
    firmId: FIRM,
    caseType: 'purchase',
    clientNames: ['Ada Lovelace'],
    firmConfig: firmConfig(),
    issuedBy: { kind: 'adviser', id: 'adviser-1' },
    now: NOW,
  });
  const disclosuresPresent = firmConfig().disclosureTextRefs.every((ref) =>
    started.draft.full.includes(ref)
  );
  const g1Open = useCrmEventLogStore.getState().openGates[started.gate.id];
  const step2 = {
    disclosuresPresent,
    noProductClaim:
      !started.draft.full.toLowerCase().includes('interest rate') &&
      !started.draft.full.toLowerCase().includes('you can afford'),
    g1Status: g1Open ? g1Open.status : null,
    sentBeforeApproval: edge.commands.length,
  };

  // ---- 3. Approve the send → logged to the chain, G1 resolved --------------
  await approveOnboardingSend({
    caseId: DEMO_CASE,
    firmId: FIRM,
    projectId: started.gate.projectId,
    worklistItemId: started.worklistItemId,
    gateInstanceId: started.gate.id,
    adviserId: 'adviser-1',
    now: NOW + 60_000,
  });
  const g1Resolved = useCrmEventLogStore.getState().openGates[started.gate.id];
  const chain = await readChain(edge, started.gate.projectId, DEMO_CASE);
  const chainVerify = await verifyChain(chain);
  const step3 = {
    g1Status: g1Resolved ? g1Resolved.status : null,
    g1Decision: g1Resolved ? g1Resolved.decision : null,
    chainLength: chain.length,
    chainVerified: chainVerify.ok,
  };

  // ---- 4. Export v2 for the onboarded case → chain re-verified -------------
  await foldEntries(DEMO_CASE, chain);
  const bundle = await exportCaseFileV2(DEMO_CASE, chain, { firmConfig: firmConfig() });
  const envelope = 'envelope' in bundle ? bundle.envelope : null;
  const step4 = {
    exported: envelope !== null,
    exportVersion: envelope ? envelope.exportVersion : null,
    chainVerified: envelope ? envelope.chainVerified : null,
    manifestLength: envelope ? envelope.artifactManifest.length : null,
  };

  // ---- 5. Leading-indicator metrics (FR-022) -------------------------------
  // Drafts come from the live G1 mirror; the watcher-decision count and one
  // demo fact-find span (start → ready) are supplied so all three read non-null.
  const metrics = selectLeadingMetrics({
    watcherDecisions: report.decided,
    factFind: [{ startedAt: NOW, readyAt: NOW + 42 * 60_000 }],
  });
  const step5 = {
    timeToFactFindMinutes:
      metrics.timeToFactFindMs === null ? null : metrics.timeToFactFindMs / 60_000,
    draftsApprovedUneditedPct: metrics.draftsApprovedUneditedPct,
    adviserMinutesSaved: metrics.adviserMinutesSaved,
    sampleSizes: metrics.sampleSizes,
    constants: {
      minutesSavedPerDraft: MINUTES_SAVED_PER_DRAFT,
      minutesSavedPerWatcherDecision: MINUTES_SAVED_PER_WATCHER_DECISION,
    },
  };

  // A pure recompute of the same inputs, to show the selector and core agree.
  const pureCheck = computeLeadingMetrics({
    drafts: [{ raisedAt: NOW, approvedAt: NOW + 60_000 }],
    watcherDecisions: report.decided,
    factFind: [{ startedAt: NOW, readyAt: NOW + 42 * 60_000 }],
  });
  step5.pureAgrees =
    pureCheck.adviserMinutesSaved === metrics.adviserMinutesSaved &&
    pureCheck.draftsApprovedUneditedPct === metrics.draftsApprovedUneditedPct;

  configureAgentEdge(null);
  return { step1, step2, step3, step4, step5, envelope };
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
  // 1. watcher pass
  assert(r.step1.scanned === 3, 'step1 scanned all three cases');
  assert(r.step1.decided === 2, 'step1 two triggers fired');
  assert(r.step1.consistent, 'step1 pass metrics internally consistent');
  assert(r.step1.proposeOnly, 'step1 propose-only — nothing dispatched');
  assert(r.step1.rateDecisionKind === 'retention-open', 'step1 rate radar proposed');
  assert(r.step1.rateDirectiveEmpty === true, 'step1 M3 dispatch seam empty');
  assert(r.step1.g7Raised === 'open', 'step1 G7 transition mirrored');
  // 2. onboarding draft
  assert(r.step2.disclosuresPresent, 'step2 draft cites every disclosure');
  assert(r.step2.noProductClaim, 'step2 no unapproved product claim');
  assert(r.step2.g1Status === 'open', 'step2 G1 raised and open');
  assert(r.step2.sentBeforeApproval === 0, 'step2 nothing sent before approval');
  // 3. approve → logged
  assert(r.step3.g1Status === 'resolved', 'step3 G1 resolved on approval');
  assert(r.step3.g1Decision === 'allow', 'step3 approval is an allow');
  // beginOnboarding writes 9 entries (1 activity + 5 checklist-status + 1
  // stream-entry + 1 worklist-upsert + 1 gate-raise; findings 6 & 10) and the
  // approval writes 3 (activity + worklist-resolve + gate-resolve) = 12.
  assert(r.step3.chainLength === 12, 'step3 twelve entries on the chain');
  assert(r.step3.chainVerified === true, 'step3 chain verifies');
  // 4. export v2
  assert(r.step4.exported, 'step4 v2 export succeeded');
  assert(r.step4.exportVersion === 2, 'step4 envelope is v2');
  assert(r.step4.chainVerified === true, 'step4 export re-verifies the chain');
  // 5. leading metrics
  assert(r.step5.timeToFactFindMinutes === 42, 'step5 time-to-fact-find computed');
  assert(
    r.step5.draftsApprovedUneditedPct === 100,
    'step5 approved-unedited pct computed'
  );
  assert(r.step5.adviserMinutesSaved > 0, 'step5 adviser-minutes-saved modeled');
  assert(r.step5.pureAgrees, 'step5 pure core and live selector agree');
}

function transcript(r, elapsedMs) {
  const L = [];
  L.push('=== mesh-m2 first-open demo (FR-022 / SC-007) ===');
  L.push('');
  L.push('1. Seed firm index → run a watcher pass (propose-only)');
  L.push(`   scanned/decided/skipped : ${r.step1.scanned}/${r.step1.decided}/${r.step1.skipped}`);
  L.push(`   provider calls          : ${r.step1.providerCalls}`);
  L.push(`   spend (microGBP)        : ${r.step1.costMicroGbp} @ fx ${r.step1.fxEffectiveDate}`);
  L.push(`   propose-only            : ${r.step1.proposeOnly ? '✓ (0 commands)' : '✗'}`);
  L.push(`   rate radar proposal     : ${r.step1.rateDecisionKind} (directive empty: ${r.step1.rateDirectiveEmpty})`);
  L.push(`   G7 transition mirrored  : ${r.step1.g7Raised}`);
  L.push('');
  L.push('2. Begin onboarding → G1 raised, nothing sent');
  L.push(`   disclosures present     : ${r.step2.disclosuresPresent}`);
  L.push(`   no product claim        : ${r.step2.noProductClaim}`);
  L.push(`   G1 status               : ${r.step2.g1Status}`);
  L.push(`   commands before approve : ${r.step2.sentBeforeApproval}`);
  L.push('');
  L.push('3. Approve the send → logged to the chain');
  L.push(`   G1 status / decision    : ${r.step3.g1Status} / ${r.step3.g1Decision}`);
  L.push(`   chain length            : ${r.step3.chainLength}`);
  L.push(`   chain verified          : ${r.step3.chainVerified ? '✓' : '✗'}`);
  L.push('');
  L.push('4. Export v2 → chain re-verified');
  L.push(`   export version          : ${r.step4.exportVersion}`);
  L.push(`   chain verified          : ${r.step4.chainVerified ? '✓' : '✗'}`);
  L.push(`   artifact manifest       : ${r.step4.manifestLength}`);
  L.push('');
  L.push('5. Leading-indicator metrics (FR-022)');
  L.push(`   time-to-fact-find (min) : ${r.step5.timeToFactFindMinutes}`);
  L.push(`   drafts approved unedited: ${r.step5.draftsApprovedUneditedPct}%`);
  L.push(`   adviser-minutes-saved   : ${r.step5.adviserMinutesSaved}`);
  L.push(`   sample sizes            : ${JSON.stringify(r.step5.sampleSizes)}`);
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
      path.join(OUT_DIR, 'envelope.json'),
      JSON.stringify(result.envelope, null, 2),
      'utf8'
    ),
    writeFile(
      path.join(OUT_DIR, 'demo-result.json'),
      JSON.stringify(
        {
          step1: result.step1,
          step2: result.step2,
          step3: result.step3,
          step4: result.step4,
          step5: result.step5,
          elapsedMs,
        },
        null,
        2
      ),
      'utf8'
    ),
    writeFile(path.join(OUT_DIR, 'transcript.txt'), text, 'utf8'),
  ]);
}

main().catch((err) => {
  process.stderr.write(`\ndemo failed: ${err?.stack || err}\n`);
  process.exit(1);
});
