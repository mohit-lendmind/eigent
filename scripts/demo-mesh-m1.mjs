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

// The scripted compliance demo (FR-022 / SC-007). Runs unattended, no UI, no
// live edge — the golden fixture log stands in for the artifact plane. It walks
// the audit spine end-to-end: fold → wipe → converge → tamper → quarantine →
// export, printing a transcript and writing JSON evidence to
// test-results/demo-mesh-m1/.
//
// The CRM lives in TypeScript behind the '@' → src alias with extensionless
// imports; plain node can't load it. So we esbuild-bundle a tiny TS entry
// (resolving the alias) into ESM, shim a Map-backed localStorage the way the
// browser exposes one, then dynamically import the bundle and run it. This is a
// demo harness, not a second implementation — every audit fact comes straight
// from the same fold/export code the app and tests use.

import esbuild from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'test-results', 'demo-mesh-m1');

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

// The TS entry — bundled, not run as-is. Importing the '@/crm' barrel for its
// side effects wires every side-bus (outbox → eventlog, stores → workstream /
// documents) at module-load, so a fold that raises a worklist item has a bus to
// dispatch to. Every audit fact below is read from the shipped fold/export/
// selector surface; the harness only orchestrates and records.
const ENTRY_TS = `
import '@/crm';
import { clearAllCrmState, exportCaseFileV2 } from '@/crm';
import type { CaseLogEntry } from '@/crm/agentContracts/caseLog';
import { canonicalise } from '@/crm/caseFile';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmClientsStore } from '@/crm/clientsStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { c417Log } from '@/crm/fixtures/caselog/c417Log';
import { unknownEventKind } from '@/crm/fixtures/caselog/negatives';
import {
  foldEntries,
  selectCaseChainStatus,
  selectCaseHalt,
  selectCaseWatermark,
  selectQuarantineCount,
} from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { verifyChain } from '@/crm/hashChain';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';

const CASE = 'c417';

// The full derived projection across all five stores, canonicalised — the same
// snapshot Journey 1 pins byte-for-byte across a wipe + refold.
function foldSnapshot(): string {
  const cases = getCrmCasesStore().getState();
  const clients = getCrmClientsStore().getState();
  const docs = getCrmDocumentsStore().getState();
  const ws = getCrmWorkstreamStore().getState();
  const log = getCrmEventLogStore().getState();
  return JSON.stringify(
    canonicalise({
      casesById: cases.casesById,
      conflictsById: cases.conflictsById,
      criteriaByCase: cases.criteriaByCase,
      productsByCase: cases.productsByCase,
      complianceByCase: cases.complianceByCase,
      clientsById: clients.clientsById,
      documentsById: docs.documentsById,
      checklistByOwner: docs.checklistByOwner,
      worklistItems: ws.worklistItems,
      streamByCase: ws.streamByCase,
      activityByCase: ws.activityByCase,
      watermarks: log.watermarks,
      chainHeads: log.chainHeads,
      quarantine: log.quarantine,
      anomalies: log.anomalies,
      haltedCases: log.haltedCases,
    })
  );
}

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Integrity fields a compliance reviewer reads off a v2 envelope.
function integrity(env: any) {
  return {
    exportVersion: env.exportVersion,
    contractsVersion: env.contractsVersion,
    crmSchemaVersion: env.crmSchemaVersion,
    chainVerified: env.chainVerified,
    chainHead: env.chainHead,
    artifactManifestLength: env.artifactManifest.length,
  };
}

export async function run() {
  // ---- 1. Fold the golden c417 log → converged, chain-verified -------------
  clearAllCrmState();
  const log = await c417Log();
  await foldEntries(CASE, log);
  const headSeq = log[log.length - 1].seq;
  const cleanVerify = await verifyChain(log);
  const step1 = {
    watermark: selectCaseWatermark(CASE),
    chainHeadSeq: headSeq,
    chainStatus: selectCaseChainStatus(CASE),
    chainVerified: cleanVerify.ok,
  };

  // ---- 2. Wipe all five stores → refold → byte-identical -------------------
  const before = foldSnapshot();
  clearAllCrmState();
  const wipedWatermarks = getCrmEventLogStore().getState().watermarks;
  await foldEntries(CASE, log);
  const after = foldSnapshot();
  const step2 = {
    storesWipedToFloor: Object.keys(wipedWatermarks).length === 0,
    byteIdentical: before === after,
    snapshotSha256: await sha256Hex(after),
  };

  // ---- 3. Flip one byte in one entry → refold → verify fails at that seq ---
  const TAMPER_IDX = 3;
  const target = log[TAMPER_IDX];
  const tampered: CaseLogEntry[] = log.map((e, i) =>
    i === TAMPER_IDX
      ? {
          ...e,
          event: {
            ...e.event,
            payload: { ...e.event.payload, __demoTamper: 1 },
          },
        }
      : e
  );
  clearAllCrmState();
  await foldEntries(CASE, tampered);
  const tamperVerify = await verifyChain(tampered);
  const step3 = {
    chainVerified: tamperVerify.ok,
    brokenAtSeq: tamperVerify.ok ? null : tamperVerify.brokenAtSeq,
    expectedSeq: target.seq,
    halt: selectCaseHalt(CASE),
  };

  // ---- 4. Unknown-major artifact → quarantine pointer + cumulative count ---
  clearAllCrmState();
  const unknown = await unknownEventKind();
  await foldEntries(CASE, unknown.entries);
  const q = selectQuarantineCount(CASE);
  const pointer = getCrmEventLogStore()
    .getState()
    .quarantine.find((r) => r.caseId === CASE);
  const step4 = {
    kindSeen: unknown.kindSeen,
    quarantinedSeq: unknown.quarantinedSeq,
    pointer: pointer
      ? {
          id: pointer.id,
          artifactId: pointer.artifactId,
          artifactVersion: pointer.artifactVersion,
          reasonCode: pointer.reasonCode,
          contentHash: pointer.contentHash,
        }
      : null,
    retained: q.retained,
    everCount: q.everCount,
  };

  // ---- 5. Export v2 before/after tamper → both envelopes' integrity --------
  clearAllCrmState();
  await foldEntries(CASE, log);
  const cleanExport = await exportCaseFileV2(CASE, log);
  if (!('envelope' in cleanExport)) throw new Error('clean export failed');

  clearAllCrmState();
  await foldEntries(CASE, tampered);
  const tamperExport = await exportCaseFileV2(CASE, tampered);
  if (!('envelope' in tamperExport)) throw new Error('tampered export failed');

  const step5 = {
    before: integrity(cleanExport.envelope),
    after: integrity(tamperExport.envelope),
  };

  return {
    step1,
    step2,
    step3,
    step4,
    step5,
    envelopes: {
      before: cleanExport.envelope,
      after: tamperExport.envelope,
    },
  };
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
    alias: { '@': SRC },
    // Vite normally injects import.meta.env; under node it's undefined, so a
    // transitive module reading import.meta.env.VITE_* throws at load. Define it
    // as a production-shaped object — unknown keys resolve to undefined, not a
    // crash, and the dev-gate probes read a non-dev environment.
    define: {
      'import.meta.env': JSON.stringify({ DEV: false, MODE: 'production' }),
    },
    // node builtins stay external; keep the CRM + zustand graph inlined.
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
  assert(r.step1.chainVerified === true, 'step1 clean chain verified');
  assert(
    r.step1.watermark === r.step1.chainHeadSeq,
    'step1 watermark on chain head'
  );
  assert(r.step1.chainStatus === 'verified', 'step1 chain status verified');
  assert(r.step2.storesWipedToFloor, 'step2 stores wiped to floor');
  assert(r.step2.byteIdentical, 'step2 refold byte-identical');
  assert(r.step3.chainVerified === false, 'step3 tamper breaks verification');
  assert(
    r.step3.brokenAtSeq === r.step3.expectedSeq,
    'step3 break named at tampered seq'
  );
  assert(
    r.step3.halt && r.step3.halt.reasonCode === 'CHAIN_BREAK',
    'step3 case halts on CHAIN_BREAK'
  );
  assert(r.step4.pointer !== null, 'step4 quarantine pointer present');
  assert(
    r.step4.pointer.reasonCode === 'QUARANTINE_UNKNOWN_MAJOR',
    'step4 quarantine reason'
  );
  assert(r.step4.retained >= 1, 'step4 quarantine retained');
  assert(r.step4.everCount >= 1, 'step4 cumulative quarantine count');
  assert(r.step5.before.chainVerified === true, 'step5 clean envelope verified');
  assert(
    r.step5.after.chainVerified === false,
    'step5 tampered envelope flags tamper'
  );
}

function transcript(r, elapsedMs) {
  const L = [];
  L.push('=== mesh-m1 compliance demo (FR-022 / SC-007) ===');
  L.push('');
  L.push('1. Fold the golden c417 log');
  L.push(`   watermark        : ${r.step1.watermark}`);
  L.push(`   chain head seq   : ${r.step1.chainHeadSeq}`);
  L.push(`   chain status     : ${r.step1.chainStatus}`);
  L.push(`   chain-verified   : ${r.step1.chainVerified ? '✓' : '✗'}`);
  L.push('');
  L.push('2. Wipe all five stores → refold');
  L.push(`   wiped to floor   : ${r.step2.storesWipedToFloor}`);
  L.push(`   byte-identical   : ${r.step2.byteIdentical}`);
  L.push(`   snapshot sha256  : ${r.step2.snapshotSha256}`);
  L.push('');
  L.push('3. Flip one byte in one entry → refold');
  L.push(`   chainVerified    : ${r.step3.chainVerified}`);
  L.push(`   brokenAtSeq      : ${r.step3.brokenAtSeq}`);
  L.push(
    `   case halt        : ${r.step3.halt ? r.step3.halt.reasonCode + ' @ ' + r.step3.halt.atSeq : 'none'}`
  );
  L.push('');
  L.push('4. Feed an unknown-major artifact');
  L.push(`   kind seen        : ${r.step4.kindSeen}`);
  L.push(`   quarantine ptr   : ${r.step4.pointer ? r.step4.pointer.id : 'none'}`);
  L.push(`   reason code      : ${r.step4.pointer ? r.step4.pointer.reasonCode : 'none'}`);
  L.push(`   retained         : ${r.step4.retained}`);
  L.push(`   cumulative ever  : ${r.step4.everCount}`);
  L.push('');
  L.push('5. Export v2 before/after tamper');
  L.push(
    `   before  chainVerified=${r.step5.before.chainVerified} head=${r.step5.before.chainHead ? r.step5.before.chainHead.seq : 'null'} manifest=${r.step5.before.artifactManifestLength}`
  );
  L.push(
    `   after   chainVerified=${r.step5.after.chainVerified} head=${r.step5.after.chainHead ? r.step5.after.chainHead.seq : 'null'} manifest=${r.step5.after.artifactManifestLength}`
  );
  L.push('');
  L.push(`All audit facts asserted. Elapsed ${elapsedMs} ms.`);
  L.push('');
  return L.join('\n');
}

// The Map-backed shim isn't the exact object zustand's persist probe expects,
// so each store write logs a benign "storage currently unavailable" warning. The
// demo is fold-driven and never relies on persistence, so drop just that line —
// any other warning (e.g. an FR-020 unwired-bus error) still surfaces.
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
      path.join(OUT_DIR, 'envelope-before.json'),
      JSON.stringify(result.envelopes.before, null, 2),
      'utf8'
    ),
    writeFile(
      path.join(OUT_DIR, 'envelope-after.json'),
      JSON.stringify(result.envelopes.after, null, 2),
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
