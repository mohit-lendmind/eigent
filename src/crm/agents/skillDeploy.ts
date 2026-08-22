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

// FR-005 — deploy the two lendmind skills into the aion SkillStore. A SKILL.md
// (frontmatter name/description over a markdown body) becomes a skill document
// whose canonical fields are Go PascalCase (Name/Description/PromptText). The
// store dedupes by content hash (`changed: false` on a re-put) and reports any
// non-prompt field it stripped in `ignored_fields`, so a redeploy is safe and
// self-describing.

import type { PutSkillResult } from '@/api/aion/v1/transport';
import { parseSkillMd } from '@/lib/skillToolkit';
import onboardingSkillMd from '../../../resources/lm-skills/lm-onboarding/SKILL.md?raw';
import watcherSkillMd from '../../../resources/lm-skills/lm-watcher/SKILL.md?raw';
import { getAgentEdge } from './edge';

export const LM_SKILL_SOURCES: readonly string[] = [
  onboardingSkillMd,
  watcherSkillMd,
];

interface SkillDocument {
  name: string;
  document: Record<string, unknown>;
}

/** Parse a SKILL.md into a PascalCase skill document the store accepts. */
export function skillDocumentFrom(markdown: string): SkillDocument {
  const meta = parseSkillMd(markdown);
  if (!meta) {
    throw new Error('SKILL.md is missing its name/description frontmatter.');
  }
  return {
    name: meta.name,
    document: {
      Name: meta.name,
      Description: meta.description,
      PromptText: meta.body,
    },
  };
}

/** Deploy one SKILL.md; returns the store's result (changed + ignored_fields). */
export async function deployLmSkill(markdown: string): Promise<PutSkillResult> {
  const edge = await getAgentEdge();
  const { name, document } = skillDocumentFrom(markdown);
  return edge.putSkill(name, { document, origin: 'desktop_ui' });
}

/** Deploy every bundled lendmind skill. */
export function deployLmSkills(): Promise<PutSkillResult[]> {
  return Promise.all(LM_SKILL_SOURCES.map(deployLmSkill));
}
