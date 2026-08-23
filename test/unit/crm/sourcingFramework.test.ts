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

// M4 (FR-001/003) — the framework belts: the registry DERIVES `verified` at
// registration (an adapter module has no field to lie in), and the replay
// harness feeds recorded frames to a PURE extract() so a replay is a real
// verification. The fixture content hash changes with the bytes, so a doctored
// fixture cannot pass as the one a canary verified.

import { decodeFirmConfig } from '@/crm/agentContracts';
import type {
  Product,
  SourcingAdapterDefinition,
} from '@/crm/connectors/SourcingAdapter';
import { firmPanelCoverage, mseCoverage } from '@/crm/connectors/coverage';
import {
  getSourcingAdapter,
  registerSourcingAdapter,
  resetSourcingRegistry,
  resolveSourcingAdapter,
} from '@/crm/connectors/registry';
import {
  decodeReplayFixture,
  hashFixture,
  replayExtract,
  type ReplayFixture,
} from '@/crm/connectors/replay/harness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function extractOne(recordedResult: unknown): Product[] {
  const rows = (recordedResult as { rows?: unknown[] }).rows ?? [];
  return rows.map((r) => {
    const row = r as Record<string, number | string>;
    return {
      lenderId: String(row.lenderId),
      productName: String(row.productName),
      rate: Number(row.rate),
      aprc: Number(row.aprc),
      feesPence: Number(row.feesPence),
      monthlyPence: Number(row.monthlyPence),
      trueCostPence: Number(row.trueCostPence),
      status: 'eligible' as const,
    };
  });
}

const scaffoldDef: SourcingAdapterDefinition = {
  id: 'test-scaffold',
  sessionMode: 'logged_in',
  buildQuery: () => [{ tool: 'nav', args: { url: 'https://example.invalid' } }],
  extract: extractOne,
  coverage: () => firmPanelCoverage('Test panel of 3'),
  // No verification → verified must derive false.
};

const verifiedDef: SourcingAdapterDefinition = {
  id: 'test-verified',
  sessionMode: 'isolated',
  buildQuery: () => [{ tool: 'fetch', args: {} }],
  extract: extractOne,
  coverage: () => mseCoverage(),
  verification: {
    fixtureHash: 'fnv1a64:1111111122222222',
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    rawEvidencePointer: 'lm/sourcing/x/products.json',
    canaryPassedAt: '2026-08-23T01:00:00.000Z',
  },
};

describe('registry — verified is DERIVED at registration (FR-001)', () => {
  beforeEach(() => resetSourcingRegistry());
  afterEach(() => resetSourcingRegistry());

  it('a definition without full evidence realizes verified:false', () => {
    registerSourcingAdapter(scaffoldDef);
    expect(getSourcingAdapter('test-scaffold')?.verified).toBe(false);
  });

  it('a definition with a full VerificationRef realizes verified:true', () => {
    registerSourcingAdapter(verifiedDef);
    expect(getSourcingAdapter('test-verified')?.verified).toBe(true);
  });

  it('resolveSourcingAdapter picks the firm-configured adapter', () => {
    registerSourcingAdapter(verifiedDef);
    const config = decodeFirmConfig({
      firmId: 'firm-x',
      adapters: { sourcing: 'test-verified' },
    });
    expect(resolveSourcingAdapter(config).id).toBe('test-verified');
  });

  it('resolveSourcingAdapter throws for an unregistered adapter', () => {
    const config = decodeFirmConfig({
      firmId: 'firm-x',
      adapters: { sourcing: 'nope' },
    });
    expect(() => resolveSourcingAdapter(config)).toThrow(/no sourcing adapter/);
  });
});

describe('replay harness — a replay of recorded frames is a real verification (FR-003)', () => {
  const fixture: ReplayFixture = {
    adapterId: 'test-verified',
    ratesAsAt: '2026-08-23T00:00:00.000Z',
    capturedAt: '2026-08-23T00:00:00.000Z',
    results: [
      {
        tool_name: 'fetch',
        arguments_json: '{}',
        result_json: JSON.stringify({
          rows: [
            {
              lenderId: 'a',
              productName: '2yr',
              rate: 4.2,
              aprc: 4.5,
              feesPence: 99900,
              monthlyPence: 120000,
              trueCostPence: 3100000,
            },
          ],
        }),
      },
    ],
  };

  it('replayExtract runs the pure extractor over recorded frames', () => {
    const products = replayExtract(extractOne, fixture);
    expect(products).toHaveLength(1);
    expect(products[0].lenderId).toBe('a');
  });

  it('hashFixture is deterministic and byte-sensitive', () => {
    const h1 = hashFixture(fixture);
    const h2 = hashFixture(structuredClone(fixture));
    expect(h1).toBe(h2);
    const doctored = structuredClone(fixture);
    doctored.results[0].result_json = doctored.results[0].result_json.replace(
      '4.2',
      '3.9'
    );
    expect(hashFixture(doctored)).not.toBe(h1);
  });

  it('decodeReplayFixture rejects a partial capture', () => {
    expect(() => decodeReplayFixture({ adapterId: 'x' })).toThrow();
  });

  it('replayExtract rejects a frame whose result_json is not JSON', () => {
    const bad: ReplayFixture = {
      ...fixture,
      results: [
        { tool_name: 'fetch', arguments_json: '{}', result_json: 'not-json' },
      ],
    };
    expect(() => replayExtract(extractOne, bad)).toThrow();
  });
});
