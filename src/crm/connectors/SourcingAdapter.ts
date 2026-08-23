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

// M4 (FR-001) — the SourcingAdapter interface. An adapter is a pure delegation
// plan + a pure extractor: buildQuery emits a declarative directive plan the
// existing parked-delegation pump runs (it NEVER touches the browser executor
// itself), and extract turns a recorded tool_result into normalized Products
// with no browser, login, or model in the loop. That purity is what makes a
// replay eval a real verification (FR-003).
//
// `verified` is on the frozen interface but is DERIVED at registration from a
// VerificationRef — an adapter module never hand-sets it. So adapter modules
// export a SourcingAdapterDefinition (no `verified` field to lie in); the
// registry attaches the derived flag and hands back a SourcingAdapter.

import type {
  Coverage,
  Product,
  QueryStep,
  VerificationRef,
} from '../agentContracts';

export type {
  Coverage,
  Product,
  QueryStep,
  VerificationRef,
} from '../agentContracts';

// MSE is public and API-intercept-first, so it runs in an isolated window.
// Licensed portals live behind a login where no network interception exists, so
// they are DOM-interaction only under a logged-in session (FR-002).
export type SourcingSessionMode = 'isolated' | 'logged_in';

// The frozen adapter shape (specs/005/contracts/sourcing.d.ts). `verified` is a
// plain boolean here because the interface is a consumer contract; the honesty
// spine is upstream, in how the registry populates it.
export interface SourcingAdapter {
  id: 'mse' | 'mortgage-brain' | (string & {});
  verified: boolean;
  sessionMode: SourcingSessionMode;
  buildQuery(caseFacts: Record<string, unknown>): QueryStep[];
  extract(recordedResult: unknown): Product[];
  coverage(): Coverage;
}

// What an adapter MODULE authors. There is deliberately no `verified` field to
// set — the registry derives it from `verification`. A scaffold simply omits
// (or under-populates) `verification` and is therefore verified:false.
export interface SourcingAdapterDefinition {
  id: SourcingAdapter['id'];
  sessionMode: SourcingSessionMode;
  buildQuery(caseFacts: Record<string, unknown>): QueryStep[];
  extract(recordedResult: unknown): Product[];
  coverage(): Coverage;
  /** The evidence a `verified:true` derivation stands on. Absent → scaffold. */
  verification?: VerificationRef;
}
