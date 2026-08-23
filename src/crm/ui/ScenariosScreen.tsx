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

// M5 (FR-015) — the /crm/scenarios route. It composes the adviser-only surface
// off a SYNTHETIC base scenario (no real lender data): the criteria board, the
// affordability panel, and a side-by-side comparison of the base against two
// counterfactuals (a larger deposit, a higher rate). Everything is indicative and
// adviser-only by construction; the screen only reads the pure engines.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AffordabilityInput } from '../agentContracts/criteriaAffordability';
import {
  applyDelta,
  buildBaseScenario,
  type ScenarioBasis,
} from '../criteria/counterfactual';
import {
  SYNTHETIC_CASE_FACTS,
  SYNTHETIC_CRITERIA_PACK,
  SYNTHETIC_LENDER_PANEL,
} from '../fixtures/criteriaPack';
import { AffordabilityPanel } from './AffordabilityPanel';
import { ScenarioBoard } from './ScenarioBoard';
import { ScenarioComparison } from './ScenarioComparison';

const AFFORDABILITY_INPUTS: readonly AffordabilityInput[] = [
  {
    key: 'annualIncomePence',
    valuePence: 6_000_000,
    provenance: 'det',
    sourceRef: 'doc:payslip',
  },
  { key: 'termYears', value: 25, provenance: 'det', sourceRef: 'app:term' },
  { key: 'rateBps', value: 499, provenance: 'det', sourceRef: 'product:rate' },
  {
    key: 'incomeMultiple',
    value: 4.5,
    provenance: 'det',
    sourceRef: 'product:lti',
  },
];

const BASIS: ScenarioBasis = {
  pack: SYNTHETIC_CRITERIA_PACK,
  caseFacts: SYNTHETIC_CASE_FACTS,
  lenderPanel: SYNTHETIC_LENDER_PANEL,
  affordabilityInputs: AFFORDABILITY_INPUTS,
  stressRateBps: 700,
  caseId: 'c417',
};

export function ScenariosScreen() {
  const { t } = useTranslation();
  const { base, scenarios } = useMemo(() => {
    const b = buildBaseScenario(BASIS);
    return {
      base: b,
      scenarios: [
        b,
        applyDelta(b, { depositPence: 9_000_000 }),
        applyDelta(b, { rateBps: 699 }),
      ],
    };
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-ds-text-neutral-strong-default">
          {t('crm.scenario.title')}
        </h1>
      </header>
      <ScenarioBoard
        assessment={base.criteria}
        pack={SYNTHETIC_CRITERIA_PACK}
      />
      <AffordabilityPanel assessment={base.affordability} />
      <ScenarioComparison scenarios={scenarios} />
    </div>
  );
}

export default ScenariosScreen;
