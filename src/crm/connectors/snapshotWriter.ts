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

// M4 (FR-004/006/007/010) — the sourcing snapshot writer. It folds a run into a
// SMALL case-log summary (counts + top true-cost) and rides the FULL result set
// (incl. declines) as a REFERENCED attachment, never inline — an inline set
// would blow the fold's oversize ceiling and be dropped. `verified` is DERIVED
// here from the run's VerificationRef (deriveVerified), the surfaceClass is
// stamped adviser-only, and the acting adviser id is stamped on both the payload
// and the case-log actor (FR-010). Runs are serialized per desktop: the browser
// is a singleton window, so two sourcing runs must not interleave.

import {
  SOURCING_SERIALIZED_PER_DESKTOP,
  SOURCING_SURFACE_CLASS,
  type CaseLogEvent,
  type Coverage,
  type Product,
  type SourcingSnapshotPayload,
  type VerificationRef,
  type VersionStamp,
} from '../agentContracts';
import { appendCaseLog } from '../agents/caseLogWrite';
import { ensureCaseProject } from '../agents/caseProject';
import { encodeJsonAttachment } from '../agents/codec';
import { getAgentEdge } from '../agents/edge';
import type { ActivityEvent } from '../domain/types';
import { CRM_SCHEMA_VERSION } from '../domain/types';
import { deriveVerified } from './assertClaimable';

export { SOURCING_SERIALIZED_PER_DESKTOP } from '../agentContracts';

const SOURCING_VERSIONS: VersionStamp = {
  model: 'lm-sourcing',
  promptSha: 'lm-sourcing',
  skillSemver: '1.0.0',
  skillSha: 'lm-sourcing-m4',
};

const DESKTOP_RUN_ID = 'desktop:lm-sourcing';

// The single-window guarantee (SOURCING_SERIALIZED_PER_DESKTOP): a promise chain
// every run awaits, so runs execute one at a time in this desktop process.
let sourcingChain: Promise<unknown> = Promise.resolve();

/**
 * Run `task` under the per-desktop sourcing lock so no two sourcing runs drive
 * the singleton browser window at once (FR-010). Failures do not break the chain
 * for the next caller.
 */
export function withSourcingLock<T>(task: () => Promise<T>): Promise<T> {
  const run = sourcingChain.then(task, task);
  sourcingChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function snapshotAttachmentName(caseId: string): string {
  return `lm/sourcing/${caseId}/snapshot.json`;
}

function productsAttachmentName(caseId: string): string {
  return `lm/sourcing/${caseId}/products.json`;
}

/** Fold the full set into the small summary the case-log entry carries. */
export function summarizeProducts(
  products: readonly Product[]
): SourcingSnapshotPayload['summary'] {
  let eligible = 0;
  let declined = 0;
  let topTrueCostPence = 0;
  let seenEligible = false;
  for (const product of products) {
    if (product.status === 'eligible') {
      eligible += 1;
      if (!seenEligible || product.trueCostPence < topTrueCostPence) {
        topTrueCostPence = product.trueCostPence;
        seenEligible = true;
      }
    } else {
      declined += 1;
    }
  }
  return { total: products.length, eligible, declined, topTrueCostPence };
}

export interface WriteSourcingSnapshotInput {
  caseId: string;
  firmId: string;
  /** Stamped on the payload AND the case-log actor — every automated action is
   * attributable to the adviser it ran as (FR-010). */
  adviserId: string;
  adapterId: string;
  coverage: Coverage;
  ratesAsAt: string;
  /** The FULL result set, including declines. Rides as an attachment. */
  products: readonly Product[];
  /** The run's evidence. Present + complete → verified derives true. */
  verification?: VerificationRef;
  now?: number;
}

export interface WriteSourcingSnapshotResult {
  snapshot: SourcingSnapshotPayload;
  snapshotArtifactId: string;
  productsArtifactId: string;
  headSeq: string;
}

/**
 * Write a sourcing snapshot for a case: upload the full result set as an
 * attachment, derive `verified`, stamp the adviser + adviser-only surface, and
 * append a folded-summary activity to the case log. Serialized per desktop.
 */
export function writeSourcingSnapshot(
  input: WriteSourcingSnapshotInput
): Promise<WriteSourcingSnapshotResult> {
  // The serialized-per-desktop guarantee is asserted, not just documented.
  void (SOURCING_SERIALIZED_PER_DESKTOP satisfies true);
  return withSourcingLock(() => writeSourcingSnapshotLocked(input));
}

async function writeSourcingSnapshotLocked(
  input: WriteSourcingSnapshotInput
): Promise<WriteSourcingSnapshotResult> {
  const now = input.now ?? Date.now();
  const edge = await getAgentEdge();
  const projectId = await ensureCaseProject(input.caseId);

  const summary = summarizeProducts(input.products);
  const verified = deriveVerified(input.verification);

  const productsArtifact = await edge.uploadAttachment(projectId, {
    name: productsAttachmentName(input.caseId),
    media_type: 'application/json',
    data_base64: encodeJsonAttachment({
      kind: 'lm.sourcing.products/1',
      caseId: input.caseId,
      products: input.products,
    }),
  });

  const snapshot: SourcingSnapshotPayload = {
    adapterId: input.adapterId,
    coverage: input.coverage,
    ratesAsAt: input.ratesAsAt,
    adviserId: input.adviserId,
    verified,
    surfaceClass: SOURCING_SURFACE_CLASS,
    productsAttachmentId: productsArtifact.artifact_id,
    summary,
  };
  if (input.verification) snapshot.verification = input.verification;

  const snapshotArtifact = await edge.uploadAttachment(projectId, {
    name: snapshotAttachmentName(input.caseId),
    media_type: 'application/json',
    data_base64: encodeJsonAttachment({
      kind: 'lm.sourcing.snapshot/1',
      caseId: input.caseId,
      snapshot,
    }),
  });

  const activity: ActivityEvent = {
    id: `act_sourcing_${input.caseId}`,
    caseId: input.caseId,
    kind: 'ai-did',
    title: verified
      ? 'Sourcing run complete'
      : 'Sourcing run complete (scaffold)',
    detail:
      `Sourced ${input.adapterId} — ${summary.eligible} eligible of ` +
      `${summary.total} (${summary.declined} declined). ${input.coverage.statement}.` +
      (verified
        ? ''
        : ' Unverified scaffold — not claimable for evidence of research.'),
    when: now,
    actor: input.adviserId,
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  const events: CaseLogEvent[] = [
    {
      type: 'activity',
      payload: {
        activity,
        // The folded snapshot rides inline (small: counts + pointer, no
        // products) under a namespaced key, so a refold reconstructs the
        // results-tab summary without fetching the attachment.
        sourcingSnapshot: snapshot,
        sourcingSnapshotArtifactId: snapshotArtifact.artifact_id,
      },
    },
  ];

  const write = await appendCaseLog(edge, projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    // The actor IS the adviser the automated run acted as (FR-010).
    actor: { kind: 'agent', id: input.adviserId },
    events,
    versions: SOURCING_VERSIONS,
    originArtifactId: snapshotArtifact.artifact_id,
    runId: DESKTOP_RUN_ID,
    at: now,
  });

  return {
    snapshot,
    snapshotArtifactId: snapshotArtifact.artifact_id,
    productsArtifactId: productsArtifact.artifact_id,
    headSeq: write.headSeq,
  };
}
