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
import { formatGbp, parseGbp, toPence, type Pence } from './money';

describe('money', () => {
  it('formatGbp formats pence to GBP full', () => {
    expect(formatGbp(toPence(4_275_000))).toBe('£42,750.00');
  });

  it('formatGbp compact renders k units', () => {
    expect(formatGbp(toPence(4_275_000), { compact: true })).toBe('£42.8k');
  });

  it('formatGbp compact renders m units', () => {
    expect(formatGbp(toPence(1_250_000_000), { compact: true })).toBe('£12.5m');
  });

  it('formatGbp compact renders sub-thousand pounds', () => {
    expect(formatGbp(toPence(45_000), { compact: true })).toBe('£450');
  });

  it('parseGbp accepts standard formatted strings', () => {
    expect(parseGbp('£38,500')).toBe(3_850_000);
    expect(parseGbp('38500')).toBe(3_850_000);
    expect(parseGbp('42750.50')).toBe(4_275_050);
  });

  it('parseGbp rejects garbage', () => {
    expect(parseGbp('nonsense')).toBeNull();
    expect(parseGbp('')).toBeNull();
    expect(parseGbp('12abc')).toBeNull();
  });

  it('branded Pence prevents assigning raw number without cast', () => {
    // @ts-expect-error — Pence is branded; raw number cannot be assigned directly.
    const bad: Pence = 1000;
    expect(bad).toBe(1000);
  });
});
