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

// Manifest-driven iteration (house reducer-harness pattern): tests loop the
// manifest rather than hand-listing fixtures, so a new negative is one entry
// here and is instantly covered by every table-driven assertion. Each entry
// carries a `load` (the delivery sequence) and an `expect` coordinate naming
// what a correct fold/verify must observe.

import type { CaseLogEntry } from '../../agentContracts/caseLog';
import { c417Log } from './c417Log';
import {
  duplicateSeq,
  outOfOrderArrival,
  oversizeEntry,
  tamperedHash,
  unknownEventKind,
} from './negatives';

export interface FixtureExpectation {
  /** verifyChain should report ok (a genuine, unbroken chain). */
  chainOk?: boolean;
  /** verifyChain should report this exact broken seq. */
  brokenAtSeq?: string;
  /** The fold should quarantine (not apply, not throw) this seq. */
  quarantinedSeq?: string;
  /** The fold should record this seq as a DUPLICATE_SEQ anomaly (first-wins). */
  duplicatedSeq?: string;
  /** The fold should refuse this seq as ENTRY_TOO_LARGE. */
  oversizeSeq?: string;
  /** Delivery is scrambled; the fold must buffer-ahead and still converge. */
  outOfOrder?: boolean;
}

export interface FixtureManifestEntry {
  name: string;
  description: string;
  kind: 'golden' | 'negative';
  load: () => Promise<CaseLogEntry[]>;
  expect: FixtureExpectation;
}

export const CASELOG_FIXTURE_MANIFEST: readonly FixtureManifestEntry[] = [
  {
    name: 'c417-golden',
    description: 'The c417 purchase — every event-kind member, a clean chain.',
    kind: 'golden',
    load: c417Log,
    expect: { chainOk: true },
  },
  {
    name: 'out-of-order-arrival',
    description: 'A valid chain delivered scrambled; fold must buffer-ahead.',
    kind: 'negative',
    load: outOfOrderArrival,
    expect: { outOfOrder: true },
  },
  {
    name: 'unknown-event-kind',
    description: 'Unknown event member decodes then quarantines, never throws.',
    kind: 'negative',
    load: async () => (await unknownEventKind()).entries,
    expect: { chainOk: true, quarantinedSeq: '9' },
  },
  {
    name: 'tampered-hash',
    description: 'Altered payload with a stale hash breaks at its exact seq.',
    kind: 'negative',
    load: async () => (await tamperedHash()).entries,
    expect: { brokenAtSeq: '4' },
  },
  {
    name: 'oversize-entry',
    description: 'A real link whose encoded size trips ENTRY_TOO_LARGE.',
    kind: 'negative',
    load: async () => (await oversizeEntry()).entries,
    expect: { chainOk: true, oversizeSeq: '9' },
  },
  {
    name: 'duplicate-seq',
    description: 'Same seq twice, different content; first-wins anomaly.',
    kind: 'negative',
    load: async () => (await duplicateSeq()).entries,
    expect: { duplicatedSeq: '3' },
  },
];
