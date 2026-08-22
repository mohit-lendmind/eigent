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

import {
  CaseBreaker,
  PassBudget,
  buildSpendRecord,
  usdMicroToGbpMicro,
} from '@/crm/agents/budget';
import { describe, expect, it } from 'vitest';

describe('FX conversion is exact bigint math', () => {
  it('converts micro-USD to micro-GBP at the configured rate', () => {
    // $1.27 at 1.27 USD/GBP is exactly £1.
    expect(usdMicroToGbpMicro(1_270_000n, 1_270_000)).toBe(1_000_000n);
  });

  it('truncates toward zero rather than rounding spend up', () => {
    // 1 micro-USD at 1.27 USD/GBP is a sub-micro-penny → 0, never 1.
    expect(usdMicroToGbpMicro(1n, 1_270_000)).toBe(0n);
  });

  it('falls back to the default rate rather than dividing by zero', () => {
    expect(usdMicroToGbpMicro(1_270_000n, 0)).toBe(1_000_000n);
  });

  it('handles a 64-bit figure without floating it', () => {
    const big = 9_000_000_000_000_000n; // > Number.MAX_SAFE_INTEGER
    expect(usdMicroToGbpMicro(big, 2_000_000)).toBe(4_500_000_000_000_000n);
  });
});

describe('SpendRecord stamps the rate and effective date', () => {
  it('derives GBP and carries the rate that produced it', () => {
    const record = buildSpendRecord({
      passId: 'pass-1',
      runId: 'run-1',
      caseId: 'c417',
      costMicroUsd: 2_540_000n,
      providerCalls: 3,
      fxUsdPerGbpMicro: 1_270_000,
      fxEffectiveDate: '2026-01-01',
      at: 111,
    });
    expect(record.costMicroUsd).toBe('2540000');
    expect(record.costMicroGbp).toBe('2000000');
    expect(record.fxUsdPerGbpMicro).toBe(1_270_000);
    expect(record.fxEffectiveDate).toBe('2026-01-01');
    expect(record.providerCalls).toBe(3);
    expect(record.caseId).toBe('c417');
    expect(record.at).toBe(111);
  });

  it('omits caseId for a pass-level (not case-level) spend', () => {
    const record = buildSpendRecord({
      passId: 'pass-2',
      runId: 'run-2',
      costMicroUsd: 0n,
      providerCalls: 0,
    });
    expect('caseId' in record).toBe(false);
  });
});

describe('CaseBreaker bounds invocations per rolling hour', () => {
  it('admits up to the ceiling then trips', () => {
    const breaker = new CaseBreaker(12);
    const now = 1_000_000;
    for (let i = 0; i < 12; i += 1) {
      expect(breaker.tryConsume('c417', now)).toBe(true);
    }
    expect(breaker.wouldTrip('c417', now)).toBe(true);
    expect(breaker.tryConsume('c417', now)).toBe(false);
    expect(breaker.countInHour('c417', now)).toBe(12);
  });

  it('slides the window: an hour later the case is fresh again', () => {
    const breaker = new CaseBreaker(2);
    const t0 = 1_000_000;
    expect(breaker.tryConsume('c1', t0)).toBe(true);
    expect(breaker.tryConsume('c1', t0)).toBe(true);
    expect(breaker.tryConsume('c1', t0)).toBe(false);
    const later = t0 + 60 * 60 * 1000 + 1;
    expect(breaker.tryConsume('c1', later)).toBe(true);
    expect(breaker.countInHour('c1', later)).toBe(1);
  });

  it('tracks cases independently', () => {
    const breaker = new CaseBreaker(1);
    const now = 5;
    expect(breaker.tryConsume('a', now)).toBe(true);
    expect(breaker.tryConsume('a', now)).toBe(false);
    expect(breaker.tryConsume('b', now)).toBe(true);
  });
});

describe('PassBudget bounds a single pass', () => {
  it('admits debits within the envelope and refuses the one that overflows', () => {
    const budget = new PassBudget(20_000n); // £0.02
    expect(budget.tryDebit(8_000n)).toBe(true);
    expect(budget.tryDebit(8_000n)).toBe(true);
    expect(budget.tryDebit(8_000n)).toBe(false); // would be 24_000 > 20_000
    expect(budget.spent).toBe(16_000n);
    expect(budget.remaining).toBe(4_000n);
  });
});
