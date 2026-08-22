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

// FR-002/003/004/006/007 — the docintel WRITE PATH, as a PURE projection. It
// turns one lm.docintel.extraction/1 side-car into a list of case-log event
// kinds (field-change / document-upsert / checklist-status / conflict-upsert /
// worklist-upsert / stream-entry / activity / gate-raise). The extraction kind
// is NEVER itself an event kind — every projected entry instead carries
// origin.artifactId back to the side-car (FR-002).
//
// This module is the write-path red-team target (T007), so its guarantees are
// coded here, not trusted from the model:
//   - no false-det: `src` is RECOMPUTED from the independent text layer via
//     classifySrc; the artifact's own `src` is never believed.
//   - no attribution-leak: an ambiguous attribution writes NO applicant field;
//     it holds everything behind G2.
//   - no conflict-suppression: a material disagreement between two `det` values
//     raises G3 and does NOT overwrite the value on file (record-never-repair).
//   - no outbound: the projector can only emit the safe event kinds above —
//     there is no directive/comms/send path to reach.

import { gateById, type CaseLogEvent } from '../agentContracts';
import type { FactFindSectionKey } from '../domain/factFindSchema';
import { parseGbp, type Pence } from '../domain/money';
import {
  CRM_SCHEMA_VERSION,
  type ActivityEvent,
  type ClientId,
  type ConflictRecord,
  type ConflictValue,
  type CrmDocument,
  type DocChecklistItem,
  type DocInsight,
  type FieldValue,
  type Src,
  type StreamEntry,
  type WorklistItem,
} from '../domain/types';
import type { MirroredGate } from '../fold/eventLogStore';
import {
  classifySrc,
  derivedId,
  detectConflict,
  type DocintelExtraction,
  type DocInsight as ExtractionInsight,
} from './docintelContract';

// A joint document or an attribution below this confidence is ambiguous and
// must be confirmed by a human (G2) before any applicant field is written
// (FR-006).
export const ATTRIBUTION_CONFIDENCE_THRESHOLD = 0.85;

/** The value + trust of a fact already on file, for deterministic conflict. */
export interface ExistingFactValue {
  value: FieldValue;
  src: Src;
}

export interface ApplyExtractionContext {
  extraction: DocintelExtraction;
  caseId: string;
  firmId: string;
  projectId: string;
  /** Independent born-digital text layer, or null for a vision-only document. */
  sourceText: string | null;
  document: {
    name: string;
    size?: number;
    when?: number;
    iconTone?: string;
  };
  /** Existing fact values keyed `${clientId}::${section}::${fieldKey}`. */
  existing?: Readonly<Record<string, ExistingFactValue>>;
  /** The checklist item this document satisfies, if known (T015). */
  checklist?: { owner: ClientId | 'joint'; itemKey: string; label: string };
  /** The side-car artifact id every projected entry cites as its origin. */
  originArtifactId: string;
  runId: string;
  now: number;
}

export interface ExtractionProjection {
  events: CaseLogEvent[];
  /** Gates raised (also emitted as gate-raise events); mirror into the store. */
  gates: MirroredGate[];
  document: CrmDocument;
  detFields: number;
  synFields: number;
  conflicts: number;
  attributionGated: boolean;
  quarantined: boolean;
}

const MONEY_HINT =
  /income|salary|basic|overtime|bonus|dividend|profit|deposit|price|loan|rent|pay|amount/i;

// Convert an extraction's string value to a typed FieldValue. Money is detected
// deterministically: the value must parse as GBP AND the field/label/value must
// carry a monetary hint, so a bare number ("2") never becomes £2.00.
function toFieldValue(insight: ExtractionInsight): FieldValue {
  const pence = parseGbp(insight.value);
  const hintable = `${insight.fieldKey ?? ''} ${insight.label} ${insight.value}`;
  if (pence !== null && MONEY_HINT.test(hintable)) {
    return { t: 'money', v: pence };
  }
  return { t: 'text', v: insight.value };
}

function factKey(clientId: string, section: string, fieldKey: string): string {
  return `${clientId}::${section}::${fieldKey}`;
}

function toDomainInsight(
  insight: ExtractionInsight,
  src: Src,
  conflicted: boolean,
  documentId: string,
  contentHash: string,
  origin: { artifactId: string; runId: string }
): DocInsight {
  return {
    id: derivedId(
      'field',
      documentId,
      contentHash,
      insight.fieldKey ?? insight.label
    ),
    label: insight.label,
    value: insight.value,
    conf: insight.confidence,
    sourceQuote: insight.quote,
    locator: insight.locator,
    src,
    ...(conflicted ? { conflict: true as const } : {}),
    origin,
  };
}

/**
 * Project an extraction side-car into case-log events. Pure and clock-free
 * beyond the injected `now`, so a refold reproduces every entry byte-for-byte
 * (SC-004). Never mutates any store; the caller appends `events` and mirrors
 * `gates`.
 */
export function applyExtraction(
  ctx: ApplyExtractionContext
): ExtractionProjection {
  const { extraction, now } = ctx;
  const origin = { artifactId: ctx.originArtifactId, runId: ctx.runId };
  const documentId = extraction.documentId;
  const contentHash = extraction.contentHash;

  const events: CaseLogEvent[] = [];
  const gates: MirroredGate[] = [];
  const domainInsights: DocInsight[] = [];
  let detFields = 0;
  let synFields = 0;
  let conflicts = 0;

  const attribution = extraction.attribution;
  const attributionGated =
    attribution.joint ||
    attribution.clientId === null ||
    attribution.confidence < ATTRIBUTION_CONFIDENCE_THRESHOLD;
  const quarantined = !extraction.docTypeInScope;

  // The applicant we may write to — null whenever attribution is gated, so no
  // field can leak to the wrong person.
  const owner: ClientId | 'joint' =
    attribution.clientId && !attribution.joint ? attribution.clientId : 'joint';

  // Only write applicant fields when the doc is in scope AND attribution is
  // confident. Otherwise we still record the document + insights, but hold every
  // fact-find write behind the human gate.
  const mayWriteFields =
    !quarantined && !attributionGated && attribution.clientId !== null;
  const writeClientId = attribution.clientId ?? '';

  for (const insight of extraction.insights) {
    // The trust spine: recompute independently. A forged `det` in the artifact
    // cannot survive a text layer that does not contain the quote.
    const src = classifySrc(insight.quote, ctx.sourceText);
    if (src === 'det') detFields += 1;
    else synFields += 1;

    let conflicted = false;

    const mapped =
      mayWriteFields &&
      insight.fieldKey !== undefined &&
      insight.section !== undefined;

    if (mapped) {
      const section = insight.section as FactFindSectionKey;
      const fieldKey = insight.fieldKey as string;
      const value = toFieldValue(insight);
      const key = factKey(writeClientId, section, fieldKey);
      const existing = ctx.existing?.[key];

      // Two verified (det) MONEY values that disagree past 1% materiality are a
      // conflict: raise G3, keep the value on file, never silently overwrite.
      if (
        src === 'det' &&
        existing &&
        existing.src === 'det' &&
        existing.value.t === 'money' &&
        value.t === 'money'
      ) {
        const { conflict, deltaPct } = detectConflict(
          existing.value.v as number,
          value.v as number
        );
        if (conflict) {
          conflicted = true;
          conflicts += 1;
          pushConflict(
            events,
            gates,
            ctx,
            writeClientId,
            section,
            fieldKey,
            insight,
            existing.value,
            value,
            deltaPct
          );
        } else {
          pushFieldChange(
            events,
            writeClientId,
            section,
            fieldKey,
            insight,
            value,
            src,
            origin
          );
        }
      } else if (shouldWrite(existing, src)) {
        pushFieldChange(
          events,
          writeClientId,
          section,
          fieldKey,
          insight,
          value,
          src,
          origin
        );
      }
    }

    domainInsights.push(
      toDomainInsight(insight, src, conflicted, documentId, contentHash, origin)
    );
  }

  // The document record itself — always written, so the vault shows it even when
  // quarantined or attribution-gated.
  const document: CrmDocument = {
    id: documentId,
    owner,
    name: ctx.document.name,
    type: extraction.docType,
    status: quarantined ? 'REJECTED' : 'COMPLETED',
    size: ctx.document.size ?? 0,
    when: ctx.document.when ?? now,
    iconTone: ctx.document.iconTone ?? 'status-info',
    attribution: attribution.clientId === null ? null : attribution.confidence,
    ...(attribution.joint ? { joint: true as const } : {}),
    insights: domainInsights,
    schemaVersion: CRM_SCHEMA_VERSION,
    origin,
  };
  events.push({ type: 'document-upsert', payload: { document } });

  // Special-category data is FLAGGED, never silently folded into fields (FR-010).
  if (extraction.specialCategoryFlagged) {
    const activity: ActivityEvent = {
      id: `act_docintel_specialcat_${documentId}`,
      caseId: ctx.caseId,
      kind: 'system',
      title: 'Special-category data detected',
      detail:
        'This document appears to reveal Article 9 (special-category) data. It ' +
        'is flagged for review and was not folded into ordinary fields.',
      when: now,
      actor: 'lm-docintel',
      origin,
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    events.push({ type: 'activity', payload: { activity } });
  }

  // Out-of-scope: quarantine note, no extraction applied.
  if (quarantined) {
    const activity: ActivityEvent = {
      id: `act_docintel_quarantine_${documentId}`,
      caseId: ctx.caseId,
      kind: 'refusal',
      title: 'Document quarantined — out of scope',
      detail: `Type "${extraction.docType}" is outside the DPIA scope; no fields were extracted.`,
      when: now,
      actor: 'lm-docintel',
      origin,
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    events.push({ type: 'activity', payload: { activity } });
  }

  // Ambiguous attribution → hold behind G2 (FR-006).
  if (attributionGated && !quarantined) {
    pushAttributionGate(
      events,
      gates,
      ctx,
      attribution.confidence,
      attribution.joint
    );
  }

  // Checklist reconcile: an in-scope, attributed document satisfies its
  // checklist item (T015 / FR-005).
  if (!quarantined && ctx.checklist) {
    const item: DocChecklistItem = {
      owner: ctx.checklist.owner,
      itemKey: ctx.checklist.itemKey,
      label: ctx.checklist.label,
      status: attributionGated ? 'partial' : 'received',
      updatedAt: now,
    };
    events.push({ type: 'checklist-status', payload: { item } });
  }

  // The completion beat for the case timeline (stable id → idempotent refold).
  const completionStream: StreamEntry = {
    id: `stream_docintel_${documentId}`,
    caseId: ctx.caseId,
    kind: 'activity',
    iconTone: quarantined ? 'status-warning' : 'status-info',
    when: now,
    title: quarantined
      ? 'Document quarantined'
      : `Document processed: ${extraction.docType}`,
    body: quarantined
      ? 'Out-of-scope document; nothing extracted.'
      : `${detFields} verified and ${synFields} unverified fact(s); ${conflicts} conflict(s).`,
    origin,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  events.push({ type: 'stream-entry', payload: { entry: completionStream } });

  return {
    events,
    gates,
    document,
    detFields,
    synFields,
    conflicts,
    attributionGated,
    quarantined,
  };
}

// A syn value never clobbers a value already on file; a det value supersedes a
// syn one; an empty field takes whatever arrives.
function shouldWrite(
  existing: ExistingFactValue | undefined,
  incomingSrc: Src
): boolean {
  if (!existing) return true;
  if (incomingSrc === 'det') return true;
  return existing.src === 'syn';
}

function pushFieldChange(
  events: CaseLogEvent[],
  clientId: string,
  section: string,
  fieldKey: string,
  insight: ExtractionInsight,
  value: FieldValue,
  src: Src,
  origin: { artifactId: string; runId: string }
): void {
  events.push({
    type: 'field-change',
    payload: {
      clientId,
      section,
      fieldKey,
      label: insight.label,
      value,
      // Always explicit — the fold's historic `?? 'det'` default is never relied
      // on for a docintel-authored field (FR-004).
      src,
      origin,
    },
  });
}

function pushConflict(
  events: CaseLogEvent[],
  gates: MirroredGate[],
  ctx: ApplyExtractionContext,
  clientId: string,
  section: FactFindSectionKey,
  fieldKey: string,
  insight: ExtractionInsight,
  existingValue: FieldValue,
  incomingValue: FieldValue,
  deltaPct: number
): void {
  const { extraction, now } = ctx;
  const origin = { artifactId: ctx.originArtifactId, runId: ctx.runId };
  const conflictId = derivedId(
    'conflict',
    extraction.documentId,
    extraction.contentHash,
    fieldKey
  );
  const worklistItemId = derivedId(
    'wl',
    extraction.documentId,
    extraction.contentHash,
    fieldKey
  );

  const existingCv: ConflictValue = {
    value: existingValue,
    source: { kind: 'manual' },
  };
  const incomingCv: ConflictValue = {
    value: incomingValue,
    source: {
      kind: 'document',
      docId: extraction.documentId,
      insightLabel: insight.label,
      quote: insight.quote,
    },
    confidence: insight.confidence,
  };
  const record: ConflictRecord = {
    id: conflictId,
    caseId: ctx.caseId,
    clientId,
    section,
    fieldKey,
    values: [existingCv, incomingCv],
    detectedAt: now,
    detectedBy: 'lm-docintel',
    origin,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  events.push({ type: 'conflict-upsert', payload: { record } });

  const deltaLabel = `${(deltaPct * 100).toFixed(1)}%`;
  const worklistItem: WorklistItem = {
    id: worklistItemId,
    caseId: ctx.caseId,
    kind: 'conflict',
    title: gateById('G3').name,
    detail: `Document value disagrees with the value on file by ${deltaLabel} on ${section}.${fieldKey}. Choose the authoritative value.`,
    status: 'open',
    createdAt: now,
    auto: true,
    linkedConflictId: conflictId,
    linkedDocId: extraction.documentId,
    origin,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  events.push({ type: 'worklist-upsert', payload: { item: worklistItem } });

  const stream: StreamEntry = {
    id: `stream_conflict_${conflictId}`,
    caseId: ctx.caseId,
    kind: 'conflict',
    iconTone: 'status-warning',
    when: now,
    title: 'Cross-document conflict detected',
    body: `Two verified values for ${section}.${fieldKey} disagree by ${deltaLabel}.`,
    linkedWorklistId: worklistItemId,
    origin,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  events.push({ type: 'stream-entry', payload: { entry: stream } });

  const gate: MirroredGate = {
    id: `G3_${conflictId}`,
    gateId: 'G3',
    caseId: ctx.caseId,
    projectId: ctx.projectId,
    approvalId: `appr_G3_${conflictId}`,
    title: gateById('G3').name,
    worklistItemId,
    reasons: [
      `Two verified (det) values for ${section}.${fieldKey} disagree by ${deltaLabel}.`,
      'Suitability evidence integrity — a human must choose the authoritative value.',
    ],
    raisedAt: now,
    status: 'open',
  };
  gates.push(gate);
  events.push({ type: 'gate-raise', payload: { gate } });
}

function pushAttributionGate(
  events: CaseLogEvent[],
  gates: MirroredGate[],
  ctx: ApplyExtractionContext,
  confidence: number,
  joint: boolean
): void {
  const { extraction, now } = ctx;
  const origin = { artifactId: ctx.originArtifactId, runId: ctx.runId };
  const worklistItemId = derivedId(
    'wl',
    extraction.documentId,
    extraction.contentHash,
    '__attribution__'
  );
  const gateInstanceId = `G2_${extraction.documentId}`;

  const worklistItem: WorklistItem = {
    id: worklistItemId,
    caseId: ctx.caseId,
    kind: 'doc',
    title: gateById('G2').name,
    detail: joint
      ? 'This document looks joint — confirm which applicant(s) it belongs to before its facts are recorded.'
      : `Attribution confidence ${(confidence * 100).toFixed(0)}% is below the ${(
          ATTRIBUTION_CONFIDENCE_THRESHOLD * 100
        ).toFixed(
          0
        )}% bar — confirm the applicant before its facts are recorded.`,
    status: 'open',
    createdAt: now,
    auto: true,
    linkedDocId: extraction.documentId,
    origin,
    schemaVersion: CRM_SCHEMA_VERSION,
  };
  events.push({ type: 'worklist-upsert', payload: { item: worklistItem } });

  const gate: MirroredGate = {
    id: gateInstanceId,
    gateId: 'G2',
    caseId: ctx.caseId,
    projectId: ctx.projectId,
    approvalId: `appr_${gateInstanceId}`,
    title: gateById('G2').name,
    worklistItemId,
    reasons: joint
      ? ['Document appears to belong to more than one applicant.']
      : [
          `Attribution confidence ${(confidence * 100).toFixed(0)}% is below ${(
            ATTRIBUTION_CONFIDENCE_THRESHOLD * 100
          ).toFixed(0)}%.`,
        ],
    raisedAt: now,
    status: 'open',
  };
  gates.push(gate);
  events.push({ type: 'gate-raise', payload: { gate } });
}

// A safelist of the ONLY event kinds this projector can emit. The red-team gate
// (T007) asserts every projected event is in this set — there is no outbound /
// directive / comms kind to reach, by construction (FR-009).
export const DOCINTEL_EMITTED_EVENT_KINDS: readonly string[] = [
  'field-change',
  'document-upsert',
  'checklist-status',
  'conflict-upsert',
  'worklist-upsert',
  'stream-entry',
  'activity',
  'gate-raise',
];

// A convenience the money value uses; kept local so callers need not import the
// brand just to read a Pence conflict delta.
export type { Pence };
