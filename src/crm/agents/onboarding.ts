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
import type { ActivityEvent, WorklistItem } from '../domain/types';
import { CRM_SCHEMA_VERSION } from '../domain/types';
import { getCrmEventLogStore, type MirroredGate } from '../fold/eventLogStore';
import { appendCaseLog } from './caseLogWrite';
import { ensureCaseProject } from './caseProject';
import { encodeJsonAttachment } from './codec';
import { getAgentEdge } from './edge';

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

function gateInstanceId(caseId: string): string {
  return `G1_${caseId}`;
}

function approvalIdFor(caseId: string): string {
  return `appr_G1_${caseId}`;
}

function worklistItemIdFor(caseId: string): string {
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

  const events: CaseLogEvent[] = [
    { type: 'activity', payload: { activity: draftedActivity } },
    { type: 'worklist-upsert', payload: { item: worklistItem } },
  ];

  const write = await appendCaseLog(edge, projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    actor: { kind: 'agent', id: 'lm-onboarding' },
    events,
    versions: ONBOARDING_VERSIONS,
    originArtifactId: requestArtifact.artifact_id,
    runId: '',
    at: now,
  });

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
  getCrmEventLogStore().getState().mirrorOpenGate(gate);

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

  const sentActivity: ActivityEvent = {
    id: `act_onboarding_sent_${input.caseId}`,
    caseId: input.caseId,
    kind: 'note',
    title: 'Onboarding pack sent',
    detail: 'Adviser approved G1 and sent the welcome + document request.',
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
  ];

  const write = await appendCaseLog(edge, input.projectId, {
    caseId: input.caseId,
    firmId: input.firmId,
    actor: { kind: 'adviser', id: input.adviserId },
    events,
    versions: ONBOARDING_VERSIONS,
    originArtifactId: `manual_send_${input.caseId}`,
    runId: '',
    at: now,
  });

  getCrmEventLogStore()
    .getState()
    .resolveMirroredGate(input.gateInstanceId, 'allow', now);

  return { headSeq: write.headSeq, decision: 'allow' };
}
