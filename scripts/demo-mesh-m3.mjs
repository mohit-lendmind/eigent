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

// The scripted M3 demo (SC-006). Runs unattended, no UI, against the same
// FakeEdge test double the unit suite uses — so every fact is produced by the
// shipped docintel agent code (applyExtraction → appendCaseLog → foldEntries),
// not a parallel mock. It walks the docintel journey on SYNTHETIC fixtures only:
//   1. Upload an in-scope, confidently-attributed P60 → a det (verified) income
//      field is written and the P60 checklist item is marked received.
//   2. Upload a payslip (d7) whose det income disagrees with the value on file by
//      more than 1% materiality → G3 is raised, the conflict is recorded, and NO
//      field is overwritten (record-never-repair).
//   3. Kill-the-laptop: fold the whole docintel-authored chain, wipe every store
//      to the floor, refold → the projection (G3 included) is byte-identical.
// A transcript + JSON evidence land in test-results/demo-mesh-m3/.
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
const OUT_DIR = path.join(ROOT, 'test-results', 'demo-mesh-m3');

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
// shipped agent/fold surface; the harness only orchestrates and records. All
// documents, quotes, and applicant data are SYNTHETIC.
const ENTRY_TS = `
import '@/crm';
import { clearAllCrmState } from '@/crm';
import { appendCaseLog } from '@/crm/agents/caseLogWrite';
import { configureAgentEdge } from '@/crm/agents/edge';
import { applyExtraction } from '@/crm/agents/extractionApply';
import { canonicalise } from '@/crm/caseFile';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmClientsStore } from '@/crm/clientsStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { toPence } from '@/crm/domain/money';
import { foldEntries, selectCaseWatermark } from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { decodeCaseLogEntry } from '@/crm/agentContracts';
import { FakeEdge } from '@test/unit/crm/fakeEdge';

const CASE = 'c417';
const FIRM = 'firm_syn';
const PROJECT = 'proj_syn';
const CLIENT = 'client_daniel';
const NOW = 1_700_000_000_000;

const VERSIONS = {
  model: 'lm-docintel',
  promptSha: 'lm-docintel',
  skillSemver: '1.0.0',
  skillSha: 'lm-docintel-m3',
};

// A confident, single-applicant attribution — above the 0.85 gate, so fields may
// be written without a G2 hold.
const CONFIDENT = { clientId: CLIENT, confidence: 0.97, joint: false };

function extraction(over) {
  return {
    kind: 'lm.docintel.extraction/1',
    documentId: over.documentId,
    contentHash: over.contentHash,
    docType: over.docType,
    docTypeInScope: true,
    attribution: CONFIDENT,
    specialCategoryFlagged: false,
    versions: VERSIONS,
    insights: over.insights,
  };
}

function ctx(ext, over) {
  return {
    extraction: ext,
    caseId: CASE,
    firmId: FIRM,
    projectId: PROJECT,
    sourceText: over.sourceText ?? null,
    document: { name: over.name },
    originArtifactId: over.artifactId,
    runId: over.runId,
    now: NOW,
    checklist: over.checklist,
    existing: over.existing,
  };
}

async function appendProjection(edge, proj, artifactId, runId) {
  await appendCaseLog(edge, PROJECT, {
    caseId: CASE,
    firmId: FIRM,
    actor: { kind: 'agent', id: 'lm-docintel' },
    events: proj.events,
    versions: VERSIONS,
    originArtifactId: artifactId,
    runId,
    at: NOW,
  });
}

async function readChain(edge) {
  const prefix = 'lm/case/' + CASE + '/';
  const list = await edge.listArtifacts(PROJECT, {});
  const entries = [];
  for (const artifact of list.artifacts) {
    if (!artifact.name.startsWith(prefix)) continue;
    const access = await edge.getArtifact(PROJECT, artifact.artifact_id, { inline: true });
    entries.push(decodeCaseLogEntry(JSON.parse(access.content!)));
  }
  return entries.sort((a, b) =>
    BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0
  );
}

function foldSnapshot() {
  const cases = getCrmCasesStore().getState();
  const clients = getCrmClientsStore().getState();
  const docs = getCrmDocumentsStore().getState();
  const ws = getCrmWorkstreamStore().getState();
  const log = getCrmEventLogStore().getState();
  return JSON.stringify(
    canonicalise({
      casesById: cases.casesById,
      conflictsById: cases.conflictsById,
      clientsById: clients.clientsById,
      documentsById: docs.documentsById,
      checklistByOwner: docs.checklistByOwner,
      worklistItems: ws.worklistItems,
      streamByCase: ws.streamByCase,
      activityByCase: ws.activityByCase,
      watermarks: log.watermarks,
      chainHeads: log.chainHeads,
      openGates: log.openGates,
    })
  );
}

export async function run() {
  clearAllCrmState();
  localStorage.clear();
  const edge = new FakeEdge();
  configureAgentEdge(edge);
  edge.seedProject(PROJECT);

  // ---- 1. Upload a P60 → a det income field + checklist received ------------
  const proj1 = applyExtraction(
    ctx(
      extraction({
        documentId: 'doc_p60',
        contentHash: 'hash_p60',
        docType: 'p60',
        insights: [
          {
            label: 'Annual basic income',
            value: '£38,500',
            confidence: 0.98,
            src: 'det',
            quote: 'Total for year £38,500',
            fieldKey: 'basicIncome',
            section: 'income',
          },
        ],
      }),
      {
        name: 'p60-2025.pdf',
        sourceText: 'P60 End of Year Certificate\\nTotal for year £38,500\\nNI AB123456C',
        artifactId: 'art_p60',
        runId: 'run_p60',
        checklist: { owner: CLIENT, itemKey: 'p60', label: 'P60' },
      }
    )
  );
  const fc1 = proj1.events.filter((e) => e.type === 'field-change');
  const checklist1 = proj1.events.find((e) => e.type === 'checklist-status');
  const step1 = {
    detFields: proj1.detFields,
    synFields: proj1.synFields,
    fieldSrc: fc1.length > 0 ? fc1[0].payload.src : null,
    docStatus: proj1.document.status,
    checklistStatus: checklist1 ? checklist1.payload.item.status : null,
    attributionGated: proj1.attributionGated,
  };
  await appendProjection(edge, proj1, 'art_p60', 'run_p60');

  // ---- 2. Upload d7 payslip → det income disagrees with file ⇒ G3 -----------
  // The value now on file (£38,500 det) is fed as the existing fact; the payslip
  // reads £37,300 det — a 3.1% disagreement, past the 1% materiality bar.
  const proj2 = applyExtraction(
    ctx(
      extraction({
        documentId: 'doc_d7',
        contentHash: 'hash_d7',
        docType: 'payslip',
        insights: [
          {
            label: 'Annual basic income',
            value: '£37,300',
            confidence: 0.98,
            src: 'det',
            quote: 'Annual basic £37,300',
            fieldKey: 'basicIncome',
            section: 'income',
          },
        ],
      }),
      {
        name: 'payslip-d7.pdf',
        sourceText: 'Employer ACME\\nAnnual basic £37,300\\nTax £410',
        artifactId: 'art_d7',
        runId: 'run_d7',
        existing: {
          'client_daniel::income::basicIncome': {
            value: { t: 'money', v: toPence(3_850_000) },
            src: 'det',
          },
        },
      }
    )
  );
  const fc2 = proj2.events.filter((e) => e.type === 'field-change');
  const step2 = {
    conflicts: proj2.conflicts,
    g3Raised: proj2.gates.map((g) => g.gateId).includes('G3'),
    fieldChangesOnConflict: fc2.length,
    recordNeverRepair: fc2.length === 0 && proj2.conflicts === 1,
  };
  await appendProjection(edge, proj2, 'art_d7', 'run_d7');

  // ---- 3. Fold the chain → inspect projection -------------------------------
  const chain = await readChain(edge);
  await foldEntries(CASE, chain);
  const docsState = getCrmDocumentsStore().getState();
  const conflicts = getCrmCasesStore().getState().conflictsById;
  const g3 = Object.values(getCrmEventLogStore().getState().openGates).find(
    (g) => g.gateId === 'G3' && g.caseId === CASE
  );
  const step3 = {
    chainLength: chain.length,
    documents: Object.keys(docsState.documentsById).length,
    conflictsRecorded: Object.keys(conflicts).length,
    g3Status: g3 ? g3.status : null,
    everyEntryIsSafeKind: chain.every(
      (e) => e.event.type !== 'lm.docintel.extraction/1'
    ),
    everyEntryCitesOrigin: chain.every((e) => e.origin?.artifactId !== undefined),
  };

  // ---- 4. Kill-the-laptop: wipe + refold is byte-identical (SC-004) ---------
  const s1 = foldSnapshot();
  clearAllCrmState();
  await foldEntries(CASE, chain);
  const s2 = foldSnapshot();
  const step4 = {
    byteIdentical: s1 === s2,
    watermark: selectCaseWatermark(CASE),
    headSeq: chain[chain.length - 1].seq,
  };

  configureAgentEdge(null);
  return { step1, step2, step3, step4 };
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
// means the docintel spine actually behaved (not merely that the script ran).
function assert(cond, msg) {
  if (!cond) throw new Error(`demo assertion failed: ${msg}`);
}

function validate(r) {
  // 1. P60 → det income + checklist received
  assert(r.step1.detFields === 1, 'step1 one det field extracted');
  assert(r.step1.synFields === 0, 'step1 no syn fields');
  assert(r.step1.fieldSrc === 'det', 'step1 income field written as det');
  assert(r.step1.docStatus === 'COMPLETED', 'step1 in-scope doc completed');
  assert(r.step1.checklistStatus === 'received', 'step1 P60 checklist received');
  assert(!r.step1.attributionGated, 'step1 confident attribution, no G2 hold');
  // 2. d7 payslip → conflict, record-never-repair
  assert(r.step2.g3Raised, 'step2 G3 conflict gate raised');
  assert(r.step2.conflicts === 1, 'step2 one conflict recorded');
  assert(
    r.step2.fieldChangesOnConflict === 0,
    'step2 no field overwritten on conflict'
  );
  assert(r.step2.recordNeverRepair, 'step2 record-never-repair holds');
  // 3. folded projection
  assert(r.step3.documents === 2, 'step3 both documents in the vault');
  assert(r.step3.conflictsRecorded >= 1, 'step3 conflict on file');
  assert(r.step3.g3Status === 'open', 'step3 G3 open in the projection');
  assert(r.step3.everyEntryIsSafeKind, 'step3 extraction kind never folded raw');
  assert(r.step3.everyEntryCitesOrigin, 'step3 every entry cites its side-car');
  // 4. kill-the-laptop
  assert(r.step4.byteIdentical, 'step4 refold byte-identical (SC-004)');
  assert(
    r.step4.watermark === r.step4.headSeq,
    'step4 watermark advanced to chain head'
  );
}

function transcript(r, elapsedMs) {
  const L = [];
  L.push('=== mesh-m3 docintel demo (SC-006) — SYNTHETIC fixtures only ===');
  L.push('');
  L.push('1. Upload P60 → det income field + checklist received');
  L.push(`   det / syn fields        : ${r.step1.detFields} / ${r.step1.synFields}`);
  L.push(`   income field trust      : ${r.step1.fieldSrc}`);
  L.push(`   document status         : ${r.step1.docStatus}`);
  L.push(`   P60 checklist status    : ${r.step1.checklistStatus}`);
  L.push('');
  L.push('2. Upload d7 payslip → det income disagrees ⇒ G3 conflict');
  L.push(`   G3 raised               : ${r.step2.g3Raised ? '✓' : '✗'}`);
  L.push(`   conflicts recorded      : ${r.step2.conflicts}`);
  L.push(`   fields overwritten      : ${r.step2.fieldChangesOnConflict}`);
  L.push(`   record-never-repair     : ${r.step2.recordNeverRepair ? '✓' : '✗'}`);
  L.push('');
  L.push('3. Fold the docintel-authored chain');
  L.push(`   chain length            : ${r.step3.chainLength}`);
  L.push(`   documents in vault      : ${r.step3.documents}`);
  L.push(`   conflicts on file       : ${r.step3.conflictsRecorded}`);
  L.push(`   G3 status               : ${r.step3.g3Status}`);
  L.push(`   extraction never raw    : ${r.step3.everyEntryIsSafeKind ? '✓' : '✗'}`);
  L.push(`   every entry cites origin: ${r.step3.everyEntryCitesOrigin ? '✓' : '✗'}`);
  L.push('');
  L.push('4. Kill-the-laptop: wipe every store → refold');
  L.push(`   byte-identical refold   : ${r.step4.byteIdentical ? '✓' : '✗'}`);
  L.push(`   watermark @ head         : ${r.step4.watermark} (head ${r.step4.headSeq})`);
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
