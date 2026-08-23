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

// M5 (FR-013/014) — the audited write paths under test. A G6 criteria override
// is a HUMAN act: it refuses an empty rationale, folds the ORIGINAL machine
// verdict + adviser id + rationale + the standing compliance flag, and raises a
// tier-2 G6 gate that the fold reconstructs. Pack authorship is an append-only,
// pure log whose fold names the last editor of each rule (with a touch count) and
// refuses an unnamed author or a no-op edit.

import { clearAllCrmState } from '@/crm';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import {
  recordCriteriaOverride,
  type CriteriaOverrideRecord,
} from '@/crm/agents/criteriaOverride';
import { configureAgentEdge } from '@/crm/agents/edge';
import {
  foldPackEdits,
  recordPackEdit,
  type PackEditRecord,
} from '@/crm/criteria/packEdit';
import { getCrmEventLogStore } from '@/crm/fold/eventLogStore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

const CASE = 'c417';
const FIRM = 'lendmind';

describe('recordCriteriaOverride — G6 audited override (FR-013)', () => {
  beforeEach(() => {
    clearAllCrmState();
    resetCaseProjectCaches();
    localStorage.clear();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('refuses an empty rationale before any write', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const res = await recordCriteriaOverride({
      caseId: CASE,
      firmId: FIRM,
      adviserId: 'adv-jones',
      lenderId: 'lender-cavendish',
      originalVerdict: 'fail',
      overrideVerdict: 'pass',
      rationale: '   ',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('rationale-required');
    // Nothing was raised — the refusal happens before the edge is touched.
    expect(getCrmEventLogStore().getState().openGates).toEqual({});
  });

  it('folds the ORIGINAL verdict + adviser + rationale + compliance flag', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const res = await recordCriteriaOverride({
      caseId: CASE,
      firmId: FIRM,
      adviserId: 'adv-jones',
      lenderId: 'lender-cavendish',
      originalVerdict: 'fail',
      overrideVerdict: 'pass',
      rationale: 'Deposit top-up agreed; LTV drops under the cap.',
      now: 1_700_000_000_000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // The machine verdict the adviser overruled is never dropped.
    expect(res.record.originalVerdict).toBe('fail');
    expect(res.record.overrideVerdict).toBe('pass');
    expect(res.record.adviserId).toBe('adv-jones');
    expect(res.record.rationale).toBe(
      'Deposit top-up agreed; LTV drops under the cap.'
    );
    expect(res.record.raisesComplianceFlag).toBe(true);

    // The audited artifact holds the same record, byte-for-byte.
    const stored = await edge.getArtifact(
      res.gate.projectId,
      res.overrideArtifactId,
      { inline: true }
    );
    const parsed = JSON.parse(stored.content ?? '{}') as CriteriaOverrideRecord;
    expect(parsed.originalVerdict).toBe('fail');
    expect(parsed.adviserId).toBe('adv-jones');
    expect(parsed.raisesComplianceFlag).toBe(true);
  });

  it('raises a tier-2 G6 gate mirrored into the projection', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const res = await recordCriteriaOverride({
      caseId: CASE,
      firmId: FIRM,
      adviserId: 'adv-jones',
      lenderId: 'lender-cavendish',
      originalVerdict: 'fail',
      overrideVerdict: 'pass',
      rationale: 'Deposit top-up agreed.',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.gate.gateId).toBe('G6');
    const open = Object.values(getCrmEventLogStore().getState().openGates).find(
      (g) => g.gateId === 'G6' && g.caseId === CASE
    );
    expect(open?.status).toBe('open');
    expect(open?.reasons.length).toBeGreaterThan(0);
  });

  it('records staleness when the overruled rule was past its ttl', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);
    const res = await recordCriteriaOverride({
      caseId: CASE,
      firmId: FIRM,
      adviserId: 'adv-jones',
      lenderId: 'lender-harringside',
      originalVerdict: 'refer',
      overrideVerdict: 'pass',
      rationale: 'Confirmed current with lender BDM.',
      stale: true,
      ruleKey: 'maxLTV',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.stale).toBe(true);
    expect(res.record.ruleKey).toBe('maxLTV');
  });
});

describe('pack authorship — append-only, pure fold (FR-014)', () => {
  const base: PackEditRecord[] = [];

  it('refuses an unnamed author', () => {
    const res = recordPackEdit(base, {
      packRef: 'pack:1',
      lenderId: 'lender-cavendish',
      ruleKey: 'maxLTV',
      editedBy: '   ',
      field: 'value',
      before: '70',
      after: '75',
      at: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('author-required');
  });

  it('refuses a no-op edit (before === after)', () => {
    const res = recordPackEdit(base, {
      packRef: 'pack:1',
      lenderId: 'lender-cavendish',
      ruleKey: 'maxLTV',
      editedBy: 'adv-jones',
      field: 'value',
      before: '70',
      after: '70',
      at: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no-change');
  });

  it('folds authorship — last editor wins, touch count preserved', () => {
    let log: PackEditRecord[] = [];
    const first = recordPackEdit(log, {
      packRef: 'pack:1',
      lenderId: 'lender-cavendish',
      ruleKey: 'maxLTV',
      editedBy: 'adv-jones',
      field: 'value',
      before: '70',
      after: '72',
      at: 10,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    log = first.log;

    const second = recordPackEdit(log, {
      packRef: 'pack:1',
      lenderId: 'lender-cavendish',
      ruleKey: 'maxLTV',
      editedBy: 'adv-patel',
      field: 'value',
      before: '72',
      after: '75',
      at: 20,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    log = second.log;

    const authorship = foldPackEdits(log);
    const rule = authorship['lender-cavendish maxLTV'];
    expect(rule.editedBy).toBe('adv-patel');
    expect(rule.at).toBe(20);
    expect(rule.editCount).toBe(2);

    // Pure + deterministic: refolding the same log reproduces the map.
    expect(foldPackEdits(log)).toEqual(authorship);
    // Append-only: the original edit is still in the log.
    expect(log[0].editedBy).toBe('adv-jones');
    expect(log).toHaveLength(2);
  });
});
