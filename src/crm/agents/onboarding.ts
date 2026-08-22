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

// FR-007/009, Journey 1 — the onboarding agent's desktop path. It builds the
// document checklist for the case type, drafts a welcome + document-request that
// carries the firm's disclosure references (never a product, rate, or
// affordability claim — those are other gates), publishes an
// `lm.onboarding.request/1` artifact, and writes the work to the case log. The
// outbound SEND is never automatic: it is held behind G1, mirrored into the
// fold so the Today queue renders it. Approval logs the manual send and closes
// the gate. The paired server-side behaviour is described in the lm-onboarding
// SKILL; this module is the deterministic desktop half a test can drive.

import {
  gateById,
  type CaseLogEvent,
  type FirmConfig,
  type VersionStamp,
} from '../agentContracts';
import type {
  ActivityEvent,
  DocChecklistItem,
  StreamEntry,
  WorklistItem,
} from '../domain/types';
import { CRM_SCHEMA_VERSION } from '../domain/types';
import { getCrmEventLogStore, type MirroredGate } from '../fold/eventLogStore';
import { appendCaseLog } from './caseLogWrite';
import { ensureCaseProject } from './caseProject';
import { encodeJsonAttachment } from './codec';
import { getAgentEdge } from './edge';
import { publishCasePointer } from './firmIndex';

// A desktop-issued append has no server run to point back to. The origin.runId
// field is required (non-empty by contract), so a stable sentinel names the
// desktop origin rather than leaving an empty string that reads as "lost run"
// (finding 17).
const DESKTOP_RUN_ID = 'desktop:lm-onboarding';

export type OnboardingCaseType =
  'purchase' | 'remortgage' | 'product-transfer' | 'buy-to-let' | (string & {});

export interface OnboardingChecklistItem {
  itemKey: string;
  label: string;
}

export interface OnboardingDraft {
  welcome: string;
  docRequest: string;
  disclosureRefs: readonly string[];
  /** The full body the G1 card shows and the adviser can edit before sending. */
  full: string;
}

export interface OnboardingInput {
  caseId: string;
  firmId: string;
  caseType: OnboardingCaseType;
  clientNames?: readonly string[];
  firmConfig: FirmConfig;
  issuedBy: { kind: 'adviser'; id: string };
  traceId?: string;
  now?: number;
}

export interface OnboardingResult {
  checklist: OnboardingChecklistItem[];
  draft: OnboardingDraft;
  requestArtifactId: string;
  gate: MirroredGate;
  worklistItemId: string;
  headSeq: string;
}

const ONBOARDING_VERSIONS: VersionStamp = {
  model: 'lm-onboarding',
  promptSha: 'lm-onboarding',
  skillSemver: '1.0.0',
  skillSha: 'lm-onboarding-m2',
};

// Documents every regulated mortgage case needs, then the type-specific ones.
// Deliberately data, not prose, so the checklist is stable and testable.
const COMMON_DOCUMENTS: OnboardingChecklistItem[] = [
  { itemKey: 'photo-id', label: 'Photo ID (passport or driving licence)' },
  { itemKey: 'proof-of-address', label: 'Proof of address (last 3 months)' },
  {
    itemKey: 'bank-statements-3m',
    label: 'Bank statements (last 3 months)',
  },
];

const DOCUMENTS_BY_TYPE: Record<string, OnboardingChecklistItem[]> = {
  purchase: [
    { itemKey: 'memorandum-of-sale', label: 'Memorandum of sale' },
    { itemKey: 'deposit-evidence', label: 'Evidence of deposit funds' },
  ],
  remortgage: [
    {
      itemKey: 'current-mortgage-statement',
      label: 'Current mortgage statement',
    },
  ],
  'product-transfer': [
    {
      itemKey: 'current-mortgage-statement',
      label: 'Current mortgage statement',
    },
  ],
  'buy-to-let': [
    { itemKey: 'tenancy-agreement', label: 'Tenancy agreement' },
    {
      itemKey: 'rental-income-evidence',
      label: 'Evidence of rental income',
    },
  ],
};

/** The documents to request for a case type (common set + type-specific). */
export function buildOnboardingChecklist(
  caseType: OnboardingCaseType
): OnboardingChecklistItem[] {
  const specific = DOCUMENTS_BY_TYPE[caseType] ?? [];
  return [...COMMON_DOCUMENTS, ...specific];
}

/**
 * The welcome + document-request draft. It states which documents are needed
 * and cites the firm's disclosure references, but makes no product, rate, or
 * affordability claim — those live behind their own gates.
 */
export function buildOnboardingDraft(
  input: OnboardingInput,
  checklist: readonly OnboardingChecklistItem[]
): OnboardingDraft {
  const disclosureRefs = input.firmConfig.disclosureTextRefs ?? [];
  const greeting = input.clientNames?.length
    ? `Dear ${input.clientNames.join(' and ')},`
    : 'Hello,';

  const welcome = [
    greeting,
    '',
    'Thank you for choosing us to help with your mortgage. This note confirms ' +
      'we have opened your case and sets out what we need to get started.',
  ].join('\n');

  const docLines = checklist.map((item) => `  - ${item.label}`).join('\n');
  const docRequest = [
    'To begin, please send us the following documents:',
    docLines,
  ].join('\n');

  const disclosureLine =
    disclosureRefs.length > 0
      ? `The following regulatory disclosures apply to our service: ${disclosureRefs.join(
          ', '
        )}.`
      : 'Our regulatory disclosures apply to our service as set out in our firm terms.';

  const full = [welcome, '', docRequest, '', disclosureLine].join('\n');
  return { welcome, docRequest, disclosureRefs, full };
}

function onboardingRequestName(caseId: string): string {
  return `lm/onboarding/${caseId}/request.json`;
}

/** The deterministic G1 gate-mirror instance id for a case (id on MirroredGate). */
export function gateInstanceId(caseId: string): string {
  return `G1_${caseId}`;
}

function approvalIdFor(caseId: string): string {
  return `appr_G1_${caseId}`;
}

/** The deterministic G1 approval worklist item id for a case. */
export function worklistItemIdFor(caseId: string): string {
  return `wl_G1_${caseId}`;
}

/**
 * Draft the onboarding pack for a case, publish the request artifact, write the
 * case-log entries, and raise the G1 gate (mirrored into the fold). The send
 * itself waits for `approveOnboardingSend`. Resolves once the gate is raised.
 */
export async function beginOnboarding(
  input: OnboardingInput
): Promise<OnboardingResult> {
  const now = input.now ?? Date.now();
  const traceId = input.traceId ?? `onboarding_${input.caseId}`;
  const edge = await getAgentEdge();
  const projectId = await ensureCaseProject(input.caseId);

  const checklist = buildOnboardingChecklist(input.caseType);
  const draft = buildOnboardingDraft(input, checklist);

  const requestArtifact = await edge.uploadAttachment(projectId, {
    name: onboardingRequestName(input.caseId),
    media_type: 'application/json',
    data_base64: encodeJsonAttachment({
      kind: 'lm.onboarding.request/1',
      caseId: input.caseId,
      firmId: input.firmId,
      traceId,
      caseType: input.caseType,
      checklist,
      welcome: draft.welcome,
      docRequest: draft.docRequest,
      disclosureRefs: draft.disclosureRefs,
      at: now,
      versions: ONBOARDING_VERSIONS,
    }),
  });

  const worklistItemId = worklistItemIdFor(input.caseId);
  const worklistItem: WorklistItem = {
    id: worklistItemId,
    caseId: input.caseId,
    kind: 'approval',
    title: gateById('G1').name,
    detail: 'Review and approve the onboarding welcome + document request.',
    status: 'open',
    createdAt: now,
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  const draftedActivity: ActivityEvent = {
    id: `act_onboarding_drafted_${input.caseId}`,
    caseId: input.caseId,
    kind: 'ai-did',
    title: 'Onboarding pack drafted',
    detail: `Built a ${checklist.length}-document checklist and drafted the welcome + document request for G1 review.`,
    when: now,
    actor: 'lm-onboarding',
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  // Each requested document is logged as a checklist-status event so the fold
  // rebuilds the case's document checklist from the chain — not from a
  // side-write the fold would lose on a refold (finding 6).
  const checklistItems: DocChecklistItem[] = checklist.map((item) => ({
    owner: 'joint',
    itemKey: item.itemKey,
    label: item.label,
    status: 'requested',
    updatedAt: now,
  }));

  // A stream entry gives the case timeline the "pack drafted, awaiting G1" beat
  // the adviser sees, reconstructible from the chain like everything else.
  const streamEntry: StreamEntry = {
    id: `stream_onboarding_${input.caseId}`,
    caseId: input.caseId,
    kind: 'approval',
    iconTone: 'status-pending',
    when: now,
    title: 'Onboarding pack awaiting approval',
    body: `Welcome + document request drafted, requesting ${checklist.length} documents. Held behind G1 until you approve the send.`,
    linkedWorklistId: worklistItemId,
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  const gate: MirroredGate = {
    id: gateInstanceId(input.caseId),
    gateId: 'G1',
    caseId: input.caseId,
    projectId,
    approvalId: approvalIdFor(input.caseId),
    title: gateById('G1').name,
    draftFull: draft.full,
    disclosureRef: draft.disclosureRefs[0],
    reasons: [
      'Regulated onboarding communication — MCOB 4.4A requires adviser sign-off before send.',
      `Requests ${checklist.length} documents to open the case.`,
    ],
    raisedAt: now,
    status: 'open',
  };

  const events: CaseLogEvent[] = [
    { type: 'activity', payload: { activity: draftedActivity } },
    ...checklistItems.map((item): CaseLogEvent => ({
      type: 'checklist-status',
      payload: { item },
    })),
    { type: 'stream-entry', payload: { entry: streamEntry } },
    { type: 'worklist-upsert', payload: { item: worklistItem } },
    // gate-raise carries the EXACT mirrored gate so a wipe-then-refold
    // reconstructs the Today-queue row byte-for-byte (finding 10).
    { type: 'gate-raise', payload: { gate } },
  ];

  const write = await appendCaseLog(edge, projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    actor: { kind: 'agent', id: 'lm-onboarding' },
    events,
    versions: ONBOARDING_VERSIONS,
    originArtifactId: requestArtifact.artifact_id,
    runId: DESKTOP_RUN_ID,
    at: now,
  });

  getCrmEventLogStore().getState().mirrorOpenGate(gate);

  // Republish the case pointer so the watcher pass and the firm's Today queue
  // see the new log head immediately — a stale pointer hides the case from
  // every scan until the next unrelated write (finding 11).
  await publishCasePointer({
    caseId: input.caseId,
    firmId: input.firmId,
    aionProjectId: projectId,
    stage: 'FACT_FIND',
    logHeadSeq: write.headSeq,
    updatedAt: now,
  });

  return {
    checklist,
    draft,
    requestArtifactId: requestArtifact.artifact_id,
    gate,
    worklistItemId,
    headSeq: write.headSeq,
  };
}

export interface ApproveOnboardingInput {
  caseId: string;
  firmId: string;
  projectId: string;
  worklistItemId: string;
  gateInstanceId: string;
  adviserId: string;
  editedDraft?: string;
  now?: number;
}

export interface ApproveOnboardingResult {
  headSeq: string;
  decision: 'allow';
}

/**
 * Record the adviser's G1 approval: log the manual send on the case chain,
 * resolve the approval worklist item, and close the mirrored gate. The message
 * is sent by the adviser (a manual send); this records that it happened.
 */
export async function approveOnboardingSend(
  input: ApproveOnboardingInput
): Promise<ApproveOnboardingResult> {
  const now = input.now ?? Date.now();
  const edge = await getAgentEdge();

  // The draft the adviser is approving. If they changed it before approving,
  // the SENT body is theirs and the gate is marked edited — that flag feeds the
  // "% drafts approved unedited" leading metric (findings 5/21).
  const originalDraft =
    getCrmEventLogStore().getState().openGates[input.gateInstanceId]?.draftFull;
  const edited =
    input.editedDraft !== undefined && input.editedDraft !== originalDraft;
  const sentBody = input.editedDraft ?? originalDraft ?? '';

  const sentActivity: ActivityEvent = {
    id: `act_onboarding_sent_${input.caseId}`,
    caseId: input.caseId,
    kind: 'note',
    title: 'Onboarding pack sent',
    detail: edited
      ? `Adviser edited then approved G1 and sent the welcome + document request.\n\n${sentBody}`
      : `Adviser approved G1 and sent the welcome + document request.\n\n${sentBody}`,
    when: now,
    actor: input.adviserId,
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  const events: CaseLogEvent[] = [
    { type: 'activity', payload: { activity: sentActivity } },
    {
      type: 'worklist-resolve',
      payload: {
        id: input.worklistItemId,
        resolvedBy: input.adviserId,
        resolution: { method: 'reviewed', detail: 'G1 approved; sent.' },
      },
    },
    // gate-resolve closes the mirrored gate on refold with the same decision and
    // edited flag the live path recorded (findings 5/10/21).
    {
      type: 'gate-resolve',
      payload: { id: input.gateInstanceId, decision: 'allow', edited },
    },
  ];

  const write = await appendCaseLog(edge, input.projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    actor: { kind: 'adviser', id: input.adviserId },
    events,
    versions: ONBOARDING_VERSIONS,
    originArtifactId: `manual_send_${input.caseId}`,
    runId: DESKTOP_RUN_ID,
    at: now,
  });

  getCrmEventLogStore()
    .getState()
    .resolveMirroredGate(input.gateInstanceId, 'allow', now, { edited });

  // Refresh the pointer so the log head the watcher reads reflects the approval.
  await publishCasePointer({
    caseId: input.caseId,
    firmId: input.firmId,
    aionProjectId: input.projectId,
    stage: 'FACT_FIND',
    logHeadSeq: write.headSeq,
    updatedAt: now,
  });

  return { headSeq: write.headSeq, decision: 'allow' };
}

export interface DenyOnboardingInput {
  caseId: string;
  firmId: string;
  projectId: string;
  worklistItemId: string;
  gateInstanceId: string;
  adviserId: string;
  reason?: string;
  now?: number;
}

export interface DenyOnboardingResult {
  headSeq: string;
  decision: 'deny';
}

/**
 * Record the adviser's G1 rejection: nothing is sent, the approval worklist item
 * is resolved as rejected, and the mirrored gate closes with a `deny` decision.
 * An adviser must be able to refuse a regulated send, not only approve it
 * (finding 18); the deny travels the chain as a gate-resolve so a refold
 * reconstructs the closed gate identically (finding 10).
 */
export async function denyOnboardingSend(
  input: DenyOnboardingInput
): Promise<DenyOnboardingResult> {
  const now = input.now ?? Date.now();
  const edge = await getAgentEdge();

  const rejectedActivity: ActivityEvent = {
    id: `act_onboarding_rejected_${input.caseId}`,
    caseId: input.caseId,
    kind: 'note',
    title: 'Onboarding pack rejected',
    detail: input.reason
      ? `Adviser rejected the G1 onboarding send: ${input.reason}`
      : 'Adviser rejected the G1 onboarding send; nothing was sent.',
    when: now,
    actor: input.adviserId,
    schemaVersion: CRM_SCHEMA_VERSION,
  };

  const events: CaseLogEvent[] = [
    { type: 'activity', payload: { activity: rejectedActivity } },
    {
      type: 'worklist-resolve',
      payload: {
        id: input.worklistItemId,
        resolvedBy: input.adviserId,
        resolution: {
          method: 'reviewed',
          detail: input.reason
            ? `G1 rejected: ${input.reason}`
            : 'G1 rejected; nothing sent.',
        },
      },
    },
    {
      type: 'gate-resolve',
      payload: { id: input.gateInstanceId, decision: 'deny' },
    },
  ];

  const write = await appendCaseLog(edge, input.projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    actor: { kind: 'adviser', id: input.adviserId },
    events,
    versions: ONBOARDING_VERSIONS,
    originArtifactId: `manual_reject_${input.caseId}`,
    runId: DESKTOP_RUN_ID,
    at: now,
  });

  getCrmEventLogStore()
    .getState()
    .resolveMirroredGate(input.gateInstanceId, 'deny', now);

  await publishCasePointer({
    caseId: input.caseId,
    firmId: input.firmId,
    aionProjectId: input.projectId,
    stage: 'FACT_FIND',
    logHeadSeq: write.headSeq,
    updatedAt: now,
  });

  return { headSeq: write.headSeq, decision: 'deny' };
}
