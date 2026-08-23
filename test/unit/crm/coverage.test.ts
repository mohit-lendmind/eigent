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

// M4 (FR-008) — the coverage honesty belts. makeCoverage refuses an overclaim at
// construction (belt 1), and the check-coverage-claim lint gate scans runtime
// source for the literal phrase (belt 2). This test drives both, and because CI
// runs vitest, spawning the gate here is what makes the gate a CI gate without a
// package.json/gates.yml change.

import {
  firmPanelCoverage,
  makeCoverage,
  MSE_COVERAGE_STATEMENT,
  mseCoverage,
  WHOLE_OF_MARKET_PHRASE,
} from '@/crm/connectors/coverage';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('coverage — makeCoverage refuses an overclaim at construction', () => {
  it('throws when a statement claims the phrase but the flag is false', () => {
    expect(() =>
      makeCoverage('firm-panel', 'We search the whole of market for you', false)
    ).toThrow(/overclaim/);
  });

  it('normalizes spacing so odd whitespace cannot slip the phrase past', () => {
    expect(() =>
      makeCoverage('firm-panel', 'the  whole\tof   market', false)
    ).toThrow(/overclaim/);
  });

  it('refuses wholeOfMarket:true with a non-whole-of-market kind', () => {
    expect(() =>
      makeCoverage('firm-panel', 'the whole of market', true)
    ).toThrow(/mismatch/);
  });

  it('allows the phrase only when the flag is genuinely true and kind matches', () => {
    const coverage = makeCoverage(
      'whole-of-market',
      'genuinely the whole of market',
      true
    );
    expect(coverage.wholeOfMarket).toBe(true);
  });

  it('MSE coverage is the fixed best-buys statement, flag false', () => {
    const coverage = mseCoverage();
    expect(coverage.kind).toBe('mse-best-buys');
    expect(coverage.wholeOfMarket).toBe(false);
    expect(coverage.statement).toBe(MSE_COVERAGE_STATEMENT);
    // The MSE statement uses the exact words only in the allowed negation.
    expect(coverage.statement.toLowerCase()).toContain(
      `not ${WHOLE_OF_MARKET_PHRASE}`
    );
  });

  it('a firm panel is coverage:false by construction', () => {
    expect(firmPanelCoverage('Panel of 42 lenders').wholeOfMarket).toBe(false);
  });
});

describe('coverage — the wholeOfMarket lint gate is green (FR-008)', () => {
  it('check-coverage-claim passes over runtime source', () => {
    // Throws (non-zero exit) if any runtime source overclaims — that failure IS
    // the gate. Kept in vitest so CI enforces it.
    const out = execFileSync('node', ['scripts/check-coverage-claim.mjs'], {
      encoding: 'utf-8',
    });
    expect(out).toContain('clean');
  });
});
