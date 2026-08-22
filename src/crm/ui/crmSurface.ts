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

// FR-007/008/010/015 — the controller that makes Journeys 1 & 2 executable in
// the running app (finding 3). The screens (TodayQueue, GateCard) stay thin and
// declarative; this module owns the imperative agent calls behind them: a
// one-shot surface bootstrap (deploy skills + install the watcher schedule),
// starting an onboarding draft, and resolving a G1 gate (approve or deny). Every
// agent call needs the aion backend; outside aion mode getAgentEdge throws, so
// each entry point reports a typed failure the surface can render rather than
// crashing the shell.

import { decodeFirmConfig, gateById } from '../agentContracts';
import type { GateDescriptor } from '../agentContracts/gates';
import {
  approveOnboardingSend,
  beginOnboarding,
  denyOnboardingSend,
  gateInstanceId,
  worklistItemIdFor,
  type OnboardingCaseType,
  type OnboardingResult,
} from '../agents/onboarding';
import { deployLmSkills } from '../agents/skillDeploy';
import {
  acknowledgeWatcherProposal,
  ensureWatcherSchedule,
} from '../agents/watcher';
import { newCrmId } from '../domain/ids';
import type { MirroredGate } from '../fold/eventLogStore';

// The M2 desktop surface has no firm-selection UI yet, so the preview drives a
// single, stable firm identity. Its config is defaults + the disclosure refs a
// G1 onboarding draft must cite, decoded through the real contract decoder so it
// is a genuine FirmConfig, not a hand-rolled shape.
export const CRM_PREVIEW_FIRM_ID = 'firm-preview';

export function previewFirmConfig() {
  return decodeFirmConfig({
    firmId: CRM_PREVIEW_FIRM_ID,
    disclosureTextRefs: ['IDD-2026', 'ESIS-terms', 'fee-agreement-v3'],
  });
}

export type CrmSurfaceOutcome<T> =
  { ok: true; value: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * One-shot surface bootstrap: install the bundled skills to the edge (FR-005)
 * and ensure the firm's every-5-minutes watcher schedule exists (FR-010). Both
 * are idempotent, so re-running on every mount is safe. Best-effort: a desktop
 * in local mode reports the failure rather than throwing into the render.
 */
export async function bootstrapCrmSurface(
  firmId: string = CRM_PREVIEW_FIRM_ID
): Promise<CrmSurfaceOutcome<{ scheduleId: string }>> {
  try {
    await deployLmSkills();
    const scheduleId = await ensureWatcherSchedule(firmId);
    return { ok: true, value: { scheduleId } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Journey 1 entry: draft an onboarding pack for a fresh case and raise G1. The
 * case pointer is published inside beginOnboarding, so the case is immediately
 * visible to the watcher pass and the Today queue.
 */
export async function startOnboardingCase(
  caseType: OnboardingCaseType,
  clientNames?: readonly string[],
  firmId: string = CRM_PREVIEW_FIRM_ID
): Promise<CrmSurfaceOutcome<OnboardingResult>> {
  try {
    const value = await beginOnboarding({
      caseId: newCrmId('case'),
      firmId,
      caseType,
      clientNames,
      firmConfig: previewFirmConfig(),
      issuedBy: { kind: 'adviser', id: 'adviser:me' },
    });
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Journey 1 approval: record the adviser's G1 approval for a mirrored gate,
 * threading the edited draft (if any) into the chain entry. STRICTLY G1: the
 * approve path is a regulated SEND, and M2 is propose-only for every other gate.
 * A G7 watcher proposal that reached here would otherwise be written to the
 * chain as a false "onboarding pack sent" under G1's hardcoded ids (finding 1),
 * so a non-G1 mirror is refused rather than mis-routed. G7 uses acknowledgeGate.
 */
export async function approveGate(
  mirror: MirroredGate,
  adviserId: string,
  editedDraft?: string,
  firmId: string = CRM_PREVIEW_FIRM_ID
): Promise<CrmSurfaceOutcome<{ decision: 'allow' }>> {
  if (mirror.gateId !== 'G1') {
    return {
      ok: false,
      error: `approveGate is only valid for a G1 onboarding send; refused ${mirror.gateId}. M2 is propose-only for other gates.`,
    };
  }
  try {
    const result = await approveOnboardingSend({
      caseId: mirror.caseId,
      firmId,
      projectId: mirror.projectId,
      worklistItemId: worklistItemIdFor(mirror.caseId),
      gateInstanceId: gateInstanceId(mirror.caseId),
      adviserId,
      editedDraft,
    });
    return { ok: true, value: { decision: result.decision } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Journey 1 rejection: refuse a G1 send, closing the mirrored gate as denied.
 * STRICTLY G1, mirroring approveGate: denyOnboardingSend writes a G1-keyed
 * gate-resolve and worklist-resolve under hardcoded onboarding ids, so a G7
 * watcher mirror routed here would resolve the WRONG gate. G7 uses acknowledgeGate.
 */
export async function rejectGate(
  mirror: MirroredGate,
  adviserId: string,
  reason?: string,
  firmId: string = CRM_PREVIEW_FIRM_ID
): Promise<CrmSurfaceOutcome<{ decision: 'deny' }>> {
  if (mirror.gateId !== 'G1') {
    return {
      ok: false,
      error: `rejectGate is only valid for a G1 onboarding send; refused ${mirror.gateId}. M2 is propose-only for other gates.`,
    };
  }
  try {
    const result = await denyOnboardingSend({
      caseId: mirror.caseId,
      firmId,
      projectId: mirror.projectId,
      worklistItemId: worklistItemIdFor(mirror.caseId),
      gateInstanceId: gateInstanceId(mirror.caseId),
      adviserId,
      reason,
    });
    return { ok: true, value: { decision: result.decision } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Journey 2 acknowledgement: the ONLY resolution path for a G7 watcher proposal.
 * M2 is propose-only, so a G7 card has no send/deny — the adviser simply
 * acknowledges the nudge. This resolves the proposal by its OWN worklist item and
 * closes the mirror by its OWN gate-instance id, writing a G7-keyed gate-resolve
 * onto the chain (never a G1 "onboarding pack sent" activity — finding 1). A
 * non-G7 mirror, or a G7 mirror missing the watcher's worklist id, is refused.
 */
export async function acknowledgeGate(
  mirror: MirroredGate,
  adviserId: string,
  note?: string,
  firmId: string = CRM_PREVIEW_FIRM_ID
): Promise<CrmSurfaceOutcome<{ decision: 'acknowledged' }>> {
  if (mirror.gateId !== 'G7') {
    return {
      ok: false,
      error: `acknowledgeGate is only valid for a G7 watcher proposal; refused ${mirror.gateId}.`,
    };
  }
  if (mirror.worklistItemId === undefined) {
    return {
      ok: false,
      error: `G7 mirror ${mirror.id} carries no worklistItemId; cannot resolve the proposal's own worklist item.`,
    };
  }
  try {
    const result = await acknowledgeWatcherProposal({
      caseId: mirror.caseId,
      firmId,
      projectId: mirror.projectId,
      worklistItemId: mirror.worklistItemId,
      gateInstanceId: mirror.id,
      adviserId,
      note,
    });
    return { ok: true, value: { decision: result.decision } };
  } catch (error) {
    return failure(error);
  }
}

/** The GateDescriptor a mirrored gate renders from (frozen registry lookup). */
export function descriptorForMirror(mirror: MirroredGate): GateDescriptor {
  return gateById(mirror.gateId);
}
