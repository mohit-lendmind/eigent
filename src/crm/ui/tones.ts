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

// FR-020 — the CRM tone vocabulary. Every colour the surface renders resolves to
// a design-system token class (never a raw hex), so light/dark contrast is the
// house theme's job, not this module's. A CrmTone is a semantic role; the maps
// below turn it into the ds `bg`/`text`/`border` classes a badge or row uses, and
// a stage ramp assigns a tone to each pipeline stage.

import type { Stage } from '../domain/stages';

// The semantic roles the CRM surface paints with. Each maps 1:1 to a ds tone.
export type CrmTone =
  'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export interface ToneClasses {
  /** Subtle fill for a badge/row background. */
  bg: string;
  /** Readable foreground against the subtle fill. */
  text: string;
  /** Hairline border in the same tone. */
  border: string;
}

// Every role points at a ds tone that exists in both light and dark themes, so a
// badge is legible either way without this module knowing a single colour value.
const TONE_TO_DS: Record<CrmTone, string> = {
  neutral: 'neutral',
  brand: 'brand',
  info: 'information',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

/** The ds class trio for a tone: subtle background, strong text, tone border. */
export function toneClasses(tone: CrmTone): ToneClasses {
  const ds = TONE_TO_DS[tone];
  const textEmphasis = tone === 'neutral' ? 'default' : 'strong';
  return {
    bg: `bg-ds-bg-${ds}-subtle-default`,
    text: `text-ds-text-${ds}-${textEmphasis}-default`,
    border: `border-ds-bg-${ds}-default-default`,
  };
}

// The stage ramp: a case's pipeline stage reads as a tone that cools from a fresh
// lead (brand) toward completion (success), with the regulated middle in info.
const STAGE_TONE: Record<Stage, CrmTone> = {
  LEAD: 'brand',
  FACT_FIND: 'info',
  SOURCING: 'info',
  DIP: 'warning',
  APPLICATION: 'warning',
  VALUATION: 'info',
  OFFER: 'success',
  COMPLETION: 'success',
};

/** The tone for a pipeline stage (the stage ramp). */
export function stageTone(stage: Stage): CrmTone {
  return STAGE_TONE[stage] ?? 'neutral';
}

// A gate's triage tier maps to urgency tone: tier 1 (veto-grade) reads danger,
// tier 2 (regulated-routine) warning, tier 3 (operational) neutral.
export function tierTone(tier: 1 | 2 | 3): CrmTone {
  if (tier === 1) return 'danger';
  if (tier === 2) return 'warning';
  return 'neutral';
}
