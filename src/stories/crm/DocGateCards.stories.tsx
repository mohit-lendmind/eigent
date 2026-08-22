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

import type { MirroredGate } from '@/crm/fold/eventLogStore';
import {
  AttributionGateCard,
  ConflictGateCard,
  DocErrorCard,
  IncomeGateCard,
} from '@/crm/ui/DocGateCards';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

const meta: Meta = {
  title: 'CRM/DocGateCards',
};
export default meta;

type Story = StoryObj;

function gate(over: Partial<MirroredGate>): MirroredGate {
  return {
    id: 'g_1',
    gateId: 'G2',
    caseId: 'c417',
    projectId: 'proj_syn',
    approvalId: 'appr_1',
    title: 'Gate',
    reasons: [],
    raisedAt: 1,
    status: 'open',
    ...over,
  };
}

export const G2Attribution: Story = {
  render: () => (
    <AttributionGateCard
      gate={gate({
        gateId: 'G2',
        reasons: [
          'Attribution confidence 62% is below 85%.',
          'Confirm the applicant before its facts are recorded.',
        ],
      })}
      onConfirm={fn()}
      onReject={fn()}
    />
  ),
};

export const G3Conflict: Story = {
  render: () => (
    <ConflictGateCard
      gate={gate({
        gateId: 'G3',
        reasons: [
          'Two verified values for income.basicIncome disagree by 3.1%.',
        ],
      })}
      existingLabel="£38,500.00"
      incomingLabel="£37,300.00"
      onKeepExisting={fn()}
      onUseIncoming={fn()}
    />
  ),
};

export const G9IncomeBlocked: Story = {
  render: () => (
    <IncomeGateCard
      result={{
        satisfied: false,
        blocking: [
          {
            clientId: 'client_amara',
            fieldKey: 'basicIncome',
            reason: 'missing',
          },
          {
            clientId: 'client_daniel',
            fieldKey: 'basicIncome',
            reason: 'syn-only',
          },
        ],
      }}
    />
  ),
};

export const TypedError: Story = {
  render: () => (
    <DocErrorCard message="This document is 4.2 MB — the ingest limit is 3 MB." />
  ),
};
