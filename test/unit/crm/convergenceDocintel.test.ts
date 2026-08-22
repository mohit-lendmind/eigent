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

// T023 / SC-004 — the M1 kill-the-laptop invariant on a DOCINTEL-authored chain.
// applyExtraction is a pure projector: one lm.docintel.extraction/1 side-car
// becomes field-change / document-upsert / conflict-upsert / worklist-upsert /
// stream-entry / gate-raise entries, each citing origin.artifactId back to the
// side-car (the extraction kind is NEVER folded raw). We write those entries as a
// genuine chained case log, read them back from the edge, fold, wipe every store
// to the floor, refold, and assert the projection — the G3 conflict gate in
// openGates INCLUDED — is byte-identical. That the docintel gate reappears from
// the chain's gate-raise entry alone (not a lost side-write) is the finding-10
// invariant carried onto M3. Synthetic fixtures only.

import { clearAllCrmState } from '@/crm';
import {
  decodeCaseLogEntry,
  type CaseLogEntry,
  type CaseLogEvent,
} from '@/crm/agentContracts';
import { appendCaseLog } from '@/crm/agents/caseLogWrite';
import type {
  DocintelExtraction,
  DocInsight as ExtractionInsight,
} from '@/crm/agents/docintelContract';
import { configureAgentEdge } from '@/crm/agents/edge';
import {
  applyExtraction,
  type ApplyExtractionContext,
  type ExistingFactValue,
} from '@/crm/agents/extractionApply';
import { canonicalise } from '@/crm/caseFile';
import { getCrmCasesStore } from '@/crm/casesStore';
import { getCrmClientsStore } from '@/crm/clientsStore';
import { getCrmDocumentsStore } from '@/crm/documentsStore';
import { toPence } from '@/crm/domain/money';
import { foldEntries, selectCaseWatermark } from '@/crm/fold/caseLogFold';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { getCrmWorkstreamStore } from '@/crm/workstreamStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const CASE = 'c417';
const FIRM = 'firm_syn';
const PROJECT = 'proj_syn';

const VERSIONS = {
  model: 'lm-docintel',
  promptSha: 'lm-docintel',
  skillSemver: '1.0.0',
  skillSha: 'lm-docintel-m3',
};

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
      // openGates is fold-derived from gate-raise entries, so a docintel G3 MUST
      // reproduce byte-for-byte on refold — the finding-10 invariant on M3.
      openGates: log.openGates,
    })
  );
}

async function readChain(
  edge: FakeEdge,
  projectId: string,
  caseId: string
): Promise<CaseLogEntry[]> {
  const prefix = `lm/case/${caseId}/`;
  const list = await edge.listArtifacts(projectId, {});
  const entries: CaseLogEntry[] = [];
  for (const artifact of list.artifacts) {
    if (!artifact.name.startsWith(prefix)) continue;
    const access = await edge.getArtifact(projectId, artifact.artifact_id, {
      inline: true,
    });
    entries.push(decodeCaseLogEntry(JSON.parse(access.content!)));
  }
  return entries.sort((a, b) =>
    BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0
  );
}

function extraction(insights: ExtractionInsight[]): DocintelExtraction {
  return {
    kind: 'lm.docintel.extraction/1',
    documentId: 'doc_d7',
    contentHash: 'hash_d7',
    docType: 'payslip',
    docTypeInScope: true,
    attribution: { clientId: 'client_daniel', confidence: 0.97, joint: false },
    specialCategoryFlagged: false,
    versions: VERSIONS,
    insights,
  };
}

function ctx(
  ext: DocintelExtraction,
  over: Partial<ApplyExtractionContext> = {}
): ApplyExtractionContext {
  return {
    extraction: ext,
    caseId: CASE,
    firmId: FIRM,
    projectId: PROJECT,
    sourceText: 'Annual basic £37,300',
    document: { name: 'payslip-d7.pdf' },
    originArtifactId: 'art_d7',
    runId: 'run_d7',
    now: 1_700_000_000_000,
    ...over,
  };
}

// Project a d7-style payslip whose det income (£37,300) disagrees with the
// £38,500 already on file — the same conflict fixture as the gate suite. Returns
// the projected events; the G3 gate-raise is what must survive a refold.
function d7ConflictEvents(): CaseLogEvent[] {
  const existing: Record<string, ExistingFactValue> = {
    'client_daniel::income::basicIncome': {
      value: { t: 'money', v: toPence(3_850_000) },
      src: 'det',
    },
  };
  const proj = applyExtraction(
    ctx(
      extraction([
        {
          label: 'Annual basic income',
          value: '£37,300',
          confidence: 0.98,
          src: 'det',
          quote: 'Annual basic £37,300',
          fieldKey: 'basicIncome',
          section: 'income',
        },
      ]),
      { existing }
    )
  );
  // The projector must have raised G3 — otherwise this proof would be vacuous.
  expect(proj.gates.map((g) => g.gateId)).toContain('G3');
  return proj.events;
}

async function authorDocintelChain(
  edge: FakeEdge,
  events: CaseLogEvent[]
): Promise<CaseLogEntry[]> {
  edge.seedProject(PROJECT);
  await appendCaseLog(edge, PROJECT, {
    caseId: CASE,
    firmId: FIRM,
    actor: { kind: 'agent', id: 'lm-docintel' },
    events,
    versions: VERSIONS,
    originArtifactId: 'art_d7',
    runId: 'run_d7',
    at: 1_700_000_000_000,
  });
  return readChain(edge, PROJECT, CASE);
}

describe('convergence — docintel-authored chain kill-the-laptop (SC-004)', () => {
  beforeEach(() => {
    clearAllCrmState();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('fold → wipe → refold reproduces a docintel projection byte-for-byte', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const chain = await authorDocintelChain(edge, d7ConflictEvents());
    expect(chain.length).toBeGreaterThan(0);

    await foldEntries(CASE, chain);
    const s1 = foldSnapshot();
    // The docintel G3 is present and open in the projection.
    const g3 = Object.values(getCrmEventLogStore().getState().openGates).find(
      (g) => g.gateId === 'G3' && g.caseId === CASE
    );
    expect(g3?.status).toBe('open');

    clearAllCrmState();
    expect(getCrmEventLogStore().getState().openGates).toEqual({});
    expect(getCrmEventLogStore().getState().watermarks).toEqual({});

    await foldEntries(CASE, chain);
    const s2 = foldSnapshot();

    expect(s2).toBe(s1);
    expect(selectCaseWatermark(CASE)).toBe(chain[chain.length - 1].seq);
  });

  it('the docintel G3 gate is reconstructed from the chain alone (finding 10)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const chain = await authorDocintelChain(edge, d7ConflictEvents());

    // Fold once, then wipe every store to the floor — any mirror side-write is
    // gone, so only the chain's gate-raise entry can bring the G3 card back.
    await foldEntries(CASE, chain);
    clearAllCrmState();
    expect(getCrmEventLogStore().getState().openGates).toEqual({});

    await foldEntries(CASE, chain);
    const g3 = Object.values(getCrmEventLogStore().getState().openGates).find(
      (g) => g.gateId === 'G3' && g.caseId === CASE
    );
    expect(g3?.gateId).toBe('G3');
    expect(g3?.status).toBe('open');

    // Record-never-repair: the conflict is on file but no applicant income field
    // was overwritten — the value on file stays authoritative until a human picks.
    const conflicts = getCrmCasesStore().getState().conflictsById;
    expect(Object.keys(conflicts).length).toBeGreaterThan(0);
  });

  it('every docintel-authored entry cites the side-car as its origin (FR-002)', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const chain = await authorDocintelChain(edge, d7ConflictEvents());

    // The extraction kind is never folded raw; every entry is a safe event kind
    // carrying origin.artifactId back to the side-car artifact.
    for (const entry of chain) {
      expect(entry.event.type).not.toBe('lm.docintel.extraction/1');
      expect(entry.origin?.artifactId).toBe('art_d7');
    }
  });
});
