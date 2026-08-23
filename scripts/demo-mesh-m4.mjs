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

// The scripted M4 demo (SC-005). Runs unattended, no UI, against the same
// FakeEdge test double the unit suite uses — so every fact is produced by the
// shipped connector/agent code, not a parallel mock. It walks the sourcing
// journey end to end: register the MSE adapter (verified DERIVED at
// registration) → dispatch the declarative plan to the pump (fire-and-forget) →
// RECORD a captured MSE result into a snapshot (verified:true) → rank the
// shortlist (cheapest true-cost first) → assertClaimable + export evidence
// (both pass) → then the HONESTY SPINE: a Mortgage Brain scaffold (no evidence)
// yields verified:false and is refused at the export choke-point, and a
// hand-set verified:true with no evidence is re-derived away. Finally the
// sourcing-written chain re-verifies (tamper-evident). A transcript + JSON
// evidence land in test-results/demo-mesh-m4/.
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
const OUT_DIR = path.join(ROOT, 'test-results', 'demo-mesh-m4');

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
// shipped connector/agent/export surface; the harness only orchestrates.
const ENTRY_TS = `
import '@/crm';
import { clearAllCrmState } from '@/crm';
import { verifyChain, decodeCaseLogEntry, decodeSourcingProductsAttachment } from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge } from '@/crm/agents/edge';
import { buildSourcingDirective, dispatchSourcingRun, recordSourcingRun } from '@/crm/agents/sourcing';
import { MSE_ADAPTER, MSE_REPLAY_VERIFICATION } from '@/crm/connectors/adapters/mse';
import { MORTGAGE_BRAIN_ADAPTER } from '@/crm/connectors/adapters/mortgageBrain';
import { getSourcingAdapter, registerSourcingAdapter, resetSourcingRegistry } from '@/crm/connectors/registry';
import { assertClaimable } from '@/crm/connectors/assertClaimable';
import { exportEvidenceOfResearch } from '@/crm/connectors/evidenceExport';
import { FakeEdge } from '@test/unit/crm/fakeEdge';

const FIRM = 'firm-demo';
const ADVISER = 'adviser-jo';
const NOW = Date.UTC(2026, 7, 23, 9, 0, 0);

const MSE_DEALS = {
  deals: [
    { lenderId: 'lender-002', productName: '5 Year Fixed', initialRatePct: 4.04, aprcPct: 5.9, productFeePence: 149900, monthlyPaymentPence: 106200, trueCostPence: 6521900, revertRatePct: 7.74, ercPence: 400000 },
    { lenderId: 'lender-004', productName: '95% LTV', initialRatePct: 5.29, aprcPct: 7.1, productFeePence: 49900, monthlyPaymentPence: 120400, trueCostPence: 0, eligible: false, declineReason: 'LTV above product maximum' },
  ],
};

const MORTGAGE_BRAIN_ROWS = {
  rows: [
    { lender: 'panel-1', product: '2 Year Fixed', initialRate: '4.24%', productFee: '£999', monthlyPayment: '£1,081', trueCost: '£26,910', status: 'Eligible' },
  ],
};

// The same cheapest-true-cost-first ranking the Shortlist paints (eligible
// sorted ascending, declines to the end).
function rank(products) {
  const eligible = products.filter((p) => p.status === 'eligible').sort((a, b) => a.trueCostPence - b.trueCostPence);
  const declined = products.filter((p) => p.status === 'declined');
  return { eligible, declined };
}

async function readChain(edge, projectId, caseId) {
  const prefix = 'lm/case/' + caseId + '/';
  const list = await edge.listArtifacts(projectId, {});
  const entries = [];
  for (const artifact of list.artifacts) {
    if (!artifact.name.startsWith(prefix)) continue;
    if (artifact.name.endsWith('facts.json')) continue;
    const access = await edge.getArtifact(projectId, artifact.artifact_id, { inline: true });
    entries.push(decodeCaseLogEntry(JSON.parse(access.content!)));
  }
  return entries.sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0));
}

export async function run() {
  resetSourcingRegistry();
  resetCaseProjectCaches();
  clearAllCrmState();
  const edge = new FakeEdge();
  configureAgentEdge(edge);
  registerSourcingAdapter(MSE_ADAPTER);
  registerSourcingAdapter(MORTGAGE_BRAIN_ADAPTER);

  // ---- 1. Register MSE → verified DERIVED, canary still pending -------------
  // MSE ships a VerificationRef but NO canaryPassedAt, so at registration it is
  // verified:FALSE — the flag is earned by a passing canary, never hand-set.
  const mse = getSourcingAdapter('mse');
  const step1 = {
    adapterId: mse.id,
    sessionMode: mse.sessionMode,
    verifiedBeforeCanary: mse.verified,
    coverageKind: mse.coverage().kind,
    wholeOfMarket: mse.coverage().wholeOfMarket,
  };

  // ---- 2. Dispatch the declarative plan to the pump (fire-and-forget) -------
  const directive = buildSourcingDirective({
    caseId: 'c-demo', firmId: FIRM, adapter: mse,
    caseFacts: { loanAmountPence: 20_000_000, termYears: 25 }, adviserId: ADVISER,
  });
  const dispatch = await dispatchSourcingRun({
    caseId: 'c-demo', firmId: FIRM, adapter: mse,
    caseFacts: { loanAmountPence: 20_000_000, termYears: 25 }, adviserId: ADVISER,
  });
  const plan = directive.constraints.plan;
  const step2 = {
    agent: directive.agent,
    issuedBy: directive.issuedBy.kind + ':' + directive.issuedBy.id,
    planFirstTool: plan[0].tool,
    planCaptures: plan.some((s) => s.tool === 'browser.captureJson'),
    commandAdmitted: Boolean(dispatch.commandId),
    directivePublished: Boolean(dispatch.directiveArtifactId),
  };

  // ---- 3. RECORD a captured MSE result → snapshot verified:true ------------
  const recorded = await recordSourcingRun({
    caseId: 'c-demo', firmId: FIRM, adviserId: ADVISER, adapter: mse,
    ratesAsAt: '2026-08-23T00:00:00.000Z', recordedResult: MSE_DEALS,
    verification: { ...MSE_REPLAY_VERIFICATION, canaryPassedAt: '2026-08-23T01:00:00.000Z' },
    now: NOW,
  });
  const snap = recorded.snapshot;
  const step3 = {
    verified: snap.verified,
    surfaceClass: snap.surfaceClass,
    coverageWholeOfMarket: snap.coverage.wholeOfMarket,
    summary: snap.summary,
    productsAttachmentId: snap.productsAttachmentId,
    productsRodeAsAttachment: snap.productsAttachmentId === recorded.productsArtifactId,
  };

  // ---- 4. Rank the shortlist (cheapest true-cost first) --------------------
  const projectId = edge.projects.keys().next().value;
  const productsBytes = await edge.getArtifact(projectId, recorded.productsArtifactId, { inline: true });
  const products = decodeSourcingProductsAttachment(JSON.parse(productsBytes.content!));
  const { eligible, declined } = rank(products);
  const step4 = {
    total: products.length,
    eligibleCount: eligible.length,
    declinedCount: declined.length,
    topLender: eligible[0] ? eligible[0].lenderId : null,
    topTrueCostPence: eligible[0] ? eligible[0].trueCostPence : null,
    declinesCarried: declined.length === 1 && declined[0].declineReason === 'LTV above product maximum',
  };

  // ---- 5. G5 choke-point: assertClaimable + export evidence (verified) -----
  const verdict = assertClaimable(snap);
  const evidence = exportEvidenceOfResearch(snap);
  const step5 = {
    claimable: verdict.ok,
    exportOk: evidence.ok,
    bundleId: evidence.ok ? evidence.bundleId : null,
  };

  // ---- 6. THE HONESTY SPINE: scaffold refused; lie re-derived away ---------
  const brain = getSourcingAdapter('mortgage-brain');
  const scaffold = await recordSourcingRun({
    caseId: 'c-scaffold', firmId: FIRM, adviserId: ADVISER, adapter: brain,
    ratesAsAt: '2026-08-23T00:00:00.000Z', recordedResult: MORTGAGE_BRAIN_ROWS, now: NOW,
  });
  const scaffoldClaim = assertClaimable(scaffold.snapshot);
  const scaffoldExport = exportEvidenceOfResearch(scaffold.snapshot);
  // A snapshot whose stored flag says verified:true but which carries no
  // evidence is NOT claimable — the choke-point re-derives, never trusts.
  const lie = { ...scaffold.snapshot, verified: true };
  const lieExport = exportEvidenceOfResearch(lie);
  const step6 = {
    scaffoldVerified: scaffold.snapshot.verified,
    scaffoldWholeOfMarket: scaffold.snapshot.coverage.wholeOfMarket,
    scaffoldClaimBlocked: scaffoldClaim.ok === false ? scaffoldClaim.reason : 'NOT-BLOCKED',
    scaffoldExportBlocked: scaffoldExport.ok === false ? scaffoldExport.reason : 'NOT-BLOCKED',
    lieExportBlocked: lieExport.ok === false ? lieExport.reason : 'NOT-BLOCKED',
  };

  // ---- 7. The sourcing-written chain re-verifies (tamper-evident) ----------
  const chain = await readChain(edge, projectId, 'c-demo');
  const chainVerify = await verifyChain(chain);
  const step7 = {
    chainLength: chain.length,
    chainVerified: chainVerify.ok,
  };

  configureAgentEdge(null);
  return { step1, step2, step3, step4, step5, step6, step7, snapshot: snap, evidence };
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
  // 1. registration derives verified
  assert(r.step1.adapterId === 'mse', 'step1 MSE registered');
  assert(r.step1.sessionMode === 'isolated', 'step1 MSE runs isolated (API-intercept)');
  assert(r.step1.verifiedBeforeCanary === false, 'step1 verified:false until a canary passes (spine)');
  assert(r.step1.wholeOfMarket === false, 'step1 MSE is not whole of market');
  // 2. dispatch is fire-and-forget with a declarative plan
  assert(r.step2.agent === 'lm-sourcing', 'step2 dispatched by the sourcing agent');
  assert(r.step2.issuedBy === 'adviser:adviser-jo', 'step2 issued by the adviser');
  assert(r.step2.planFirstTool === 'browser.open', 'step2 plan opens the browser');
  assert(r.step2.planCaptures, 'step2 plan captures the JSON result');
  assert(r.step2.commandAdmitted, 'step2 command admitted to the pump');
  assert(r.step2.directivePublished, 'step2 directive published');
  // 3. record derives verified:true + folds a summary, products ride as attachment
  assert(r.step3.verified === true, 'step3 snapshot verified:true (full evidence)');
  assert(r.step3.surfaceClass === 'adviser-only', 'step3 snapshot is adviser-only');
  assert(r.step3.coverageWholeOfMarket === false, 'step3 coverage not whole of market');
  assert(r.step3.summary.total === 2 && r.step3.summary.eligible === 1 && r.step3.summary.declined === 1, 'step3 summary folded 1 of 2 eligible');
  assert(r.step3.summary.topTrueCostPence === 6521900, 'step3 top true cost folded');
  assert(r.step3.productsRodeAsAttachment, 'step3 full set rode as a referenced attachment');
  // 4. shortlist ranks cheapest true-cost first, declines carried
  assert(r.step4.total === 2, 'step4 both products in the attachment');
  assert(r.step4.eligibleCount === 1 && r.step4.declinedCount === 1, 'step4 one eligible, one declined');
  assert(r.step4.topLender === 'lender-002', 'step4 cheapest eligible ranked first');
  assert(r.step4.declinesCarried, 'step4 decline reason carried');
  // 5. claimable + export
  assert(r.step5.claimable === true, 'step5 verified snapshot is claimable');
  assert(r.step5.exportOk === true, 'step5 evidence export succeeds');
  assert(r.step5.bundleId && r.step5.bundleId.startsWith('eor_mse_'), 'step5 bundle id derived from evidence');
  // 6. HONESTY SPINE
  assert(r.step6.scaffoldVerified === false, 'step6 scaffold (no evidence) is verified:false');
  assert(r.step6.scaffoldWholeOfMarket === false, 'step6 scaffold is not whole of market');
  assert(r.step6.scaffoldClaimBlocked === 'unverified', 'step6 scaffold blocked at the choke-point');
  assert(r.step6.scaffoldExportBlocked === 'unverified', 'step6 scaffold export refused');
  assert(r.step6.lieExportBlocked === 'no-evidence', 'step6 hand-set verified:true re-derived away');
  // 7. tamper-evident chain
  assert(r.step7.chainLength === 1, 'step7 one sourcing activity on the chain');
  assert(r.step7.chainVerified === true, 'step7 sourcing-written chain verifies');
}

function transcript(r, elapsedMs) {
  const L = [];
  L.push('=== mesh-m4 sourcing demo (SC-005) ===');
  L.push('');
  L.push('1. Register MSE adapter → verified DERIVED, canary still pending');
  L.push(`   adapter / session       : ${r.step1.adapterId} / ${r.step1.sessionMode}`);
  L.push(`   verified before canary  : ${r.step1.verifiedBeforeCanary} (earned by a passing canary, never hand-set)`);
  L.push(`   coverage                : ${r.step1.coverageKind} (whole of market: ${r.step1.wholeOfMarket})`);
  L.push('');
  L.push('2. Dispatch the declarative plan → fire-and-forget to the pump');
  L.push(`   agent / issued by       : ${r.step2.agent} / ${r.step2.issuedBy}`);
  L.push(`   plan first tool         : ${r.step2.planFirstTool} (captures JSON: ${r.step2.planCaptures})`);
  L.push(`   command admitted        : ${r.step2.commandAdmitted ? '✓' : '✗'}`);
  L.push('');
  L.push('3. RECORD the captured result → snapshot verified:true');
  L.push(`   verified / surfaceClass : ${r.step3.verified} / ${r.step3.surfaceClass}`);
  L.push(`   summary                 : ${JSON.stringify(r.step3.summary)}`);
  L.push(`   products as attachment  : ${r.step3.productsRodeAsAttachment ? '✓ (referenced, not inline)' : '✗'}`);
  L.push('');
  L.push('4. Rank the shortlist → cheapest true-cost first');
  L.push(`   eligible / declined     : ${r.step4.eligibleCount} / ${r.step4.declinedCount}`);
  L.push(`   top of shortlist        : ${r.step4.topLender} @ ${r.step4.topTrueCostPence} pence`);
  L.push(`   decline reason carried  : ${r.step4.declinesCarried ? '✓' : '✗'}`);
  L.push('');
  L.push('5. G5 choke-point → assertClaimable + export evidence');
  L.push(`   claimable / export ok   : ${r.step5.claimable} / ${r.step5.exportOk}`);
  L.push(`   evidence bundle         : ${r.step5.bundleId}`);
  L.push('');
  L.push('6. THE HONESTY SPINE → scaffold refused; a lie re-derived away');
  L.push(`   scaffold verified       : ${r.step6.scaffoldVerified}`);
  L.push(`   scaffold claim blocked  : ${r.step6.scaffoldClaimBlocked}`);
  L.push(`   scaffold export blocked : ${r.step6.scaffoldExportBlocked}`);
  L.push(`   hand-set lie blocked    : ${r.step6.lieExportBlocked} (re-derived, never trusted)`);
  L.push('');
  L.push('7. Kill-the-laptop → the sourcing-written chain re-verifies');
  L.push(`   chain length / verified : ${r.step7.chainLength} / ${r.step7.chainVerified ? '✓' : '✗'}`);
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
      path.join(OUT_DIR, 'snapshot.json'),
      JSON.stringify(result.snapshot, null, 2),
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
          step6: result.step6,
          step7: result.step7,
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
