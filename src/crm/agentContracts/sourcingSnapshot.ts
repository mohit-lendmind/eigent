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

// M4 (FR-005/006/007/008) — the sourcing data types + the DEDICATED snapshot
// payload decoder. The generic M1 decoder (artifactKinds.decodeSourcingSnapshot)
// validates only the artifact spine; this decoder is the strict one the results
// surface and every evidence export decode through, requiring the fields that
// make a snapshot claimable: a typed coverage statement, rates-as-at, a pointer
// to the FULL result set (never inline — the fold drops oversize), the acting
// adviser id, and a DERIVED `verified`. These types mirror the frozen
// specs/005-mesh-m4-connectors/contracts/sourcing.d.ts byte-for-byte; the freeze
// test (m4ContractFreeze) pins them.

import { asRecord, ContractDecodeError, requireString } from './errors';

// A declarative delegation plan step. buildQuery emits these; the existing
// parked-delegation pump runs them via lm.directive/1 — the adapter never calls
// the browser executor itself (FR-001).
export interface QueryStep {
  tool: string;
  args: Record<string, unknown>;
}

// A normalized sourcing result row. Money is integer pence; a true-cost figure
// is the single number the shortlist ranks on. Declines ride in the full set
// with a reason, so the evidence pack shows what was considered and rejected.
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

// The coverage universe an adapter searched. `wholeOfMarket` is the machine
// checkable flag the coverage lint gate keys on — the literal phrase "whole of
// market" is forbidden anywhere unless this is true (MCOB 4.4A).
export type CoverageKind =
  'mse-best-buys' | 'firm-panel' | 'whole-of-market' | (string & {});

export interface Coverage {
  kind: CoverageKind;
  statement: string;
  wholeOfMarket: boolean;
}

// The evidence a `verified:true` derivation stands on: a hash of the replay
// fixture, the rates-as-at the run captured, a pointer to the raw enquiry
// evidence, and (only for a live-canary-verified adapter) when the canary last
// passed. `verified` is NEVER self-asserted — it is derived from this ref.
export interface VerificationRef {
  fixtureHash: string;
  ratesAsAt: string;
  rawEvidencePointer: string;
  canaryPassedAt?: string;
}

// Every sourcing snapshot is adviser-only. A structural surfaceClass (not UI
// hiding) is what the no-client-embed CI test asserts against (FR-007).
export const SOURCING_SURFACE_CLASS = 'adviser-only' as const;
export type SourcingSurfaceClass = typeof SOURCING_SURFACE_CLASS;

// Sourcing drives a single browser window per desktop, so runs are serialized
// (FR-010). This mirrors the frozen `SOURCING_SERIALIZED_PER_DESKTOP: true` — a
// literal-true type the freeze test pins, and the writer's lock honours it.
export const SOURCING_SERIALIZED_PER_DESKTOP = true as const;

// The folded case-log summary. The FULL result set (incl. declines) rides as a
// referenced attachment (productsAttachmentId), never inline — an inline set
// would blow the fold's oversize ceiling and be dropped.
export interface SourcingSnapshotPayload {
  adapterId: string;
  coverage: Coverage;
  ratesAsAt: string;
  adviserId: string;
  verified: boolean;
  verification?: VerificationRef;
  surfaceClass: SourcingSurfaceClass;
  productsAttachmentId: string;
  summary: {
    total: number;
    eligible: number;
    declined: number;
    topTrueCostPence: number;
  };
}

function decodeCoverage(value: unknown, label: string): Coverage {
  const object = asRecord(value, label);
  const kind = requireString(object, label, 'kind');
  const statement = requireString(object, label, 'statement');
  if (typeof object.wholeOfMarket !== 'boolean') {
    throw new ContractDecodeError(
      `${label}.wholeOfMarket`,
      'must be a boolean',
      object.wholeOfMarket
    );
  }
  return { kind, statement, wholeOfMarket: object.wholeOfMarket };
}

function decodeVerificationRef(value: unknown, label: string): VerificationRef {
  const object = asRecord(value, label);
  const ref: VerificationRef = {
    fixtureHash: requireString(object, label, 'fixtureHash'),
    ratesAsAt: requireString(object, label, 'ratesAsAt'),
    rawEvidencePointer: requireString(object, label, 'rawEvidencePointer'),
  };
  if (typeof object.canaryPassedAt === 'string') {
    ref.canaryPassedAt = object.canaryPassedAt;
  }
  return ref;
}

/**
 * THE dedicated sourcing-snapshot decoder (FR-005). Unlike the generic spine
 * decoder, this requires the claimable fields — coverage (typed), ratesAsAt, a
 * pointer to the full products set, the adviser id, and a `verified` flag — and
 * refuses a partial payload or any surfaceClass other than adviser-only.
 */
export function decodeSourcingSnapshotPayload(
  value: unknown
): SourcingSnapshotPayload {
  const object = asRecord(value, 'SourcingSnapshotPayload');
  const adapterId = requireString(
    object,
    'SourcingSnapshotPayload',
    'adapterId'
  );
  const coverage = decodeCoverage(
    object.coverage,
    'SourcingSnapshotPayload.coverage'
  );
  const ratesAsAt = requireString(
    object,
    'SourcingSnapshotPayload',
    'ratesAsAt'
  );
  const adviserId = requireString(
    object,
    'SourcingSnapshotPayload',
    'adviserId'
  );
  if (typeof object.verified !== 'boolean') {
    throw new ContractDecodeError(
      'SourcingSnapshotPayload.verified',
      'must be a boolean (derived, never absent)',
      object.verified
    );
  }
  if (object.surfaceClass !== SOURCING_SURFACE_CLASS) {
    throw new ContractDecodeError(
      'SourcingSnapshotPayload.surfaceClass',
      `must be '${SOURCING_SURFACE_CLASS}'`,
      object.surfaceClass
    );
  }
  const productsAttachmentId = requireString(
    object,
    'SourcingSnapshotPayload',
    'productsAttachmentId'
  );
  const summaryObject = asRecord(
    object.summary,
    'SourcingSnapshotPayload.summary'
  );
  const summary = {
    total: requireFiniteNumber(summaryObject, 'summary', 'total'),
    eligible: requireFiniteNumber(summaryObject, 'summary', 'eligible'),
    declined: requireFiniteNumber(summaryObject, 'summary', 'declined'),
    topTrueCostPence: requireFiniteNumber(
      summaryObject,
      'summary',
      'topTrueCostPence'
    ),
  };

  const payload: SourcingSnapshotPayload = {
    adapterId,
    coverage,
    ratesAsAt,
    adviserId,
    verified: object.verified,
    surfaceClass: SOURCING_SURFACE_CLASS,
    productsAttachmentId,
    summary,
  };
  if (object.verification !== undefined) {
    payload.verification = decodeVerificationRef(
      object.verification,
      'SourcingSnapshotPayload.verification'
    );
  }
  return payload;
}

function requireFiniteNumber(
  object: Record<string, unknown>,
  label: string,
  field: string
): number {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractDecodeError(
      `${label}.${field}`,
      'must be a finite number',
      value
    );
  }
  return value;
}

function decodeProduct(value: unknown, label: string): Product {
  const object = asRecord(value, label);
  const status = object.status;
  if (status !== 'eligible' && status !== 'declined') {
    throw new ContractDecodeError(
      `${label}.status`,
      "must be 'eligible' or 'declined'",
      status
    );
  }
  const product: Product = {
    lenderId: requireString(object, label, 'lenderId'),
    productName: requireString(object, label, 'productName'),
    rate: requireFiniteNumber(object, label, 'rate'),
    aprc: requireFiniteNumber(object, label, 'aprc'),
    feesPence: requireFiniteNumber(object, label, 'feesPence'),
    monthlyPence: requireFiniteNumber(object, label, 'monthlyPence'),
    trueCostPence: requireFiniteNumber(object, label, 'trueCostPence'),
    status,
  };
  if (typeof object.revertRate === 'number') {
    product.revertRate = object.revertRate;
  }
  if (typeof object.ercPence === 'number') product.ercPence = object.ercPence;
  if (typeof object.declineReason === 'string') {
    product.declineReason = object.declineReason;
  }
  return product;
}

/** The full result-set attachment: `{ products: Product[] }`, incl. declines. */
export function decodeSourcingProductsAttachment(value: unknown): Product[] {
  const object = asRecord(value, 'SourcingProductsAttachment');
  const raw = object.products;
  if (!Array.isArray(raw)) {
    throw new ContractDecodeError(
      'SourcingProductsAttachment.products',
      'must be an array (the full result set, incl. declines)',
      raw
    );
  }
  return raw.map((p, i) =>
    decodeProduct(p, `SourcingProductsAttachment.products[${i}]`)
  );
}
