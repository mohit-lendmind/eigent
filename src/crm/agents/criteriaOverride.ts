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

// M5 (FR-013) — the G6 criteria override. An adviser may overrule an indicative
// verdict, but the act is NEVER silent: it is a human decision (actor:adviser),
// it raises a tier-2 G6 gate, and it folds a criteria-override entry that carries
// the ORIGINAL verdict, the adviser id, the forced one-line rationale, and the
// standing compliance flag. A stale-rule override records the staleness so the
// audit trail shows the adviser knew the cited rule was past its ttl.
//
// The override does not change the engine's output — the engine stays honest and
// deterministic. The override is an adviser-authored annotation the fold projects
// as a note, so a future reader sees both the machine verdict and the human call.

import type { GateId, VersionStamp } from '../agentContracts';
import type { CaseLogEvent } from '../agentContracts/caseLog';
import type { Verdict } from '../agentContracts/criteriaAffordability';
import { gateById } from '../agentContracts/gates';
import type { MirroredGate } from '../fold/eventLogStore';
import { getCrmEventLogStore } from '../fold/eventLogStore';
import { appendCaseLog } from './caseLogWrite';
import { ensureCaseProject } from './caseProject';
import { encodeJsonAttachment } from './codec';
import { getAgentEdge } from './edge';

const OVERRIDE_AGENT = 'lm-criteria';
const OVERRIDE_VERSIONS: VersionStamp = {
  model: 'lm-criteria',
  promptSha: 'lm-criteria',
  skillSemver: '1.0.0',
  skillSha: 'lm-criteria-m5',
};
const DESKTOP_RUN_ID = 'desktop:lm-criteria';
const G6: GateId = 'G6';

/** The audited override record the criteria-override entry folds (FR-013). */
export interface CriteriaOverrideRecord {
  kind: 'lm.criteria.override/1';
  caseId: string;
  lenderId: string;
  /** The machine verdict the adviser is overruling — never dropped. */
  originalVerdict: Verdict;
  /** The verdict the adviser is asserting instead. */
  overrideVerdict: Verdict;
  /** The human who made the call (G6 is a human decision, never an agent's). */
  adviserId: string;
  /** The forced one-line rationale — the write refuses an empty one. */
  rationale: string;
  /** The override always stands a compliance flag; this is never false. */
  raisesComplianceFlag: true;
  /** True when the cited rule was past its ttl at override time. */
  stale?: boolean;
  ruleKey?: string;
}

export interface RecordCriteriaOverrideInput {
  caseId: string;
  firmId: string;
  adviserId: string;
  lenderId: string;
  originalVerdict: Verdict;
  overrideVerdict: Verdict;
  rationale: string;
  stale?: boolean;
  ruleKey?: string;
  now?: number;
}

export type RecordCriteriaOverrideResult =
  | {
      ok: true;
      record: CriteriaOverrideRecord;
      gate: MirroredGate;
      overrideArtifactId: string;
      headSeq: string;
    }
  | { ok: false; reason: 'rationale-required' };

function overrideGate(
  caseId: string,
  projectId: string,
  lenderId: string,
  now: number
): MirroredGate {
  return {
    id: `G6_${caseId}_${lenderId}`,
    gateId: G6,
    caseId,
    projectId,
    approvalId: `appr-G6-${caseId}-${lenderId}`,
    title: gateById(G6).name,
    reasons: [
      'Adviser is overruling an indicative criteria verdict — MCOB requires the override be recorded and standable.',
      `Override on ${lenderId} raises a compliance flag for supervisory review.`,
    ],
    raisedAt: now,
    status: 'open',
  };
}

/**
 * Record a G6 criteria override (FR-013). The forced rationale is a hard
 * precondition — an empty one is refused before any write. On success the write
 * folds the ORIGINAL verdict + adviser id + rationale + the standing compliance
 * flag, and raises a tier-2 G6 gate the supervisor resolves.
 */
export async function recordCriteriaOverride(
  input: RecordCriteriaOverrideInput
): Promise<RecordCriteriaOverrideResult> {
  if (input.rationale.trim().length === 0) {
    return { ok: false, reason: 'rationale-required' };
  }

  const now = input.now ?? Date.now();
  const edge = await getAgentEdge();
  const projectId = await ensureCaseProject(input.caseId);

  const record: CriteriaOverrideRecord = {
    kind: 'lm.criteria.override/1',
    caseId: input.caseId,
    lenderId: input.lenderId,
    originalVerdict: input.originalVerdict,
    overrideVerdict: input.overrideVerdict,
    adviserId: input.adviserId,
    rationale: input.rationale.trim(),
    raisesComplianceFlag: true,
    ...(input.stale ? { stale: true } : {}),
    ...(input.ruleKey ? { ruleKey: input.ruleKey } : {}),
  };

  const overrideArtifact = await edge.uploadAttachment(projectId, {
    name: `lm/criteria/${input.caseId}/override-${input.lenderId}.json`,
    media_type: 'application/json',
    data_base64: encodeJsonAttachment(record),
  });

  const gate = overrideGate(input.caseId, projectId, input.lenderId, now);

  const events: CaseLogEvent[] = [
    { type: 'criteria-override', payload: { override: record } },
    { type: 'gate-raise', payload: { gate } },
  ];

  const write = await appendCaseLog(edge, projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    // A criteria override is a HUMAN decision — the actor is the adviser, never
    // the agent. The fold reads this to stamp the note adviser-authored.
    actor: { kind: 'adviser', id: input.adviserId },
    events,
    versions: OVERRIDE_VERSIONS,
    originArtifactId: overrideArtifact.artifact_id,
    runId: DESKTOP_RUN_ID,
    at: now,
  });

  getCrmEventLogStore().getState().mirrorOpenGate(gate);

  return {
    ok: true,
    record,
    gate,
    overrideArtifactId: overrideArtifact.artifact_id,
    headSeq: write.headSeq,
  };
}

// A named handle so a no-op reference to the agent id is available to callers.
export const CRITERIA_OVERRIDE_AGENT = OVERRIDE_AGENT;
