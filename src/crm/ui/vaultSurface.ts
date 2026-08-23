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

// FR-001/002/006/007/008 (US1–US3) — the controller that makes the DOCUMENT
// VAULT loop executable in the running app (Blocker 4). The screen (DocumentVault)
// stays a thin read; this module owns the imperative seams behind it so a payslip
// dropped in the app really flows: upload → run → side-car → fold → vault.
//
// The seams, and where each one is real vs. deferred:
//   • upload → run  (uploadVaultDocuments): REAL. Each dropped File is read to
//     base64 and handed to ingestDocument, which uploads the bytes and dispatches
//     an lm.directive/1 on the same command plane every other agent uses.
//   • run → side-car: DEFERRED (documented, not faked). Turning the dispatched
//     run into an lm.docintel.extraction/1 side-car needs the live docintel MODEL,
//     which this synthetic build does not carry — fabricating one would fake the
//     ≥0.95 precision claim, which is forbidden. The observer's TRIGGER is the
//     only deferred link; the code path it would call is real and exercised below.
//   • side-car → fold → vault (applyExtractionSidecar): REAL. A published side-car
//     is decoded by the STRICT decoder, projected by applyExtraction against the
//     case roster + facts on file, appended to the case log as chained entries,
//     and folded — after which documents and G2/G3 gates appear in the vault.
//   • gate resolution (resolveConflictGate / attribution G2): REAL. Wired to the
//     casesStore + the mirrored-gate store so an adviser decides in place.
//   • income gate G9 (selectCaseIncomeGate): REAL. Assessed deterministically off
//     the income facts on file so the vault can say why a recommendation is blocked.

import type { ApplicantIdentity } from '../agents/attribution';
import { appendCaseLog } from '../agents/caseLogWrite';
import { ensureCaseProject } from '../agents/caseProject';
import { ingestDocument, type IngestDocument } from '../agents/docIngest';
import {
  decodeDocintelExtraction,
  type DocintelExtraction,
} from '../agents/docintelContract';
import { getAgentEdge } from '../agents/edge';
import {
  applyExtraction,
  type ApplyExtractionContext,
  type ExistingFactValue,
  type ExtractionProjection,
} from '../agents/extractionApply';
import {
  assessIncomeGate,
  DEFAULT_REQUIRED_INCOME_FIELDS,
  type IncomeFactState,
  type IncomeGateResult,
} from '../agents/incomeGate';
import { getCrmCasesStore } from '../casesStore';
import { getCrmClientsStore } from '../clientsStore';
import { getCrmDocumentsStore } from '../documentsStore';
import type { FactFindSectionKey } from '../domain/factFindSchema';
import { formatGbp, type Pence } from '../domain/money';
import {
  CRM_SCHEMA_VERSION,
  type CrmDocument,
  type FieldValue,
} from '../domain/types';
import { foldEntries } from '../fold/caseLogFold';
import { getCrmEventLogStore, type MirroredGate } from '../fold/eventLogStore';

const DOCINTEL_VERSIONS = {
  model: 'lm-docintel',
  promptSha: 'lm-docintel',
  skillSemver: '1.0.0',
  skillSha: 'lm-docintel-m3',
} as const;

export type VaultOutcome<T> =
  { ok: true; value: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

// A base64 string of the bytes, without the data: URL prefix a FileReader adds.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Read a File's bytes. Prefer the standard Blob.arrayBuffer (Electron renderer,
// modern browsers); fall back to FileReader for the odd embedded webview that
// ships one but not the other.
function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error('[vaultSurface] file read failed'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

async function fileToIngestDocument(file: File): Promise<IngestDocument> {
  const bytes = await readFileBytes(file);
  return {
    name: file.name,
    mediaType: file.type || 'application/octet-stream',
    dataBase64: bytesToBase64(bytes),
  };
}

/**
 * The upload → run seam. Read each dropped/selected File and hand it to the
 * ingest seam, which uploads the bytes and dispatches a docintel directive. The
 * run is observed from the fold, never awaited here (FR-001). Best-effort: a
 * desktop in local mode (no aion edge) reports a typed failure the vault renders
 * in a DocErrorCard rather than throwing into the render.
 *
 * FR-011: at admission — once the directive is dispatched and a run is attached —
 * a QUEUED document-upsert is written to the case log so the vault shows the
 * uploaded document immediately, instead of an empty vault until an extraction
 * lands. This is the production producer of the QUEUED state. The subsequent
 * QUEUED→PROCESSING→COMPLETED transitions are driven by the run→side-car observer
 * (deferred; see applyExtractionSidecar) as it applies the extraction.
 */
export async function uploadVaultDocuments(
  caseId: string,
  firmId: string,
  files: readonly File[],
  issuedBy: { kind: 'adviser' | 'agent'; id: string } = {
    kind: 'adviser',
    id: 'adviser:me',
  }
): Promise<VaultOutcome<{ ingested: number }>> {
  try {
    let ingested = 0;
    for (const file of files) {
      const document = await fileToIngestDocument(file);
      const result = await ingestDocument({
        caseId,
        firmId,
        document,
        issuedBy,
      });
      // A run is now attached (dispatch returned a runId): record the document
      // QUEUED so it appears in the vault right away.
      await admitQueuedDocument({
        caseId,
        firmId,
        documentId: `doc_${result.contentHash.slice(0, 16)}`,
        name: file.name,
        size: file.size,
        runId: result.dispatch.runId,
        originArtifactId: result.documentArtifactId,
        now: Date.now(),
      });
      ingested += 1;
    }
    return { ok: true, value: { ingested } };
  } catch (error) {
    return failure(error);
  }
}

interface AdmitQueuedDocumentInput {
  caseId: string;
  firmId: string;
  documentId: string;
  name: string;
  size: number;
  runId: string;
  originArtifactId: string;
  now: number;
}

/**
 * Emit a QUEUED document-upsert at ingest admission (FR-011). Written through the
 * SAME case-log → fold path every other document takes, so the record lands in
 * the store the vault reads — no shortcut around the fold. The run it is queued
 * behind rides along in `origin.runId`, so the (deferred) observer that watches
 * the run can flip this exact record to PROCESSING/COMPLETED when the extraction
 * side-car is applied. Exported so a regression test can drive the admission
 * path directly.
 */
export async function admitQueuedDocument(
  input: AdmitQueuedDocumentInput
): Promise<VaultOutcome<{ documentId: string }>> {
  try {
    const edge = await getAgentEdge();
    const projectId = await ensureCaseProject(input.caseId);
    const origin = { artifactId: input.originArtifactId, runId: input.runId };
    const document: CrmDocument = {
      id: input.documentId,
      owner: 'joint',
      name: input.name,
      type: 'unknown',
      status: 'QUEUED',
      size: input.size,
      when: input.now,
      iconTone: 'status-info',
      attribution: null,
      insights: [],
      schemaVersion: CRM_SCHEMA_VERSION,
      origin,
    };
    const written = await appendCaseLog(edge, projectId, {
      caseId: input.caseId,
      firmId: input.firmId,
      actor: { kind: 'agent', id: 'lm-docintel' },
      events: [{ type: 'document-upsert', payload: { document } }],
      versions: DOCINTEL_VERSIONS,
      originArtifactId: input.originArtifactId,
      runId: input.runId,
      at: input.now,
    });
    await foldEntries(input.caseId, written.entries);
    return { ok: true, value: { documentId: input.documentId } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * The case roster the desktop recomputes attribution against (FR-006). Built
 * from the identifiers actually on file — the client's full name, and any
 * postcode recorded in the applicant's address section. Sparse identifiers yield
 * a low coded score, which is the honest outcome: the document is held behind G2
 * for a human to confirm the applicant, never mis-attributed on the model's word.
 */
export function rosterForCase(caseId: string): ApplicantIdentity[] {
  const kase = getCrmCasesStore().getState().casesById[caseId];
  if (!kase) return [];
  const clientsById = getCrmClientsStore().getState().clientsById;
  return kase.applicants.map((applicant) => {
    const client = clientsById[applicant.clientId];
    const fullName = client
      ? `${client.firstName} ${client.lastName}`.trim()
      : undefined;
    const postcode = fieldValueText(
      applicant.profile.address?.fields.find((f) => f.k === 'postcode')?.value
    );
    return {
      clientId: applicant.clientId,
      ...(fullName ? { fullName } : {}),
      ...(postcode ? { postcode } : {}),
    };
  });
}

function fieldValueText(value: unknown): string | undefined {
  if (
    value &&
    typeof value === 'object' &&
    'v' in value &&
    typeof (value as { v: unknown }).v === 'string'
  ) {
    return (value as { v: string }).v;
  }
  return undefined;
}

/**
 * The facts already on file, keyed `${clientId}::${section}::${fieldKey}`, so a
 * det value that disagrees with an incoming det value raises G3 rather than
 * silently overwriting (FR-007). The source/as-of ride along so the raised
 * conflict states its provenance honestly (finding 6).
 */
export function existingFactsForCase(
  caseId: string
): Record<string, ExistingFactValue> {
  const kase = getCrmCasesStore().getState().casesById[caseId];
  if (!kase) return {};
  const out: Record<string, ExistingFactValue> = {};
  for (const applicant of kase.applicants) {
    for (const [section, sectionValue] of Object.entries(applicant.profile)) {
      if (!sectionValue) continue;
      for (const field of sectionValue.fields) {
        const key = `${applicant.clientId}::${section}::${field.k}`;
        out[key] = {
          value: field.value,
          src: field.src,
          ...(field.confirmedAt !== undefined
            ? { asOf: field.confirmedAt }
            : {}),
        };
      }
    }
  }
  return out;
}

export interface ApplyExtractionSidecarInput {
  /** The published side-car, still-encoded — decoded by the strict decoder. */
  sidecar: unknown;
  caseId: string;
  firmId: string;
  /** The born-digital text layer the run read, or null for vision-only. */
  sourceText: string | null;
  document: { name: string; size?: number; when?: number; iconTone?: string };
  originArtifactId: string;
  runId: string;
  now: number;
  /** Test/observer hook: override the store-derived roster. */
  roster?: readonly ApplicantIdentity[];
  /** Test/observer hook: override the store-derived facts on file. */
  existing?: Record<string, ExistingFactValue>;
  checklist?: ApplyExtractionContext['checklist'];
}

/**
 * The side-car → fold → vault seam. This is exactly what the live run observer
 * calls when the docintel run publishes its side-car; exposed so the deterministic
 * synthetic producer (the demo + the regression test) drives the SAME path,
 * never a shortcut around it. Decodes the side-car with the strict decoder (a
 * missing `src` is a hard reject), projects it against the roster + facts on file,
 * appends the projected events to the case log as chained entries, and folds them
 * — after which the vault renders the document and any G2/G3 gate straight off the
 * fold. Pure store effects only; no send path exists to reach.
 */
export async function applyExtractionSidecar(
  input: ApplyExtractionSidecarInput
): Promise<VaultOutcome<{ projection: ExtractionProjection; folded: number }>> {
  try {
    const extraction: DocintelExtraction = decodeDocintelExtraction(
      input.sidecar
    );
    const edge = await getAgentEdge();
    const projectId = await ensureCaseProject(input.caseId);

    const ctx: ApplyExtractionContext = {
      extraction,
      caseId: input.caseId,
      firmId: input.firmId,
      projectId,
      sourceText: input.sourceText,
      document: input.document,
      existing: input.existing ?? existingFactsForCase(input.caseId),
      roster: input.roster ?? rosterForCase(input.caseId),
      checklist: input.checklist,
      originArtifactId: input.originArtifactId,
      runId: input.runId,
      now: input.now,
    };

    const projection = applyExtraction(ctx);

    const written = await appendCaseLog(edge, projectId, {
      caseId: input.caseId,
      firmId: input.firmId,
      actor: { kind: 'agent', id: 'lm-docintel' },
      events: projection.events,
      versions: DOCINTEL_VERSIONS,
      originArtifactId: input.originArtifactId,
      runId: input.runId,
      at: input.now,
    });

    // Fold the just-written entries directly. They continue the chain from the
    // current head (appendCaseLog read it), so foldEntries applies them
    // incrementally — the same deterministic fold a refresh would run, minus the
    // aion round-trip, so this works identically under the real edge and a test
    // edge. Documents and gates land in the stores the vault reads.
    const report = await foldEntries(input.caseId, written.entries);

    return { ok: true, value: { projection, folded: report.applied } };
  } catch (error) {
    return failure(error);
  }
}

export interface ConflictGateView {
  conflictId: string;
  existing: FieldValue;
  incoming: FieldValue;
  existingLabel: string;
  incomingLabel: string;
}

function fieldValueLabel(value: FieldValue): string {
  if (value.t === 'money') return formatGbp(value.v as Pence);
  if (value.t === 'text') return value.v;
  return '—';
}

/**
 * The two disagreeing values behind a G3 gate, read from the conflict record the
 * write path stored, so the card can show both inline and needs no doc opened
 * (US3). The gate id is `G3_${conflictId}`, so the record is a direct lookup.
 * Null when the record is not (yet) on file.
 */
export function conflictForGate(gate: MirroredGate): ConflictGateView | null {
  if (gate.gateId !== 'G3') return null;
  const conflictId = gate.id.startsWith('G3_') ? gate.id.slice(3) : gate.id;
  const record = getCrmCasesStore().getState().conflictsById[conflictId];
  if (!record || record.values.length < 2) return null;
  const [existing, incoming] = record.values;
  return {
    conflictId,
    existing: existing.value,
    incoming: incoming.value,
    existingLabel: fieldValueLabel(existing.value),
    incomingLabel: fieldValueLabel(incoming.value),
  };
}

/**
 * Resolve a G3 conflict gate in place (US3): the adviser picks whether the value
 * on file or the document's value is authoritative, and the mirrored gate closes.
 * The conflict record id is the gate's linked worklist/conflict id derived by the
 * write path, so the choice writes straight through casesStore.resolveConflict.
 */
export function resolveConflictGate(
  gate: MirroredGate,
  choice: { conflictId: string; chosenValue: ExistingFactValue['value'] },
  adviserId: string
): VaultOutcome<{ decision: 'resolved' }> {
  if (gate.gateId !== 'G3') {
    return {
      ok: false,
      error: `resolveConflictGate is only valid for a G3 conflict; refused ${gate.gateId}.`,
    };
  }
  try {
    getCrmCasesStore().getState().resolveConflict(choice.conflictId, {
      chosenValue: choice.chosenValue,
      method: 'confirm-value',
      resolvedBy: adviserId,
    });
    getCrmEventLogStore()
      .getState()
      .resolveMirroredGate(gate.id, 'resolved', Date.now());
    return { ok: true, value: { decision: 'resolved' } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Confirm a G2 attribution gate (US3): the adviser confirms which applicant the
 * document belongs to, marking the document's attribution confirmed and closing
 * the gate.
 *
 * DEFERRED (documented, not faked): confirming G2 does NOT re-project the held
 * fact-find fields onto the applicant. The write path holds every applicant field
 * behind G2 (FR-006), so a confirmed attribution should re-run applyExtraction to
 * land those fields — that re-projection is a follow-up, tracked in
 * specs/004-mesh-m3-docintel/tasks.md as P5 T026 (and noted under T012). Today
 * the confirmation is recorded and the gate closes; the facts are re-landed when
 * the document is re-ingested with the applicant known.
 */
export function confirmAttributionGate(
  gate: MirroredGate,
  documentId: string,
  adviserId: string
): VaultOutcome<{ decision: 'confirmed' }> {
  if (gate.gateId !== 'G2') {
    return {
      ok: false,
      error: `confirmAttributionGate is only valid for a G2 attribution; refused ${gate.gateId}.`,
    };
  }
  try {
    getCrmDocumentsStore()
      .getState()
      .confirmAttribution(documentId, { confirmedBy: adviserId });
    getCrmEventLogStore()
      .getState()
      .resolveMirroredGate(gate.id, 'confirmed', Date.now());
    return { ok: true, value: { decision: 'confirmed' } };
  } catch (error) {
    return failure(error);
  }
}

/** Close a G2 gate as rejected (the document does not belong to this applicant). */
export function rejectAttributionGate(
  gate: MirroredGate
): VaultOutcome<{ decision: 'rejected' }> {
  if (gate.gateId !== 'G2') {
    return {
      ok: false,
      error: `rejectAttributionGate is only valid for a G2 attribution; refused ${gate.gateId}.`,
    };
  }
  try {
    getCrmEventLogStore()
      .getState()
      .resolveMirroredGate(gate.id, 'rejected', Date.now());
    return { ok: true, value: { decision: 'rejected' } };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Assess G9 for a case (FR-008, US3): a recommendation is blocked until each
 * applicant's required income field is DET-verified. Reads the income facts off
 * the fold and runs the coded gate — never an LLM judgement — so the vault can
 * name the exact applicant + field that is blocking. Returns satisfied when the
 * case has no applicants (nothing to block on) so an empty case shows no card.
 */
export function selectCaseIncomeGate(
  caseId: string,
  requiredFieldKeys: readonly string[] = DEFAULT_REQUIRED_INCOME_FIELDS
): IncomeGateResult {
  const kase = getCrmCasesStore().getState().casesById[caseId];
  if (!kase) return { satisfied: true, blocking: [] };

  const applicantIds = kase.applicants.map((a) => a.clientId);
  const facts: IncomeFactState[] = [];
  for (const applicant of kase.applicants) {
    const incomeSection = applicant.profile.income as
      | {
          fields: {
            k: string;
            src: IncomeFactState['src'];
            value: FieldValue;
          }[];
        }
      | undefined;
    if (!incomeSection) continue;
    for (const field of incomeSection.fields) {
      facts.push({
        clientId: applicant.clientId,
        fieldKey: field.k,
        src: field.src,
        // FR-008: carry the value's type so G9 counts only det MONEY facts — a
        // det TEXT income value must not satisfy the gate.
        valueType: field.value.t,
      });
    }
  }
  return assessIncomeGate(applicantIds, facts, requiredFieldKeys);
}

// A section-key cast helper the roster/existing builders share, kept explicit so
// a future factFind section rename surfaces here rather than silently mis-keying.
export type VaultSectionKey = FactFindSectionKey;
