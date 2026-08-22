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

// FR-011/12/13: the fifth persisted CRM store, holding the artifact-log fold's
// durable state. The fold (see ./caseLogFold) is the only writer; this module
// owns the state shape, the house persist checklist, and the quarantine cap +
// tombstone bookkeeping. Watermarks/pending/quarantine are DERIVED (rebuildable
// by refolding); the outbox is SOURCE and survives an environment-key wipe.

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  CaseId,
  CaseLogEntry,
  DecimalSeq,
} from '../agentContracts/caseLog';
import type { GateId } from '../agentContracts/gates';
import type { FoldReasonCode } from '../agentContracts/reasonCodes';

export const CRM_EVENTLOG_PERSIST_VERSION = 1;
export const CRM_EVENTLOG_STORE_KEY = 'crm-eventlog-store';

// FR-012: retained quarantine pointers are capped; overflow leaves a permanent
// tombstone. The preview embedded in a record is itself bounded (≤ 16 KB).
export const QUARANTINE_RETAINED_CAP = 200;
export const QUARANTINE_PREVIEW_MAX_BYTES = 16 * 1024;

export type SourceStatus = 'never' | 'live' | 'stale' | 'failed' | 'no-project';

export interface QuarantineRecord {
  id: string; // 'quarantine' prefix
  caseId?: CaseId;
  artifactId: string;
  artifactVersion: string;
  contentHash: string;
  reasonCode: FoldReasonCode;
  kindSeen: string;
  preview: string; // ≤ QUARANTINE_PREVIEW_MAX_BYTES
  at: number;
}

export interface QuarantineTombstone {
  hash: string;
  kind: string;
  at: number;
}

export type OutboxState = 'queued' | 'flushed' | 'settled';

export interface OutboxRecord {
  id: string; // 'outbox' prefix
  caseId: CaseId;
  entryCandidate: Omit<CaseLogEntry, 'seq' | 'prevHash' | 'hash'>;
  settleHash: string;
  state: OutboxState;
  queuedAt: number;
  flushedAt?: number;
  settledAt?: number;
}

export interface CaseAnomalies {
  duplicateSeq: number;
  oversize: number;
}

export interface CaseFreshness {
  lastFoldedAt: number;
  sourceStatus: SourceStatus;
}

export interface CaseHalt {
  reasonCode: FoldReasonCode;
  atSeq: DecimalSeq;
}

// The verified tip of a case's chain: the last applied/advanced entry. Seeds
// prevHash linkage for the next incremental delta and feeds the export v2
// envelope's `chainHead`. DERIVED — rebuilt by a refold.
export interface ChainHead {
  seq: DecimalSeq;
  hash: string;
}

// A gate raised by an agent and mirrored here so the Today queue can render it
// without a live subscription per row (FR-008). The ONE live approval
// subscription (subscribeOpenGate) attaches only to the open card; every other
// row reads this persisted mirror. `projectId`/`approvalId` locate the edge
// approval the card resolves; `draftFull`/`disclosureRef`/`reasons` are the
// provenance the card renders. Keyed by a deterministic instance id so a
// re-raise of the same gate supersedes rather than duplicates.
export interface MirroredGate {
  id: string;
  gateId: GateId;
  caseId: CaseId;
  projectId: string;
  approvalId: string;
  title: string;
  draftFull?: string;
  disclosureRef?: string;
  reasons: string[];
  raisedAt: number;
  status: 'open' | 'resolved';
  decision?: string;
  resolvedAt?: number;
  /**
   * True when the adviser changed the draft before approving. Feeds the
   * "% drafts approved unedited" leading metric (FR-022); absent until a gate
   * with an editable draft is resolved (finding 5/21).
   */
  edited?: boolean;
}

// The single-setState patch the fold hands to `applyCaseFold` for one touched
// case. Everything is optional so a fold that only buffers (no apply) or only
// quarantines still lands in one write.
export interface CaseFoldPatch {
  caseId: CaseId;
  watermark?: DecimalSeq;
  chainHead?: ChainHead;
  pending?: CaseLogEntry[];
  quarantineAdditions?: QuarantineRecord[];
  // When true, this case's existing retained quarantine records are dropped
  // before the additions land (a T4 refold-from-zero re-evaluates them).
  clearCaseQuarantine?: boolean;
  anomalies?: CaseAnomalies;
  halted?: CaseHalt | null;
  freshness?: CaseFreshness;
  contractsVersion?: number;
}

type EventLogData = Pick<
  CrmEventLogState,
  | 'storageEnvironmentKey'
  | 'contractsVersion'
  | 'watermarks'
  | 'chainHeads'
  | 'pendingByCase'
  | 'quarantine'
  | 'quarantineTombstones'
  | 'quarantineEverCount'
  | 'outbox'
  | 'anomalies'
  | 'freshness'
  | 'haltedCases'
  | 'openGates'
>;

export interface CrmEventLogState {
  storageEnvironmentKey: string;
  contractsVersion: number;
  watermarks: Record<CaseId, DecimalSeq>;
  chainHeads: Record<CaseId, ChainHead>; // DERIVED
  pendingByCase: Record<CaseId, CaseLogEntry[]>; // DERIVED, NOT persisted
  quarantine: QuarantineRecord[];
  quarantineTombstones: QuarantineTombstone[]; // PERMANENT
  quarantineEverCount: number; // cumulative, monotonic
  outbox: OutboxRecord[]; // SOURCE
  anomalies: Record<CaseId, CaseAnomalies>;
  freshness: Record<CaseId, CaseFreshness>;
  haltedCases: Record<CaseId, CaseHalt>;
  openGates: Record<string, MirroredGate>; // keyed by MirroredGate.id

  applyCaseFold: (patch: CaseFoldPatch) => void;
  setCaseFreshness: (caseId: CaseId, freshness: CaseFreshness) => void;
  setContractsVersion: (version: number) => void;
  enqueueOutbox: (record: OutboxRecord) => void;
  updateOutbox: (
    id: string,
    change: Partial<Pick<OutboxRecord, 'state' | 'flushedAt' | 'settledAt'>>
  ) => void;
  mirrorOpenGate: (gate: MirroredGate) => void;
  resolveMirroredGate: (
    id: string,
    decision: string,
    at: number,
    opts?: { edited?: boolean }
  ) => void;
  resetForTests: () => void;
}

const emptyData = (): EventLogData => ({
  storageEnvironmentKey: getAuthEnvironmentKey(),
  contractsVersion: 0,
  watermarks: {},
  chainHeads: {},
  pendingByCase: {},
  quarantine: [],
  quarantineTombstones: [],
  quarantineEverCount: 0,
  outbox: [],
  anomalies: {},
  freshness: {},
  haltedCases: {},
  openGates: {},
});

const environmentMatches = (
  state: Partial<CrmEventLogState> | undefined
): boolean => state?.storageEnvironmentKey === getAuthEnvironmentKey();

// Enforce the retained-quarantine cap: evict the oldest records (by `at`) until
// within cap, converting each evicted record into a permanent tombstone. The
// ever-count is monotonic and is NOT touched here (eviction never lowers it).
function capQuarantine(
  quarantine: QuarantineRecord[],
  tombstones: QuarantineTombstone[]
): {
  quarantine: QuarantineRecord[];
  quarantineTombstones: QuarantineTombstone[];
} {
  if (quarantine.length <= QUARANTINE_RETAINED_CAP) {
    return { quarantine, quarantineTombstones: tombstones };
  }
  const sorted = [...quarantine].sort((a, b) => a.at - b.at);
  const overflow = sorted.length - QUARANTINE_RETAINED_CAP;
  const evicted = sorted.slice(0, overflow);
  const retained = sorted.slice(overflow);
  const nextTombstones = [
    ...tombstones,
    ...evicted.map((r) => ({
      hash: r.contentHash,
      kind: r.kindSeen,
      at: r.at,
    })),
  ];
  return { quarantine: retained, quarantineTombstones: nextTombstones };
}

export const useCrmEventLogStore = create<CrmEventLogState>()(
  persist(
    (set) => ({
      ...emptyData(),

      applyCaseFold: (patch) =>
        set((state) => {
          const next: Partial<CrmEventLogState> = {};

          if (patch.watermark !== undefined) {
            next.watermarks = {
              ...state.watermarks,
              [patch.caseId]: patch.watermark,
            };
          }

          if (patch.chainHead !== undefined) {
            next.chainHeads = {
              ...state.chainHeads,
              [patch.caseId]: patch.chainHead,
            };
          }

          if (patch.pending !== undefined) {
            next.pendingByCase = { ...state.pendingByCase };
            if (patch.pending.length === 0) {
              delete next.pendingByCase[patch.caseId];
            } else {
              next.pendingByCase[patch.caseId] = patch.pending;
            }
          }

          const additions = patch.quarantineAdditions ?? [];
          if (patch.clearCaseQuarantine || additions.length) {
            // A refold drops the case's own retained records first (each leaves
            // a tombstone), then the fresh additions land. everCount is
            // monotonic — it only ever climbs by the count of new additions.
            let retained = state.quarantine;
            let tombstones = state.quarantineTombstones;
            if (patch.clearCaseQuarantine) {
              const dropped = retained.filter((r) => r.caseId === patch.caseId);
              retained = retained.filter((r) => r.caseId !== patch.caseId);
              tombstones = [
                ...tombstones,
                ...dropped.map((r) => ({
                  hash: r.contentHash,
                  kind: r.kindSeen,
                  at: r.at,
                })),
              ];
            }
            const capped = capQuarantine(
              [...retained, ...additions],
              tombstones
            );
            next.quarantine = capped.quarantine;
            next.quarantineTombstones = capped.quarantineTombstones;
            if (additions.length) {
              next.quarantineEverCount =
                state.quarantineEverCount + additions.length;
            }
          }

          if (patch.anomalies !== undefined) {
            next.anomalies = {
              ...state.anomalies,
              [patch.caseId]: patch.anomalies,
            };
          }

          if (patch.halted !== undefined) {
            const haltedCases = { ...state.haltedCases };
            if (patch.halted === null) {
              delete haltedCases[patch.caseId];
            } else {
              haltedCases[patch.caseId] = patch.halted;
            }
            next.haltedCases = haltedCases;
          }

          if (patch.freshness !== undefined) {
            next.freshness = {
              ...state.freshness,
              [patch.caseId]: patch.freshness,
            };
          }

          if (patch.contractsVersion !== undefined) {
            next.contractsVersion = patch.contractsVersion;
          }

          return next;
        }),

      setCaseFreshness: (caseId, freshness) =>
        set((state) => ({
          freshness: { ...state.freshness, [caseId]: freshness },
        })),

      setContractsVersion: (version) => set({ contractsVersion: version }),

      enqueueOutbox: (record) =>
        set((state) => ({ outbox: [...state.outbox, record] })),

      updateOutbox: (id, change) =>
        set((state) => ({
          outbox: state.outbox.map((r) =>
            r.id === id ? { ...r, ...change } : r
          ),
        })),

      mirrorOpenGate: (gate) =>
        set((state) => ({
          openGates: { ...state.openGates, [gate.id]: gate },
        })),

      resolveMirroredGate: (id, decision, at, opts) =>
        set((state) => {
          const existing = state.openGates[id];
          if (!existing) return {};
          return {
            openGates: {
              ...state.openGates,
              [id]: {
                ...existing,
                status: 'resolved',
                decision,
                resolvedAt: at,
                ...(opts?.edited !== undefined ? { edited: opts.edited } : {}),
              },
            },
          };
        }),

      resetForTests: () => set(emptyData()),
    }),
    {
      name: CRM_EVENTLOG_STORE_KEY,
      version: CRM_EVENTLOG_PERSIST_VERSION,
      migrate: (persistedState) => {
        const state = persistedState as Partial<CrmEventLogState> | undefined;
        if (!state) return persistedState as CrmEventLogState;
        // FR-013: an environment-key change wipes DERIVED projection state but
        // MUST NOT destroy the unflushed outbox (its records are the only copy
        // of local edits not yet settled by the backend).
        if (!environmentMatches(state)) {
          const survivingOutbox = Array.isArray(state.outbox)
            ? state.outbox.filter((r) => r.state !== 'settled')
            : [];
          return {
            ...emptyData(),
            outbox: survivingOutbox,
          } as CrmEventLogState;
        }
        // Same-environment rehydrate: shape-repair each field and re-cap the
        // retained quarantine (a lowered cap across builds must be honoured).
        const capped = capQuarantine(
          Array.isArray(state.quarantine) ? state.quarantine : [],
          Array.isArray(state.quarantineTombstones)
            ? state.quarantineTombstones
            : []
        );
        return {
          ...emptyData(),
          ...state,
          storageEnvironmentKey: getAuthEnvironmentKey(),
          contractsVersion:
            typeof state.contractsVersion === 'number'
              ? state.contractsVersion
              : 0,
          watermarks: state.watermarks ?? {},
          chainHeads: state.chainHeads ?? {},
          pendingByCase: {}, // DERIVED, never rehydrated from persist
          quarantine: capped.quarantine,
          quarantineTombstones: capped.quarantineTombstones,
          quarantineEverCount:
            typeof state.quarantineEverCount === 'number'
              ? state.quarantineEverCount
              : 0,
          outbox: Array.isArray(state.outbox) ? state.outbox : [],
          anomalies: state.anomalies ?? {},
          freshness: state.freshness ?? {},
          haltedCases: state.haltedCases ?? {},
          openGates: state.openGates ?? {},
        } as CrmEventLogState;
      },
      partialize: (state) => ({
        storageEnvironmentKey: state.storageEnvironmentKey,
        contractsVersion: state.contractsVersion,
        watermarks: state.watermarks,
        chainHeads: state.chainHeads,
        // pendingByCase is DERIVED — deliberately excluded from persist.
        quarantine: state.quarantine,
        quarantineTombstones: state.quarantineTombstones,
        quarantineEverCount: state.quarantineEverCount,
        outbox: state.outbox,
        anomalies: state.anomalies,
        freshness: state.freshness,
        haltedCases: state.haltedCases,
        openGates: state.openGates,
      }),
    }
  )
);

export function getCrmEventLogStore(): typeof useCrmEventLogStore {
  return useCrmEventLogStore;
}

if (typeof queueMicrotask === 'function') {
  queueMicrotask(() => {
    const state = useCrmEventLogStore.getState();
    if (!environmentMatches(state)) {
      const survivingOutbox = state.outbox.filter((r) => r.state !== 'settled');
      useCrmEventLogStore.setState({
        ...emptyData(),
        outbox: survivingOutbox,
      });
      console.warn(
        '[eventLogStore] Cleared derived fold state after API environment changed; unflushed outbox preserved.'
      );
    }
  });
}
