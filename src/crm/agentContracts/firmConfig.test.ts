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
import { ContractDecodeError } from './errors';
import { decodeFirmConfig, FIRM_CONFIG_DEFAULTS } from './firmConfig';

describe('decodeFirmConfig', () => {
  it('requires only firmId; everything else falls back to a default', () => {
    const config = decodeFirmConfig({ firmId: 'firm-lm' });
    expect(config.firmId).toBe('firm-lm');
    expect(config.adapters.sourcing).toBe('mse');
    expect(config.breaker).toEqual(FIRM_CONFIG_DEFAULTS.breaker);
    expect(config.budgets).toEqual(FIRM_CONFIG_DEFAULTS.budgets);
    expect(config.lenderPanel).toEqual([]);
  });

  it('never lets a missing breaker/budget mean unbounded', () => {
    const config = decodeFirmConfig({ firmId: 'f', breaker: {}, budgets: {} });
    expect(config.breaker.maxInvocationsPerCaseHour).toBe(12);
    // £2 per pass (finding 1): the old £0.02 default tripped on essentially any
    // real LLM pass, starving watcher passes silently in production.
    expect(config.budgets.watcherPassMicroGbp).toBe(2_000_000);
    expect(config.budgets.caseMicroGbp).toBe(15_000_000);
  });

  it('keeps provided values and filters a non-string lender panel', () => {
    const config = decodeFirmConfig({
      firmId: 'f',
      lenderPanel: ['A', 2, 'B', null],
      breaker: { maxInvocationsPerCaseHour: 5 },
    });
    expect(config.lenderPanel).toEqual(['A', 'B']);
    expect(config.breaker.maxInvocationsPerCaseHour).toBe(5);
  });

  it('throws ContractDecodeError naming firmId when it is absent', () => {
    try {
      decodeFirmConfig({});
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ContractDecodeError);
      expect((error as ContractDecodeError).field).toBe('FirmConfig.firmId');
    }
  });
});
