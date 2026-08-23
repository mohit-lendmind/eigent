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

// Finding 1 (BLOCKER) regression — the FR-004 trust-spine floor at the FOLD.
// A field-change that OMITS `src` must not round UP to `det` for an untrusted
// (agent/unknown) writer: it floors to `syn`, so a crafted income entry can
// never satisfy G9 without a deterministic quote match. A human/manual adviser
// edit legitimately keeps `det`. And because every M1/M2 fixture sets `src`
// explicitly, a historic refold stays byte-identical. Synthetic fixtures only.

import { clearAllCrmState } from '@/crm';
import type { CaseLogActorKind } from '@/crm/agentContracts';
import { assessIncomeGate } from '@/crm/agents/incomeGate';
import { getCrmCasesStore } from '@/crm/casesStore';
import { defaultFieldSrc } from '@/crm/domain/fieldSrc';
import { toPence } from '@/crm/domain/money';
import type { Applicant, Case, FieldValue, Src } from '@/crm/domain/types';
import { CRM_SCHEMA_VERSION } from '@/crm/domain/types';
import {
  buildChain,
  type CaseLogEntryDraft,
} from '@/crm/fixtures/caselog/buildChain';
import { foldEntries } from '@/crm/fold/caseLogFold';
import { beforeEach, describe, expect, it } from 'vitest';

const CASE = 'c_fr004';
const FIRM = 'firm_syn';
const VERSIONS = {
  model: 'lm-docintel',
  promptSha: 'lm-docintel',
  skillSemver: '1.0.0',
  skillSha: 'lm-docintel-m3',
};
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

function applicant(clientId: string): Applicant {
  return { clientId, role: 'primary', profile: {}, completeness: 0 };
}

function seedCase(): Case {
  return {
    id: CASE,
    ref: 'LM-FR004',
    type: 'residential',
    kind: 'purchase',
    label: 'FR-004 floor',
    stage: 'FACT_FIND',
    completeness: 0,
    updated: T0,
    applicants: [applicant('daniel')],
    schemaVersion: CRM_SCHEMA_VERSION,
  };
}

// A field-change draft that OMITS `src` — the whole point of the floor.
function incomeDraftNoSrc(
  step: number,
  actor: { kind: CaseLogActorKind; id: string },
  value: FieldValue = { t: 'money', v: toPence(4_000_000) }
): CaseLogEntryDraft {
  return {
    kind: 'lm.caselog/1',
    caseId: CASE,
    firmId: FIRM,
    at: T0 + step * 60_000,
    actor,
    event: {
      type: 'field-change',
      payload: {
        clientId: 'daniel',
        section: 'income',
        fieldKey: 'basicIncome',
        label: 'Basic income',
        value,
        // src deliberately absent.
      },
    },
    origin: { artifactId: `art-${step}`, runId: 'run-fr004' },
    versions: { ...VERSIONS },
  };
}

function caseUpsertDraft(): CaseLogEntryDraft {
  return {
    kind: 'lm.caselog/1',
    caseId: CASE,
    firmId: FIRM,
    at: T0,
    actor: { kind: 'adviser', id: 'adv' },
    event: { type: 'case-upsert', payload: { case: seedCase() } },
    origin: { artifactId: 'art-seed', runId: 'run-fr004' },
    versions: { ...VERSIONS },
  };
}

function foldedIncomeSrc(): Src | undefined {
  const c = getCrmCasesStore().getState().casesById[CASE];
  const daniel = c?.applicants.find((a) => a.clientId === 'daniel');
  return daniel?.profile.income?.fields.find((f) => f.k === 'basicIncome')?.src;
}

describe('FR-004 fold floor (finding 1)', () => {
  beforeEach(() => {
    clearAllCrmState();
    localStorage.clear();
  });

  it('defaultFieldSrc floors non-adviser writers to syn', () => {
    expect(defaultFieldSrc('adviser')).toBe('det');
    expect(defaultFieldSrc('agent')).toBe('syn');
    expect(defaultFieldSrc('watcher')).toBe('syn');
    expect(defaultFieldSrc('schedule')).toBe('syn');
    expect(defaultFieldSrc('system')).toBe('syn');
    expect(defaultFieldSrc(undefined)).toBe('syn');
  });

  it('an agent income field-change with no src folds as syn and does NOT satisfy G9', async () => {
    const chain = await buildChain([
      caseUpsertDraft(),
      incomeDraftNoSrc(1, { kind: 'agent', id: 'lm-docintel' }),
    ]);
    await foldEntries(CASE, chain);

    // The floor: no explicit src + agent writer ⇒ syn, never det.
    expect(foldedIncomeSrc()).toBe('syn');

    // G9 must therefore NOT be satisfied — a syn income can never round up.
    const gate = assessIncomeGate(
      ['daniel'],
      [{ clientId: 'daniel', fieldKey: 'basicIncome', src: foldedIncomeSrc()! }]
    );
    expect(gate.satisfied).toBe(false);
    expect(gate.blocking).toContainEqual({
      clientId: 'daniel',
      fieldKey: 'basicIncome',
      reason: 'syn-only',
    });
  });

  it('a human adviser income field-change with no src legitimately keeps det', async () => {
    const chain = await buildChain([
      caseUpsertDraft(),
      incomeDraftNoSrc(1, { kind: 'adviser', id: 'adv-imran' }),
    ]);
    await foldEntries(CASE, chain);
    expect(foldedIncomeSrc()).toBe('det');
  });

  it('is deterministic — refolding the same chain reproduces the src byte-identically', async () => {
    const chain = await buildChain([
      caseUpsertDraft(),
      incomeDraftNoSrc(1, { kind: 'agent', id: 'lm-docintel' }),
    ]);
    await foldEntries(CASE, chain);
    const first = foldedIncomeSrc();

    clearAllCrmState();
    localStorage.clear();

    await foldEntries(CASE, chain);
    expect(foldedIncomeSrc()).toBe(first);
  });
});
