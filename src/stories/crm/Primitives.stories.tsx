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

import { STAGES } from '@/crm/domain/stages';
import { CompletenessRing } from '@/crm/ui/primitives/CompletenessRing';
import { PipelineBadge } from '@/crm/ui/primitives/PipelineBadge';
import { StatusPill } from '@/crm/ui/primitives/StatusPill';
import type { CrmTone } from '@/crm/ui/tones';
import type { Meta, StoryObj } from '@storybook/react-vite';

const TONES: CrmTone[] = [
  'neutral',
  'brand',
  'info',
  'success',
  'warning',
  'danger',
];

const meta: Meta = {
  title: 'CRM/Primitives',
};
export default meta;

type Story = StoryObj;

export const StageBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {STAGES.map((stage) => (
        <PipelineBadge key={stage.key} stage={stage.key} />
      ))}
    </div>
  ),
};

export const StatusPills: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {TONES.map((tone) => (
        <StatusPill key={tone} tone={tone} label={tone} />
      ))}
    </div>
  ),
};

export const CompletenessRings: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <CompletenessRing key={v} value={v} />
      ))}
    </div>
  ),
};
