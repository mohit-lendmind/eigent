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
  type ConflictValueSource,
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
  detectSpecialCategory,
  scoreAttribution,
  type ApplicantIdentity,
  type AttributionScore,
  type DocIdentifiers,
} from './attribution';
import { shouldQuarantine } from './docClassify';
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
  /**
   * How the value on file was sourced, so a raised conflict states its
   * provenance honestly rather than assuming `manual` (finding 6). When the
   * value came from an earlier document the caller passes that document's
   * source; absent means a manual/desktop entry.
   */
  source?: ConflictValueSource;
  /** When the value on file was recorded (as-of), surfaced on the G3 card. */
  asOf?: number;
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
  /**
   * The case roster the desktop recomputes attribution against (FR-006). When
   * provided, the CODED attribution score is authoritative and the model's own
   * `attribution` can only ever LOWER the effective confidence (min of the two),
   * never write A's facts onto B. When absent (a legacy caller / a side-car with
   * no identifiers), the model's attribution is used as-is — the production run
   * observer always passes the roster.
   */
  roster?: readonly ApplicantIdentity[];
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

// Finding 1 (defense in depth for FR-008): field keys whose VALUE must be a
// parsed money amount before it can earn `det`. A money-semantic field carrying a
// non-money (text) value — a fabricated "£99,999 per annum" that fails strict
// money parsing, or any never-verified figure — is floored to `syn` so it can
// never reach G9 as a det-text corridor. Narrower than MONEY_HINT (which also
// green-lights generic "amount"): only keys that name an income/asset figure.
const MONEY_FIELD_KEY =
  /income|salary|basic|overtime|bonus|dividend|profit|deposit|wage|pension/i;

function isMoneyFieldKey(fieldKey: string | undefined): boolean {
  return fieldKey !== undefined && MONEY_FIELD_KEY.test(fieldKey);
}

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

// Finding 5: does the parsed money VALUE actually appear in the quote? We scan
// the quote for GBP-shaped tokens and parse each the same way toFieldValue does,
// so "Annual basic £37,300" relates to 3_730_000 pence but "Employee Name" (or a
// fabricated £99,999) does not. A missing/empty quote never relates. The
// analogous value↔quote relate check for NON-money TEXT facts (a fabricated text
// value paired with an unrelated genuine quote) is P5 follow-up T028; the
// income-specific corridor it would close is already shut here + at G9.
const MONEY_TOKEN = /£?\s*\d[\d,]*(?:\.\d+)?/g;
function moneyValueInQuote(pence: number, quote: string | undefined): boolean {
  if (quote === undefined || quote.length === 0) return false;
  const tokens = quote.replace(/\s+/g, ' ').match(MONEY_TOKEN);
  if (!tokens) return false;
  return tokens.some((token) => {
    const parsed = parseGbp(token.replace(/\s+/g, ''));
    return parsed !== null && (parsed as number) === pence;
  });
}

function factKey(clientId: string, section: string, fieldKey: string): string {
  return `${clientId}::${section}::${fieldKey}`;
}

// FR-006 — the deterministic attribution decision. When a roster is present the
// coded cluster is authoritative: an identifier only counts if its quote
// substring-matches the text layer (a forger cannot claim an identifier the
// document does not contain), the effective confidence is min(coded, claimed),
// and a field is written to an applicant ONLY when the coded cluster and the
// model agree on the same non-joint clientId. Without a roster (legacy caller /
// no identifiers) the model's own attribution is used unchanged.
function effectiveAttribution(ctx: ApplyExtractionContext): AttributionScore {
  const claimed = ctx.extraction.attribution;
  if (!ctx.roster || ctx.roster.length === 0) {
    return {
      clientId: claimed.clientId,
      confidence: claimed.confidence,
      joint: claimed.joint,
    };
  }

  // Only quote-verified identifiers feed the coded score (FR-004/FR-006).
  const ids = ctx.extraction.identifiers;
  const verified: DocIdentifiers = {};
  if (
    ids?.fullName &&
    classifySrc(ids.fullName.quote, ctx.sourceText) === 'det'
  ) {
    verified.fullName = ids.fullName.value;
  }
  if (
    ids?.niNumber &&
    classifySrc(ids.niNumber.quote, ctx.sourceText) === 'det'
  ) {
    verified.niNumber = ids.niNumber.value;
  }
  if (
    ids?.postcode &&
    classifySrc(ids.postcode.quote, ctx.sourceText) === 'det'
  ) {
    verified.postcode = ids.postcode.value;
  }

  const coded = scoreAttribution(verified, ctx.roster, {
    knownJoint: claimed.joint,
  });

  const joint = coded.joint || claimed.joint;
  // The model and the coded cluster must name the SAME applicant, or nothing is
  // attributed — no field can leak to the wrong person on the model's say-so.
  const agreed =
    !joint && coded.clientId !== null && coded.clientId === claimed.clientId;
  return {
    clientId: agreed ? coded.clientId : null,
    confidence: Math.min(coded.confidence, claimed.confidence),
    joint,
  };
}

// Finding 6: two insights that share a fieldKey (or label) in ONE document must
// not collide on their derived field/conflict/worklist ids — a bare
// `fieldKey ?? label` discriminator made the second silently last-wins on
// upsert. The insight's position in the extraction disambiguates them while
// staying deterministic (same document ⇒ same order ⇒ same ids, FR-003).
function insightDiscriminator(
  insight: ExtractionInsight,
  index: number
): string {
  return `${insight.fieldKey ?? insight.label}\x00${index}`;
}

function toDomainInsight(
  insight: ExtractionInsight,
  index: number,
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
      insightDiscriminator(insight, index)
    ),
    label: insight.label,
    value: insight.value,
    conf: insight.confidence,
    sourceQuote: insight.quote,
    locator: insight.locator,
    src,
    ...(insight.section !== undefined ? { section: insight.section } : {}),
    ...(insight.fieldKey !== undefined ? { fieldKey: insight.fieldKey } : {}),
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

  // FR-006: the CODED attribution is authoritative. When a roster is supplied we
  // recompute the score from the quote-verified identifiers against the roster
  // and take the min of the coded and the model-claimed confidence — a confident
  // forger cannot write applicant A's facts onto applicant B, because the coded
  // cluster never agrees. Without a roster we fall back to the model's claim.
  const attribution = effectiveAttribution(ctx);
  const attributionGated =
    attribution.joint ||
    attribution.clientId === null ||
    attribution.confidence < ATTRIBUTION_CONFIDENCE_THRESHOLD;
  // Quarantine is a coded decision, not the model's own flag: an out-of-scope
  // type is held out even if the artifact claims docTypeInScope (FR-005).
  const quarantined = shouldQuarantine(
    extraction.docType,
    extraction.docTypeInScope
  );

  // Special-category is flagged if EITHER the model flagged it OR a coded Art 9
  // scan of the extracted text hits — the write path never rounds this down.
  const specialCategory =
    extraction.specialCategoryFlagged ||
    detectSpecialCategory(
      extraction.insights.map((i) => `${i.label} ${i.value} ${i.quote ?? ''}`)
    );

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

  for (let index = 0; index < extraction.insights.length; index += 1) {
    const insight = extraction.insights[index];
    // The trust spine: recompute independently. A forged `det` in the artifact
    // cannot survive a text layer that does not contain the quote.
    const matchSrc = classifySrc(insight.quote, ctx.sourceText);
    const value = toFieldValue(insight);
    // Finding 5: a `det` MONEY fact must relate its VALUE to its quote, not just
    // prove the quote exists. A fabricated amount (£99,999) paired with any
    // genuine quote ("Employee Name") must NOT mint det — downgrade to syn so it
    // can never satisfy G9. classifySrc already proved the quote is in the text.
    let src: Src =
      matchSrc === 'det' &&
      value.t === 'money' &&
      !moneyValueInQuote(value.v as number, insight.quote)
        ? 'syn'
        : matchSrc;

    const mapped =
      mayWriteFields &&
      insight.fieldKey !== undefined &&
      insight.section !== undefined;
    const section = mapped
      ? (insight.section as FactFindSectionKey)
      : undefined;
    const fieldKey = mapped ? (insight.fieldKey as string) : undefined;
    const key =
      section !== undefined && fieldKey !== undefined
        ? factKey(writeClientId, section, fieldKey)
        : undefined;
    const existing = key !== undefined ? ctx.existing?.[key] : undefined;

    // Finding 1 (defense in depth, FR-008): a money-semantic field (income,
    // salary, …) whose value did NOT parse as money is a det-TEXT corridor to G9
    // — floor it to syn. G9 already counts only det MONEY facts; this closes the
    // hole at the write path too, so a fabricated non-numeric income never earns
    // det on a money field in the first place. EXCEPTION: when a det value of a
    // DIFFERENT type is already on file, keep det so the record-never-repair
    // type-mismatch G3 below fires instead of silently dropping the write
    // (finding 2) — the conflict signal must survive.
    const wouldTriggerTypeMismatchG3 =
      existing !== undefined &&
      existing.src === 'det' &&
      existing.value.t !== value.t;
    if (
      src === 'det' &&
      value.t !== 'money' &&
      isMoneyFieldKey(insight.fieldKey) &&
      !wouldTriggerTypeMismatchG3
    ) {
      src = 'syn';
    }
    if (src === 'det') detFields += 1;
    else synFields += 1;

    let conflicted = false;

    if (mapped && section !== undefined && fieldKey !== undefined) {
      if (src === 'det' && existing && existing.src === 'det') {
        if (existing.value.t === 'money' && value.t === 'money') {
          // Two verified (det) MONEY values that disagree past 1% materiality are
          // a conflict: raise G3, keep the value on file, never silently
          // overwrite.
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
              index,
              existing,
              value,
              { kind: 'value', deltaPct }
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
        } else if (existing.value.t !== value.t) {
          // Finding 2: a det value that would OVERWRITE a det value of a DIFFERENT
          // FieldValue type is a record-repair / conflict-suppression attempt —
          // e.g. a hostile "37,300 per annum" that dodges money typing and would
          // silently replace the £38,500 on file with no G3. Never write through:
          // raise G3 and keep the value on file (record-never-repair, FR-007).
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
            index,
            existing,
            value,
            { kind: 'type' }
          );
        } else {
          // Same non-money type, det over det — a legitimate corrected value.
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
      toDomainInsight(
        insight,
        index,
        src,
        conflicted,
        documentId,
        contentHash,
        origin
      )
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
  if (specialCategory) {
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

/** Why a G3 was raised — a value disagreement, or a type/parse integrity fault. */
type ConflictDetail = { kind: 'value'; deltaPct: number } | { kind: 'type' };

function pushConflict(
  events: CaseLogEvent[],
  gates: MirroredGate[],
  ctx: ApplyExtractionContext,
  clientId: string,
  section: FactFindSectionKey,
  fieldKey: string,
  insight: ExtractionInsight,
  index: number,
  existing: ExistingFactValue,
  incomingValue: FieldValue,
  detail: ConflictDetail
): void {
  const { extraction, now } = ctx;
  const origin = { artifactId: ctx.originArtifactId, runId: ctx.runId };
  // Finding 6: disambiguate by the insight's position so two insights on the same
  // fieldKey in one document do not collide on the conflict/worklist ids.
  const discriminator = insightDiscriminator(insight, index);
  const conflictId = derivedId(
    'conflict',
    extraction.documentId,
    extraction.contentHash,
    discriminator
  );
  const worklistItemId = derivedId(
    'wl',
    extraction.documentId,
    extraction.contentHash,
    discriminator
  );

  // Finding 6: state the existing side's provenance honestly. The caller passes
  // the real source (an earlier document, or a manual entry) rather than always
  // assuming `manual`.
  const existingCv: ConflictValue = {
    value: existing.value,
    source: existing.source ?? { kind: 'manual' },
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

  // Finding 10: emit STRUCTURED reason data (code + params) so the i18n'd card
  // translates it at render, instead of baking English into the event.
  const field = `${section}.${fieldKey}`;
  const deltaLabel =
    detail.kind === 'value' ? `${(detail.deltaPct * 100).toFixed(1)}%` : '';
  const reasonCode =
    detail.kind === 'value' ? 'G3_VALUE_DELTA' : 'G3_TYPE_MISMATCH';
  // The existing value's as-of is not representable in the frozen M1
  // ConflictValue contract, so it rides on the structured reason params instead
  // (finding 6) — the G3 card renders it alongside the delta.
  const reasonParams: Record<string, unknown> =
    detail.kind === 'value' ? { field, deltaPct: detail.deltaPct } : { field };
  if (existing.asOf !== undefined) reasonParams.existingAsOf = existing.asOf;

  const worklistItem: WorklistItem = {
    id: worklistItemId,
    caseId: ctx.caseId,
    kind: 'conflict',
    title: gateById('G3').name,
    detail:
      detail.kind === 'value'
        ? `Document value disagrees with the value on file by ${deltaLabel} on ${field}. Choose the authoritative value.`
        : `Document value for ${field} does not match the type of the verified value on file. Choose the authoritative value.`,
    reasonCode,
    reasonParams,
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
    body:
      detail.kind === 'value'
        ? `Two verified values for ${field} disagree by ${deltaLabel}.`
        : `A verified value for ${field} would be overwritten by a value of a different type.`,
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
    reasons:
      detail.kind === 'value'
        ? [
            `Two verified (det) values for ${field} disagree by ${deltaLabel}.`,
            'Suitability evidence integrity — a human must choose the authoritative value.',
          ]
        : [
            `A verified (det) value for ${field} would be overwritten by an incoming value of a different type.`,
            'Suitability evidence integrity — a human must choose the authoritative value.',
          ],
    reasonCode,
    reasonParams,
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

  // Finding 10: structured reason data so the i18n'd card translates at render.
  const confidencePct = Math.round(confidence * 100);
  const thresholdPct = Math.round(ATTRIBUTION_CONFIDENCE_THRESHOLD * 100);
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
      : [`Attribution confidence ${confidencePct}% is below ${thresholdPct}%.`],
    reasonCode: joint ? 'G2_JOINT' : 'G2_LOW_CONFIDENCE',
    reasonParams: joint ? {} : { confidencePct, thresholdPct },
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
