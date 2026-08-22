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

import { gateById } from '@/crm/agentContracts/gates';
import { GateCard } from '@/crm/ui/GateCard';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

const meta: Meta<typeof GateCard> = {
  title: 'CRM/GateCard',
  component: GateCard,
  args: {
    onApprove: fn(),
    onEdit: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof GateCard>;

export const OnboardingG1: Story = {
  args: {
    gate: gateById('G1'),
    draft: {
      full: 'Dear client,\n\nWelcome. To progress your case we need a few documents…',
      editable: true,
    },
    provenance: {
      disclosureRef: 'IDD v3',
      reasons: ['New case reached onboarding', 'Firm disclosure pack attached'],
    },
  },
};

export const StageTransitionG7: Story = {
  args: {
    gate: gateById('G7'),
    provenance: {
      reasons: ['Fixed-rate deal ends within the firm lead window'],
    },
  },
};
