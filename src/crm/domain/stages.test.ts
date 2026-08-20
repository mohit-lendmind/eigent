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
import { nextStage, STAGE_MAP, stageIndex, STAGES } from './stages';

describe('stages', () => {
  it('has the 8 stages in canonical order', () => {
    expect(STAGES.map((s) => s.key)).toEqual([
      'LEAD',
      'FACT_FIND',
      'SOURCING',
      'DIP',
      'APPLICATION',
      'VALUATION',
      'OFFER',
      'COMPLETION',
    ]);
  });

  it('stageIndex is monotonic', () => {
    const idxs = STAGES.map((s) => stageIndex(s.key));
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
    }
  });

  it('nextStage returns the following stage', () => {
    expect(nextStage('LEAD')).toBe('FACT_FIND');
    expect(nextStage('OFFER')).toBe('COMPLETION');
  });

  it('nextStage returns null for terminal stage', () => {
    expect(nextStage('COMPLETION')).toBeNull();
  });

  it('tones are semantic keys — no hex, no rgb, no tailwind color', () => {
    const badForm =
      /#[0-9a-fA-F]{3,8}|\brgba?\(|\bhsla?\(|\bbg-(red|blue|green|yellow|amber|purple)-\d/;
    for (const s of STAGES) {
      expect(s.tone).toEqual(expect.any(String));
      expect(badForm.test(s.tone)).toBe(false);
    }
  });

  it('STAGE_MAP mirrors STAGES', () => {
    for (const s of STAGES) {
      expect(STAGE_MAP[s.key]).toEqual(s);
    }
  });
});
