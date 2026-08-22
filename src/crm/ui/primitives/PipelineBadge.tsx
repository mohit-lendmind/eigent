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

// FR-020 — a pipeline-stage badge. It paints a stage with the stage-ramp tone
// (see ./tones), so a LEAD reads brand and a COMPLETION reads success without
// this component knowing a single colour value.

import type { Stage } from '../../domain/stages';
import { stageTone, toneClasses } from '../tones';

const STAGE_LABEL: Record<Stage, string> = {
  LEAD: 'Lead',
  FACT_FIND: 'Fact find',
  SOURCING: 'Sourcing',
  DIP: 'DIP',
  APPLICATION: 'Application',
  VALUATION: 'Valuation',
  OFFER: 'Offer',
  COMPLETION: 'Completion',
};

export interface PipelineBadgeProps {
  stage: Stage;
  label?: string;
}

export function PipelineBadge({ stage, label }: PipelineBadgeProps) {
  const tone = toneClasses(stageTone(stage));
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone.bg} ${tone.text} ${tone.border}`}
    >
      {label ?? STAGE_LABEL[stage]}
    </span>
  );
}
