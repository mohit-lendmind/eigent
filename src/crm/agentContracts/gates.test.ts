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
import { delegableGates, GATE_REGISTRY, gateById } from './gates';

describe('GATE_REGISTRY', () => {
  it('registers all 11 gates G1..G10 with unique ids', () => {
    const ids = GATE_REGISTRY.map((g) => g.id);
    expect(ids).toEqual([
      'G1',
      'G2',
      'G3',
      'G4a',
      'G4b',
      'G5',
      'G6',
      'G7',
      'G8',
      'G9',
      'G10',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds the invariant: a regulated gate is never delegable or batchable', () => {
    for (const gate of GATE_REGISTRY) {
      if (gate.regulated) {
        expect(gate.batchable).toBe(false);
        expect(gate.approver).not.toBe('delegate-ok');
      }
    }
  });

  it('gives every gate a triage tier and a positive SLA', () => {
    for (const gate of GATE_REGISTRY) {
      expect([1, 2, 3]).toContain(gate.tier);
      expect(gate.slaMinutes).toBeGreaterThan(0);
    }
  });
});

describe('gateById', () => {
  it('returns the descriptor for a known id', () => {
    expect(gateById('G5').name).toContain('Recommendation');
  });

  it('throws for an unknown id', () => {
    expect(() => gateById('G99' as never)).toThrowError(/unknown gate id/);
  });
});

describe('delegableGates', () => {
  it('is exactly G4b — the sole non-regulated, delegate-ok gate', () => {
    const delegable = delegableGates();
    expect(delegable.map((g) => g.id)).toEqual(['G4b']);
    expect(delegable[0].autoDisarmFlags).toContain('vulnerability');
  });
});
