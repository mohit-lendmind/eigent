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

// M5 (FR-015/013/014) — the adviser-only scenario surface under test. The board's
// inline why-not is a keyboard-reachable native button whose drawer reveals the
// exact cited text; the affordability dots are role="img" with verified/synthetic
// aria-labels and ds-token tones that stay legible in dark mode; the G6 override
// is rationale-gated before it can hand a record up; and the gated pack editor
// keeps Save closed until a named editor is present. The react-i18next mock
// returns keys verbatim, so localized strings are asserted by their key.

import type {
  AffordabilityAssessment,
  CriteriaAssessment,
} from '@/crm/agentContracts/criteriaAffordability';
import { buildBaseScenario } from '@/crm/criteria/counterfactual';
import {
  SYNTHETIC_CASE_FACTS,
  SYNTHETIC_CRITERIA_PACK,
  SYNTHETIC_LENDER_PANEL,
} from '@/crm/fixtures/criteriaPack';
import { AffordabilityPanel } from '@/crm/ui/AffordabilityPanel';
import { CriteriaOverride } from '@/crm/ui/CriteriaOverride';
import { CriteriaPackEditor } from '@/crm/ui/CriteriaPackEditor';
import { ScenarioBoard } from '@/crm/ui/ScenarioBoard';
import {
  ScenarioComparison,
  closestMissFirst,
} from '@/crm/ui/ScenarioComparison';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

const BASE = buildBaseScenario({
  pack: SYNTHETIC_CRITERIA_PACK,
  caseFacts: SYNTHETIC_CASE_FACTS,
  lenderPanel: SYNTHETIC_LENDER_PANEL,
  affordabilityInputs: [
    {
      key: 'annualIncomePence',
      valuePence: 6_000_000,
      provenance: 'det',
      sourceRef: 'doc:payslip',
    },
    { key: 'termYears', value: 25, provenance: 'det', sourceRef: 'app:term' },
    {
      key: 'rateBps',
      value: 499,
      provenance: 'det',
      sourceRef: 'product:rate',
    },
    {
      key: 'incomeMultiple',
      value: 4.5,
      provenance: 'syn',
    },
  ],
  stressRateBps: 700,
  caseId: 'c417',
});

const CRITERIA: CriteriaAssessment = BASE.criteria;

function findLender(lenderId: string) {
  const r = CRITERIA.results.find((x) => x.lenderId === lenderId);
  if (!r) throw new Error(`missing ${lenderId}`);
  return r;
}

describe('ScenarioBoard — inline why-not, keyboard-reachable (FR-015)', () => {
  it('a non-pass verdict opens its cited-text drawer via a native button', () => {
    render(
      createElement(ScenarioBoard, {
        assessment: CRITERIA,
        pack: SYNTHETIC_CRITERIA_PACK,
      })
    );

    // cavendish fails on LTV — its why-not is a real <button> (keyboard-reachable).
    const cavendish = findLender('lender-cavendish');
    expect(cavendish.verdict).toBe('fail');
    const ruleKey = cavendish.reasons[0].ruleKey;
    const trigger = screen
      .getAllByRole('button')
      .find(
        (b) =>
          b.getAttribute('aria-controls') === `why-lender-cavendish-${ruleKey}`
      );
    expect(trigger).toBeTruthy();
    expect(trigger!.getAttribute('aria-expanded')).toBe('false');

    // Toggling reveals the exact cited text behind the drawer.
    fireEvent.click(trigger!);
    expect(trigger!.getAttribute('aria-expanded')).toBe('true');
    const drawer = document.getElementById(`why-lender-cavendish-${ruleKey}`);
    expect(drawer?.textContent).toContain(cavendish.reasons[0].citedText);
  });

  it('every excluded lender surfaces at least one reason (never silent)', () => {
    render(
      createElement(ScenarioBoard, {
        assessment: CRITERIA,
        pack: SYNTHETIC_CRITERIA_PACK,
      })
    );
    for (const r of CRITERIA.results) {
      if (r.verdict !== 'pass') {
        expect(r.reasons.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('AffordabilityPanel — verified/synthetic dots (FR-015)', () => {
  const assessment: AffordabilityAssessment = BASE.affordability;

  it('renders a verified dot per det input and a synthetic dot per syn input', () => {
    render(createElement(AffordabilityPanel, { assessment }));

    const verified = screen.getAllByLabelText('crm.affordability.dot-verified');
    const synthetic = screen.getAllByLabelText(
      'crm.affordability.dot-synthetic'
    );
    const detCount = assessment.inputs.filter(
      (i) => i.provenance === 'det'
    ).length;
    const synCount = assessment.inputs.filter(
      (i) => i.provenance === 'syn'
    ).length;
    expect(verified.length).toBe(detCount);
    expect(synthetic.length).toBe(synCount);

    // Dots are role="img" and carry ds-token tones so they stay legible in dark
    // mode (a bg + border token, never a raw colour).
    for (const dot of [...verified, ...synthetic]) {
      expect(dot.getAttribute('role')).toBe('img');
      expect(dot.className).toMatch(/bg-ds-bg-(success|warning)/);
      expect(dot.className).toMatch(/border-ds-bg-(success|warning)/);
    }
  });

  it('summarises the synthetic-input count when any input is unverified', () => {
    render(createElement(AffordabilityPanel, { assessment }));
    expect(screen.getByText('crm.affordability.n-synthetic')).toBeTruthy();
  });
});

describe('CriteriaOverride — G6 rationale gate (FR-013)', () => {
  it('arms, shows the original verdict, and blocks confirm until a rationale is typed', () => {
    const onConfirm = vi.fn();
    render(
      createElement(CriteriaOverride, {
        lenderId: 'lender-cavendish',
        originalVerdict: 'fail',
        overrideVerdict: 'pass',
        onConfirm,
      })
    );

    // Step 1 — arm.
    fireEvent.click(screen.getByText('crm.criteria.override-arm-label'));

    // The confirm button is disabled until the rationale is present.
    const confirm = screen
      .getByText('crm.criteria.override-confirm')
      .closest('button')!;
    expect(confirm.disabled).toBe(true);
    // The standing compliance flag is stated in plain words.
    expect(screen.getByText('crm.criteria.override-flag')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Deposit top-up agreed.' },
    });
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      lenderId: 'lender-cavendish',
      originalVerdict: 'fail',
      overrideVerdict: 'pass',
      rationale: 'Deposit top-up agreed.',
    });
  });
});

describe('CriteriaPackEditor — gated save (FR-014)', () => {
  it('keeps Save closed without a named editor, then hands the edit up', () => {
    const onEdit = vi.fn();
    const { rerender } = render(
      createElement(CriteriaPackEditor, {
        editorId: '',
        onEdit,
      })
    );
    // No editor → the gated note shows and Save stays disabled.
    expect(screen.getByText('crm.criteria.pack-gated-note')).toBeTruthy();
    for (const save of screen.getAllByText('crm.criteria.pack-save')) {
      expect(save.closest('button')!.disabled).toBe(true);
    }

    // Name an editor + change a value → Save opens and hands up the edit.
    rerender(
      createElement(CriteriaPackEditor, {
        editorId: 'adv-jones',
        onEdit,
      })
    );
    const firstInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    fireEvent.change(firstInput, { target: { value: `${firstInput.value}9` } });
    const enabled = screen
      .getAllByText('crm.criteria.pack-save')
      .map((s) => s.closest('button')!)
      .find((b) => !b.disabled);
    expect(enabled).toBeTruthy();
    fireEvent.click(enabled!);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0]).toMatchObject({
      editedBy: 'adv-jones',
      field: 'value',
    });
  });
});

describe('ScenarioComparison — blocked band + closest-miss-first (FR-015)', () => {
  it('renders an honest blocked band instead of a grid when income is unverified', () => {
    render(
      createElement(ScenarioComparison, {
        scenarios: [BASE],
        block: 'g9-blocked',
        blockingSteps: ['Verify the applicant income from a payslip.'],
      })
    );
    const band = screen.getByRole('alert');
    expect(band.textContent).toContain('crm.scenario.blocked-g9');
    expect(band.textContent).toContain(
      'Verify the applicant income from a payslip.'
    );
  });

  it('orders closest-miss-first: refer before fail, fewer reasons first', () => {
    const ordered = closestMissFirst([
      { lenderId: 'a', verdict: 'fail', reasons: [{}, {}] as never },
      { lenderId: 'b', verdict: 'refer', reasons: [{}] as never },
      { lenderId: 'c', verdict: 'fail', reasons: [{}] as never },
    ]);
    expect(ordered.map((r) => r.lenderId)).toEqual(['b', 'c', 'a']);
  });
});
