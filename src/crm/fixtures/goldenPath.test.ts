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

import { describe, expect, it } from 'vitest';
import { case417 } from './case417';
import { conflict417DanielIncomeBasic } from './conflicts';
import { goldenPathBundle } from './goldenPath';

describe('goldenPath fixture integrity', () => {
  it('c417 LTV computes to 85% from deposit / propertyPrice', () => {
    const dep = Number(case417.deposit.amount);
    const price = Number(case417.property.price);
    // Deposit is 15% → loan is 85%
    const loanShare = 1 - dep / price;
    expect(loanShare).toBeCloseTo(0.85, 2);
  });

  it('c417 loan is £242,250 (24,225,000 pence)', () => {
    expect(Number(case417.requirement.loan)).toBe(24_225_000);
  });

  it('c417 LTI is 2.95× (± 0.01)', () => {
    expect(case417.requirement.lti).toBeCloseTo(2.95, 2);
  });

  it('c417 combined income is £82,100 (8,210,000 pence)', () => {
    expect(Number(case417.affordability.combinedIncome)).toBe(8_210_000);
  });

  it("Daniel's income.basic field links to the salary ConflictRecord", () => {
    const daniel = case417.applicants.find((a) => a.clientId === 'daniel');
    const basic = daniel?.profile.income?.fields.find((f) => f.k === 'basic');
    expect(basic?.conflictId).toBe(conflict417DanielIncomeBasic.id);
  });

  it('every c417 pass product carries non-empty rationale + criteriaTrail', () => {
    const c417Products = goldenPathBundle.products.filter(
      (p) => p.caseId === 'c417' && p.status === 'pass'
    );
    for (const p of c417Products) {
      expect(p.rationale?.length).toBeGreaterThan(0);
      expect(p.criteriaTrail?.length).toBeGreaterThan(0);
    }
  });

  it('every c417 fail product carries rejectReason, rejectCriterion, failOn', () => {
    const failed = goldenPathBundle.products.filter(
      (p) => p.caseId === 'c417' && p.status === 'fail'
    );
    for (const p of failed) {
      expect(p.rejectReason?.length).toBeGreaterThan(0);
      expect(p.rejectCriterion?.length).toBeGreaterThan(0);
      expect(p.failOn?.length).toBeGreaterThan(0);
    }
  });

  it('fixture colour references are semantic tone keys — no hex, rgb, or tailwind color class', () => {
    const bad =
      /#[0-9a-fA-F]{3,8}|\brgba?\(|\bhsla?\(|\bbg-(red|blue|green|yellow|amber|purple|slate)-\d/;
    const scan = (obj: unknown): void => {
      if (obj == null) return;
      if (typeof obj === 'string') {
        expect(bad.test(obj)).toBe(false);
        return;
      }
      if (Array.isArray(obj)) {
        for (const item of obj) scan(item);
        return;
      }
      if (typeof obj === 'object') {
        for (const v of Object.values(obj as Record<string, unknown>)) scan(v);
      }
    };
    scan(goldenPathBundle);
  });

  it('conflict record retains both salary values (£38,500 and £37,300)', () => {
    const values = conflict417DanielIncomeBasic.values.map((v) =>
      v.value.t === 'money' ? Number(v.value.v) : null
    );
    expect(values).toContain(3_850_000);
    expect(values).toContain(3_730_000);
  });

  it('worklist has 6 items in golden path', () => {
    expect(goldenPathBundle.worklist).toHaveLength(6);
  });

  it('documents fixture has 7 records', () => {
    expect(goldenPathBundle.documents).toHaveLength(7);
  });

  it('checklist has 4 aisha, 3 daniel, 3 joint items', () => {
    const aisha = goldenPathBundle.checklist.filter((c) => c.owner === 'aisha');
    const daniel = goldenPathBundle.checklist.filter(
      (c) => c.owner === 'daniel'
    );
    const joint = goldenPathBundle.checklist.filter((c) => c.owner === 'joint');
    expect(aisha).toHaveLength(4);
    expect(daniel).toHaveLength(3);
    expect(joint).toHaveLength(3);
  });

  it('retention has 4 entries', () => {
    expect(goldenPathBundle.retention).toHaveLength(4);
  });
});
