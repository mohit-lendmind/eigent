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

// Frozen M4 — sourcing connector framework. Adapter emits a plan; extract() is pure; verified is derived.
export interface QueryStep {
  tool: string;
  args: Record<string, unknown>;
} // a declarative delegation plan step
export interface Product {
  lenderId: string;
  productName: string;
  rate: number;
  aprc: number;
  feesPence: number;
  monthlyPence: number;
  trueCostPence: number;
  revertRate?: number;
  ercPence?: number;
  status: 'eligible' | 'declined';
  declineReason?: string;
}
export type CoverageKind =
  'mse-best-buys' | 'firm-panel' | 'whole-of-market' | (string & {});
export interface Coverage {
  kind: CoverageKind;
  statement: string;
  wholeOfMarket: boolean;
} // lint gate: phrase iff wholeOfMarket
export interface SourcingAdapter {
  id: 'mse' | 'mortgage-brain' | (string & {});
  verified: boolean; // derived at registration from a VerificationRef, NOT self-asserted
  sessionMode: 'isolated' | 'logged_in';
  buildQuery(caseFacts: Record<string, unknown>): QueryStep[]; // declarative plan the delegation pump runs
  extract(recordedResult: unknown): Product[]; // PURE — no browser/login/model
  coverage(): Coverage;
}
export interface VerificationRef {
  fixtureHash: string;
  ratesAsAt: string;
  rawEvidencePointer: string;
  canaryPassedAt?: string;
}
export interface SourcingSnapshotPayload {
  adapterId: string;
  coverage: Coverage;
  ratesAsAt: string;
  adviserId: string;
  verified: boolean;
  verification?: VerificationRef;
  surfaceClass: 'adviser-only';
  productsAttachmentId: string; // full set (incl. declines) rides as an attachment, NOT inline
  summary: {
    total: number;
    eligible: number;
    declined: number;
    topTrueCostPence: number;
  };
}
export declare function decodeSourcingSnapshotPayload(
  v: unknown
): SourcingSnapshotPayload; // requires coverage/ratesAsAt/products/verified
/** THE choke-point: results surface + every evidence export MUST call this; enforced in the writer/fold. */
export declare function assertClaimable(
  s: SourcingSnapshotPayload
):
  | { ok: true }
  | {
      ok: false;
      reason: 'unverified' | 'no-evidence' | 'stale' | 'wrong-surface';
    };
export declare const SOURCING_SERIALIZED_PER_DESKTOP: true; // singleton browser window
