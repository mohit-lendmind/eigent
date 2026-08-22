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

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  dispatchDocuments,
  dispatchEventLog,
  dispatchWorkstream,
  getWorkstreamBus,
  registerCasesReadBus,
  signalStoreHydrated,
} from './_bus';
import { getCrmClientsStore } from './clientsStore';
import {
  requiredKeysForSection,
  type FactFindSectionKey as SectionKeyRaw,
} from './domain/factFindSchema';
import { newCrmId } from './domain/ids';
import { STAGE_MAP } from './domain/stages';
import type {
  Applicant,
  Case,
  CaseId,
  ClientId,
  ComplianceRecord,
  ConflictId,
  ConflictRecord,
  CriterionCheck,
  FactFindField,
  FactFindSection,
  FactFindSectionKey,
  FieldChangeEvent,
  FieldChangeReason,
  FieldValue,
  Product,
  Src,
  Stage,
} from './domain/types';
import { CRM_SCHEMA_VERSION } from './domain/types';

export const CRM_CASES_PERSIST_VERSION = 1;
export const CRM_CASES_STORE_KEY = 'crm-cases-store';

// Outbox candidates need a firmId; a case without stamped ownership falls back
// to the house firm so a desktop edit is never dropped for want of one.
const FALLBACK_FIRM_ID = 'lendmind';

export interface CrmCasesState {
  storageEnvironmentKey: string;
  casesById: Record<CaseId, Case>;
  conflictsById: Record<ConflictId, ConflictRecord>;
  criteriaByCase: Record<CaseId, CriterionCheck[]>;
  productsByCase: Record<CaseId, Product[]>;
  complianceByCase: Record<CaseId, ComplianceRecord | undefined>;

  upsertCases: (cases: Case[]) => void;
  upsertConflictRecords: (records: ConflictRecord[]) => void;
  upsertCriteriaChecks: (checks: CriterionCheck[]) => void;
  upsertProducts: (products: Product[]) => void;
  upsertCompliance: (record: ComplianceRecord) => void;
  setFactFindField: (
    caseId: CaseId,
    clientId: ClientId,
    section: FactFindSectionKey,
    fieldKey: string,
    newValue: FieldValue,
    opts: {
      reason?: FieldChangeReason;
      changedBy: string;
      src?: Src;
    }
  ) => void;
  confirmSynthesizedField: (
    caseId: CaseId,
    clientId: ClientId,
    section: FactFindSectionKey,
    fieldKey: string,
    opts: { confirmedBy: string }
  ) => void;
  moveStage: (caseId: CaseId, nextStageKey: Stage) => void;
  resolveConflict: (
    conflictId: ConflictId,
    opts: {
      chosenValue: FieldValue;
      method: 'confirm-value' | 'ask-client';
      resolvedBy: string;
      reasoning?: string;
    }
  ) => void;
  resetForTests: () => void;
}

const emptyState = (): Pick<
  CrmCasesState,
  | 'storageEnvironmentKey'
  | 'casesById'
  | 'conflictsById'
  | 'criteriaByCase'
  | 'productsByCase'
  | 'complianceByCase'
> => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  casesById: {},
  conflictsById: {},
  criteriaByCase: {},
  productsByCase: {},
  complianceByCase: {},
});

const environmentMatches = (
  state: Partial<CrmCasesState> | undefined
): boolean => state?.storageEnvironmentKey === getAuthEnvironmentKey();

// Pure module-level completeness math (FR-007). Deliberately importable
// without instantiating the store.
export function computeSectionCompleteness(
  section: FactFindSection,
  requiredKeys: readonly string[]
): number {
  if (requiredKeys.length === 0) return 1;
  const present = new Set(section.fields.map((f) => f.k));
  let filled = 0;
  for (const k of requiredKeys) {
    const field = section.fields.find((f) => f.k === k);
    if (!field) continue;
    if (isFieldValueNonEmpty(field.value)) filled += 1;
    else if (present.has(k)) filled += 0.5;
  }
  return Math.max(0, Math.min(1, filled / requiredKeys.length));
}

export function computeApplicantCompleteness(applicant: Applicant): number {
  const sections = Object.entries(applicant.profile) as Array<
    [FactFindSectionKey, FactFindSection]
  >;
  if (sections.length === 0) return 0;
  let total = 0;
  for (const [, sec] of sections) {
    total += sec.completeness;
  }
  return total / sections.length;
}

export function computeCaseCompleteness(applicants: Applicant[]): number {
  if (applicants.length === 0) return 0;
  let total = 0;
  for (const a of applicants) total += a.completeness;
  return total / applicants.length;
}

function isFieldValueNonEmpty(v: FieldValue): boolean {
  switch (v.t) {
    case 'text':
    case 'select':
    case 'date':
      return v.v.trim().length > 0;
    case 'number':
    case 'money':
      return Number.isFinite(v.v);
    case 'toggle':
      return typeof v.v === 'boolean';
    case 'missing':
      return false;
  }
}

export function categoryForApplicant(
  applicant: Applicant
): 'employed' | 'self-employed' {
  const emp = applicant.profile.employment;
  if (!emp) return 'employed';
  const typeField = emp.fields.find((f) => f.k === 'type');
  if (
    typeField &&
    typeField.value.t === 'select' &&
    /self[- ]?employed|director|contractor/i.test(typeField.value.v)
  ) {
    return 'self-employed';
  }
  const business = emp.fields.find((f) => f.k === 'business');
  if (business) return 'self-employed';
  return 'employed';
}

export function recomputeApplicantCompleteness(
  applicant: Applicant
): Applicant {
  const category = categoryForApplicant(applicant);
  const nextProfile: Applicant['profile'] = {};
  for (const [sec, value] of Object.entries(applicant.profile) as Array<
    [SectionKeyRaw, FactFindSection]
  >) {
    const keys = requiredKeysForSection(category, sec);
    nextProfile[sec] = {
      ...value,
      completeness: computeSectionCompleteness(value, keys),
    };
  }
  const nextApplicant: Applicant = {
    ...applicant,
    profile: nextProfile,
  };
  nextApplicant.completeness = computeApplicantCompleteness(nextApplicant);
  return nextApplicant;
}

function findFactFindField(
  applicant: Applicant,
  section: FactFindSectionKey,
  fieldKey: string
): FactFindField | undefined {
  return applicant.profile[section]?.fields.find((f) => f.k === fieldKey);
}

function applyFieldUpdate(
  applicant: Applicant,
  section: FactFindSectionKey,
  fieldKey: string,
  patch: (prev: FactFindField | undefined) => FactFindField
): Applicant {
  const currentSection = applicant.profile[section];
  const nextFields: FactFindField[] = currentSection
    ? [...currentSection.fields]
    : [];
  const idx = nextFields.findIndex((f) => f.k === fieldKey);
  const prev = idx >= 0 ? nextFields[idx] : undefined;
  const next = patch(prev);
  if (idx >= 0) nextFields[idx] = next;
  else nextFields.push(next);
  const category = categoryForApplicant(applicant);
  const keys = requiredKeysForSection(category, section);
  const nextSection: FactFindSection = {
    fields: nextFields,
    completeness: computeSectionCompleteness(
      { fields: nextFields, completeness: 0 },
      keys
    ),
  };
  const nextProfile: Applicant['profile'] = {
    ...applicant.profile,
    [section]: nextSection,
  };
  const nextApplicant: Applicant = {
    ...applicant,
    profile: nextProfile,
  };
  nextApplicant.completeness = computeApplicantCompleteness(nextApplicant);
  return nextApplicant;
}

function upsertApplicantInCase(
  c: Case,
  clientId: ClientId,
  updater: (a: Applicant) => Applicant
): Case {
  const nextApplicants = c.applicants.map((a) =>
    a.clientId === clientId ? updater(a) : a
  );
  return {
    ...c,
    applicants: nextApplicants,
    completeness: computeCaseCompleteness(nextApplicants),
    updated: Date.now(),
  };
}

// Dispatch to downstream stores via the synchronous side-bus (registered by
// workstream/documents at import time). One-directional per FR-014.
// Missing wiring is loud (dev throws, prod logs + queues) — never silent.
function emitFieldChangeEvent(
  event: Omit<FieldChangeEvent, 'id' | 'schemaVersion'>
): void {
  dispatchWorkstream((bus) => bus.appendFieldChangeEvent(event));
}

function noteCaseActivity(
  caseId: CaseId,
  kind: 'stage-change' | 'note' | 'seed' | 'system',
  title: string,
  detail?: string,
  actor?: string
): void {
  dispatchWorkstream((bus) =>
    bus.noteActivity(caseId, {
      id: newCrmId('activity'),
      caseId,
      kind,
      title,
      detail,
      when: Date.now(),
      actor,
      schemaVersion: CRM_SCHEMA_VERSION,
    })
  );
}

export const useCrmCasesStore = create<CrmCasesState>()(
  persist(
    (set, get) => ({
      ...emptyState(),

      upsertCases: (cases) => {
        if (cases.length === 0) return;
        // Compute new cases + back-refs FIRST, then commit both stores in
        // exactly one setState each. Only the cases being upserted are
        // walked — O(upserted) not O(all-cases).
        const backRefsByClient = new Map<ClientId, Set<CaseId>>();
        const stampedById: Record<CaseId, Case> = {};
        for (const c of cases) {
          const applicants = c.applicants.map(recomputeApplicantCompleteness);
          stampedById[c.id] = {
            ...c,
            schemaVersion: CRM_SCHEMA_VERSION,
            applicants,
            completeness: computeCaseCompleteness(applicants),
          };
          for (const a of applicants) {
            const bucket = backRefsByClient.get(a.clientId) ?? new Set();
            bucket.add(c.id);
            backRefsByClient.set(a.clientId, bucket);
          }
        }
        set((state) => ({
          casesById: { ...state.casesById, ...stampedById },
        }));
        // Batch client back-refs into ONE setState (cases → clients, FR-014).
        const clientsStore = getCrmClientsStore();
        clientsStore.setState((state) => {
          const next = { ...state.clientsById };
          let mutated = false;
          for (const [clientId, caseIds] of backRefsByClient) {
            const client = next[clientId];
            if (!client) continue;
            const existing = new Set(client.cases);
            let added = false;
            for (const cid of caseIds) {
              if (!existing.has(cid)) {
                existing.add(cid);
                added = true;
              }
            }
            if (added) {
              next[clientId] = { ...client, cases: [...existing] };
              mutated = true;
            }
          }
          return mutated ? { clientsById: next } : state;
        });
      },

      upsertConflictRecords: (records) =>
        set((state) => {
          if (records.length === 0) return state;
          const next = { ...state.conflictsById };
          for (const r of records) {
            next[r.id] = { ...r, schemaVersion: CRM_SCHEMA_VERSION };
          }
          return { conflictsById: next };
        }),

      upsertCriteriaChecks: (checks) =>
        set((state) => {
          if (checks.length === 0) return state;
          const next = { ...state.criteriaByCase };
          const byCase: Record<CaseId, CriterionCheck[]> = {};
          for (const check of checks) {
            const stamped: CriterionCheck = {
              ...check,
              schemaVersion: CRM_SCHEMA_VERSION,
            };
            (byCase[check.caseId] ??= []).push(stamped);
          }
          for (const [cid, group] of Object.entries(byCase)) {
            const prev = next[cid] ?? [];
            const merged = new Map(prev.map((p) => [p.id, p]));
            for (const item of group) merged.set(item.id, item);
            next[cid] = [...merged.values()];
          }
          return { criteriaByCase: next };
        }),

      upsertProducts: (products) =>
        set((state) => {
          if (products.length === 0) return state;
          const next = { ...state.productsByCase };
          const byCase: Record<CaseId, Product[]> = {};
          for (const p of products) {
            const stamped: Product = {
              ...p,
              schemaVersion: CRM_SCHEMA_VERSION,
            };
            (byCase[p.caseId] ??= []).push(stamped);
          }
          for (const [cid, group] of Object.entries(byCase)) {
            const prev = next[cid] ?? [];
            const merged = new Map(prev.map((p) => [p.id, p]));
            for (const item of group) merged.set(item.id, item);
            next[cid] = [...merged.values()];
          }
          return { productsByCase: next };
        }),

      upsertCompliance: (record) =>
        set((state) => ({
          complianceByCase: {
            ...state.complianceByCase,
            [record.caseId]: {
              ...record,
              schemaVersion: CRM_SCHEMA_VERSION,
            },
          },
        })),

      setFactFindField: (
        caseId,
        clientId,
        section,
        fieldKey,
        newValue,
        opts
      ) => {
        const src: Src = opts.src ?? 'det';
        const reason: FieldChangeReason = opts.reason ?? 'edit';
        // Defensive: money must be a Pence number, never a display string.
        if (newValue.t === 'money' && typeof newValue.v !== 'number') {
          throw new Error(
            '[casesStore] money FieldValue.v must be Pence (number). Use parseGbp() at the boundary.'
          );
        }
        const nowTs = Date.now();
        let priorValue: FieldValue | null = null;
        let priorSrc: Src | null = null;
        let didWrite = false;
        let firmId = FALLBACK_FIRM_ID;
        set((state) => {
          const existing = state.casesById[caseId];
          if (!existing) return state;
          didWrite = true;
          firmId = existing.ownership?.firmId ?? FALLBACK_FIRM_ID;
          const updated = upsertApplicantInCase(existing, clientId, (a) => {
            const prev = findFactFindField(a, section, fieldKey);
            if (prev) {
              priorValue = prev.value;
              priorSrc = prev.src;
            }
            return applyFieldUpdate(a, section, fieldKey, (p) => ({
              k: fieldKey,
              label: p?.label ?? fieldKey,
              value: newValue,
              src,
              hint: p?.hint,
              flag: p?.flag,
              conflictId:
                reason === 'conflict-resolution' ? undefined : p?.conflictId,
              mono: p?.mono,
              confirmedAt: p?.confirmedAt,
              confirmedBy: p?.confirmedBy,
              origin: p?.origin,
            }));
          });
          return {
            casesById: { ...state.casesById, [caseId]: updated },
          };
        });
        emitFieldChangeEvent({
          caseId,
          clientId,
          section,
          fieldKey,
          priorValue,
          newValue,
          priorSrc,
          newSrc: src,
          changedAt: nowTs,
          changedBy: opts.changedBy,
          reason,
        });
        // FR-018: a desktop field edit durably queues for the canonical log.
        if (didWrite) {
          dispatchEventLog((bus) =>
            bus.enqueueOutbox({
              kind: 'lm.caselog/1',
              caseId,
              firmId,
              at: nowTs,
              actor: { kind: 'adviser', id: opts.changedBy },
              event: {
                type: 'field-change',
                payload: { clientId, section, fieldKey, value: newValue, src },
              },
              origin: {
                artifactId: `outbox/${caseId}/field-change/${clientId}/${section}/${fieldKey}`,
                runId: '',
              },
              versions: {
                model: '',
                promptSha: '',
                skillSemver: '',
                skillSha: '',
              },
            })
          );
        }
      },

      confirmSynthesizedField: (caseId, clientId, section, fieldKey, opts) => {
        const nowTs = Date.now();
        let priorValue: FieldValue | null = null;
        let newValue: FieldValue | null = null;
        set((state) => {
          const existing = state.casesById[caseId];
          if (!existing) return state;
          const updated = upsertApplicantInCase(existing, clientId, (a) => {
            const prev = findFactFindField(a, section, fieldKey);
            if (!prev) return a;
            priorValue = prev.value;
            newValue = prev.value;
            return applyFieldUpdate(a, section, fieldKey, () => ({
              ...prev,
              src: 'det',
              confirmedAt: nowTs,
              confirmedBy: opts.confirmedBy,
            }));
          });
          return {
            casesById: { ...state.casesById, [caseId]: updated },
          };
        });
        if (newValue) {
          emitFieldChangeEvent({
            caseId,
            clientId,
            section,
            fieldKey,
            priorValue,
            newValue: newValue as FieldValue,
            priorSrc: 'syn',
            newSrc: 'det',
            changedAt: nowTs,
            changedBy: opts.confirmedBy,
            reason: 'confirm-synthesized',
          });
        }
      },

      moveStage: (caseId, nextStageKey) => {
        if (!STAGE_MAP[nextStageKey]) {
          throw new Error(`[casesStore] Unknown stage: ${nextStageKey}`);
        }
        let priorStage: Stage | null = null;
        set((state) => {
          const c = state.casesById[caseId];
          if (!c) return state;
          priorStage = c.stage;
          return {
            casesById: {
              ...state.casesById,
              [caseId]: {
                ...c,
                stage: nextStageKey,
                updated: Date.now(),
              },
            },
          };
        });
        if (priorStage) {
          noteCaseActivity(
            caseId,
            'stage-change',
            `Stage: ${priorStage} → ${nextStageKey}`,
            undefined,
            'system'
          );
        }
      },

      resolveConflict: (conflictId, opts) => {
        // ---- Precompute EVERYTHING before any commit (spec: atomic). ----
        const s = get();
        const record = s.conflictsById[conflictId];
        if (!record) return;

        const chosenValue = opts.chosenValue;
        if (chosenValue.t === 'money' && typeof chosenValue.v !== 'number') {
          throw new Error(
            '[casesStore] resolveConflict money must be Pence (number).'
          );
        }

        const priorField = findConflictField(
          s.casesById[record.caseId],
          record.clientId,
          record.section,
          record.fieldKey
        );
        const priorValue: FieldValue | null = priorField?.value ?? null;
        const priorSrc: Src | null = priorField?.src ?? null;

        // Resumability: instead of an early-return on record.resolvedAt, derive
        // remaining side-effects from observable state so a retry finishes an
        // incomplete run rather than no-oping.
        const wsBus = getWorkstreamBus();
        const linkedWl = wsBus
          ? wsBus.findWorklistItemByConflict(record.id)
          : null;

        const currentField = priorField;
        const fieldStillConflicted =
          currentField?.conflictId === record.id ||
          !fieldValuesEqual(
            currentField?.value ?? { t: 'missing' },
            chosenValue
          );

        // Doc-sourced insights that may still be marked conflict:true.
        const docSources = record.values.filter(
          (v) => v.source.kind === 'document' && v.source.docId
        );

        // Compute stream-entry presence by probing the workstream store via
        // the bus (no static import of workstreamStore — preserves FR-014).
        const streamAlreadyPushed = wsBus
          ? wsBus.hasStreamEntryForConflict(
              record.caseId,
              'Conflict resolved',
              linkedWl?.id
            )
          : false;

        const eventAlreadyEmitted = wsBus
          ? wsBus.hasFieldChangeEventForConflict(record.id)
          : false;

        const notChosen = record.values.filter(
          (v) => !fieldValuesEqual(v.value, chosenValue)
        );
        const nowTs = Date.now();
        const stampedResolvedAt = record.resolvedAt ?? nowTs;
        const stampedResolvedBy = record.resolvedBy ?? opts.resolvedBy;

        // ---- Commit the cases + conflicts mutation in one setState. ----
        if (fieldStillConflicted || !record.resolvedAt) {
          set((state) => {
            const existing = state.casesById[record.caseId];
            if (!existing) return state;
            const updatedCase = fieldStillConflicted
              ? upsertApplicantInCase(existing, record.clientId, (a) =>
                  applyFieldUpdate(a, record.section, record.fieldKey, (p) => ({
                    k: record.fieldKey,
                    label: p?.label ?? record.fieldKey,
                    value: chosenValue,
                    src: 'det',
                    hint: p?.hint,
                    flag: undefined,
                    conflictId: undefined,
                    mono: p?.mono,
                    confirmedAt: stampedResolvedAt,
                    confirmedBy: stampedResolvedBy,
                    origin: p?.origin,
                  }))
                )
              : existing;
            const nextConflict: ConflictRecord = {
              ...record,
              resolvedAt: stampedResolvedAt,
              resolvedBy: stampedResolvedBy,
              resolution: {
                chosenValue,
                method: opts.method,
                reasoning: opts.reasoning ?? record.resolution?.reasoning,
              },
            };
            return {
              casesById: {
                ...state.casesById,
                [record.caseId]: updatedCase,
              },
              conflictsById: {
                ...state.conflictsById,
                [record.id]: nextConflict,
              },
            };
          });
        }

        // ---- Downstream dispatches (each guarded by observable-state check). ----
        if (!eventAlreadyEmitted) {
          emitFieldChangeEvent({
            caseId: record.caseId,
            clientId: record.clientId,
            section: record.section,
            fieldKey: record.fieldKey,
            priorValue,
            newValue: chosenValue,
            priorSrc,
            newSrc: 'det',
            changedAt: stampedResolvedAt,
            changedBy: stampedResolvedBy,
            reason: 'conflict-resolution',
            conflictId: record.id,
          });
        }

        // Flip EVERY doc-sourced insight (both sides of the disagreement) from
        // conflict:true → false, matching by the exact insightLabel carried on
        // the ConflictRecord value (not by label substring).
        for (const v of docSources) {
          if (!v.source.docId) continue;
          const label = v.source.insightLabel;
          if (!label) continue;
          dispatchDocuments((bus) =>
            bus.flipInsightConflict(v.source.docId!, label, false)
          );
        }

        // Workstream: resolve the linked worklist item + push a done-kind
        // stream entry with the full reasoning trace.
        if (linkedWl && linkedWl.status === 'open') {
          dispatchWorkstream((bus) =>
            bus.resolveWorklistItem(linkedWl.id, {
              resolution: {
                method: opts.method,
                reasoning: opts.reasoning,
                chosenValue,
              },
              resolvedBy: stampedResolvedBy,
            })
          );
        }

        if (!streamAlreadyPushed) {
          dispatchWorkstream((bus) =>
            bus.pushStreamEntry(record.caseId, {
              caseId: record.caseId,
              kind: 'done',
              iconTone: 'status-success',
              when: stampedResolvedAt,
              timestamp: stampedResolvedAt,
              title: 'Conflict resolved',
              body: opts.reasoning,
              linkedWorklistId: linkedWl?.id,
              trace: {
                claim: `Field ${record.section}.${record.fieldKey} set from resolved conflict`,
                subject: record.fieldKey,
                working: record.values.map(
                  (v, i) =>
                    `${i + 1}. Considered ${describeFieldValue(v.value)} from ${v.source.kind}`
                ),
                evidence: record.values.map((v) => ({
                  kind: 'document' as const,
                  label: v.source.insightLabel ?? 'Source',
                  source: v.source.docId,
                  quote: v.source.quote,
                })),
                alternatives: notChosen.map((n) => ({
                  option: describeFieldValue(n.value),
                  reason: `Not chosen: ${n.source.insightLabel ?? n.source.kind}`,
                  rejected: true,
                })),
                confidence: 1,
                calibration: opts.reasoning,
              },
            })
          );
        }
      },

      resetForTests: () => set(emptyState()),
    }),
    {
      name: CRM_CASES_STORE_KEY,
      version: CRM_CASES_PERSIST_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CrmCasesState> | undefined;
        if (!state) return persistedState as CrmCasesState;
        if (!environmentMatches(state)) {
          return emptyState() as CrmCasesState;
        }
        return {
          ...state,
          storageEnvironmentKey: getAuthEnvironmentKey(),
          casesById: shapeRepairCases(state.casesById ?? {}),
          conflictsById: shapeRepairConflicts(state.conflictsById ?? {}),
          criteriaByCase: state.criteriaByCase ?? {},
          productsByCase: state.productsByCase ?? {},
          complianceByCase: state.complianceByCase ?? {},
        } as CrmCasesState;
      },
      partialize: (state) => ({
        storageEnvironmentKey: state.storageEnvironmentKey,
        casesById: state.casesById,
        conflictsById: state.conflictsById,
        criteriaByCase: state.criteriaByCase,
        productsByCase: state.productsByCase,
        complianceByCase: state.complianceByCase,
      }),
      onRehydrateStorage: () => () => signalStoreHydrated('cases'),
    }
  )
);
signalStoreHydrated('cases');

export function getCrmCasesStore(): typeof useCrmCasesStore {
  return useCrmCasesStore;
}

registerCasesReadBus({
  caseIdsReferencingClient: (clientId) => {
    const hits: string[] = [];
    for (const c of Object.values(useCrmCasesStore.getState().casesById)) {
      if (c.applicants.some((a) => a.clientId === clientId)) hits.push(c.id);
    }
    return hits;
  },
});

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    const state = useCrmCasesStore.getState();
    if (!environmentMatches(state)) {
      useCrmCasesStore.setState(emptyState());
      console.warn(
        '[casesStore] Cleared persisted cases after API environment changed.'
      );
    }
  });
}

function shapeRepairCases(raw: Record<string, unknown>): Record<CaseId, Case> {
  const out: Record<CaseId, Case> = {};
  for (const [id, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const c = val as Case;
    if (
      typeof c.id !== 'string' ||
      typeof c.stage !== 'string' ||
      !STAGE_MAP[c.stage]
    ) {
      console.warn(
        `[casesStore] Dropping unknown case shape at id=${id} during migrate.`
      );
      continue;
    }
    out[id] = { ...c, schemaVersion: CRM_SCHEMA_VERSION };
  }
  return out;
}

function shapeRepairConflicts(
  raw: Record<string, unknown>
): Record<ConflictId, ConflictRecord> {
  const out: Record<ConflictId, ConflictRecord> = {};
  for (const [id, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const r = val as ConflictRecord;
    if (
      typeof r.id !== 'string' ||
      typeof r.caseId !== 'string' ||
      typeof r.clientId !== 'string' ||
      !Array.isArray(r.values)
    ) {
      console.warn(
        `[casesStore] Dropping unknown conflict shape at id=${id} during migrate.`
      );
      continue;
    }
    // Validate the value.source shape on every entry — a garbled source means
    // downstream (documents flip, stream evidence) will silently target the
    // wrong artefact.
    const validValues = r.values.every(
      (v) =>
        v &&
        typeof v === 'object' &&
        v.value &&
        typeof v.value === 'object' &&
        typeof (v.value as { t?: unknown }).t === 'string' &&
        v.source &&
        typeof v.source === 'object' &&
        typeof (v.source as { kind?: unknown }).kind === 'string'
    );
    if (!validValues) {
      console.warn(
        `[casesStore] Dropping conflict with invalid value.source shape at id=${id}.`
      );
      continue;
    }
    out[id] = { ...r, schemaVersion: CRM_SCHEMA_VERSION };
  }
  return out;
}

function findConflictField(
  c: Case | undefined,
  clientId: ClientId,
  section: FactFindSectionKey,
  fieldKey: string
): FactFindField | undefined {
  if (!c) return undefined;
  const a = c.applicants.find((x) => x.clientId === clientId);
  return a ? findFactFindField(a, section, fieldKey) : undefined;
}

function describeFieldValue(v: FieldValue): string {
  switch (v.t) {
    case 'money':
      return `£${(v.v / 100).toFixed(2)}`;
    case 'text':
    case 'select':
    case 'date':
      return v.v;
    case 'number':
      return String(v.v);
    case 'toggle':
      return v.v ? 'yes' : 'no';
    case 'missing':
      return '—';
  }
}

function fieldValuesEqual(a: FieldValue, b: FieldValue): boolean {
  if (a.t !== b.t) return false;
  if (a.t === 'missing') return true;
  return (a as { v: unknown }).v === (b as { v: unknown }).v;
}
