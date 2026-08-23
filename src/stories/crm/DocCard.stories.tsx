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

import { toPence } from '@/crm/domain/money';
import type { CrmDocument } from '@/crm/domain/types';
import { DocCard } from '@/crm/ui/DocCard';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

const meta: Meta<typeof DocCard> = {
  title: 'CRM/DocCard',
  component: DocCard,
  args: {
    onOpenSource: fn(),
    onConfirmInsight: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof DocCard>;

const base: CrmDocument = {
  id: 'doc_d7',
  owner: 'client_daniel',
  name: 'payslip-d7.pdf',
  type: 'payslip',
  status: 'COMPLETED',
  size: 245_760,
  when: 1_700_000_000_000,
  iconTone: 'status-info',
  attribution: 0.97,
  schemaVersion: 1,
  insights: [
    {
      id: 'ins_basic',
      label: 'Annual basic income',
      value: { t: 'money', v: toPence(3_730_000) },
      conf: 0.98,
      src: 'det',
      sourceQuote: 'Annual basic £37,300',
      locator: { page: 1, line: 12 },
    },
    {
      id: 'ins_overtime',
      label: 'Overtime (this period)',
      value: { t: 'money', v: toPence(42_000) },
      conf: 0.71,
      src: 'syn',
    },
    {
      id: 'ins_ref',
      label: 'Employer reference',
      value: { t: 'text', v: 'ACME-2231' },
      conf: 0.6,
      src: 'syn',
    },
  ],
};

export const Queued: Story = {
  args: {
    document: { ...base, status: 'QUEUED', attribution: null, insights: [] },
  },
};

export const Processing: Story = {
  args: {
    document: {
      ...base,
      status: 'PROCESSING',
      attribution: null,
      insights: [],
    },
  },
};

export const Completed: Story = {
  args: { document: base },
};

export const WithConflict: Story = {
  args: {
    document: {
      ...base,
      insights: [
        { ...base.insights[0], conflict: true },
        base.insights[1],
        base.insights[2],
      ],
    },
  },
};

export const Rejected: Story = {
  args: {
    document: {
      ...base,
      status: 'REJECTED',
      type: 'utility-bill',
      attribution: null,
      insights: [],
    },
  },
};
