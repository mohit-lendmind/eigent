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

// FR-022 — the three leading-indicator metrics the sales/PM deliverable pins:
// time-to-fact-find, % of drafts approved unedited, and adviser-minutes-saved.
// They are DERIVED from the same fold state the queue renders, never a separate
// telemetry pipe. The minutes-saved figure is a MODELED estimate: each metric
// carries its sample size so a reader can tell "0%" from "no data yet", and the
// two saving constants below are the documented per-event assumptions (see
// docs/compliance-one-pager.md), not measured wall-clock.

import { useCrmEventLogStore } from '../fold/eventLogStore';

// Modeled adviser time reclaimed per automated event. An onboarding welcome +
// document-request pack the agent drafts is ~12 adviser-minutes not spent typing;
// a watcher proposal is ~8 minutes of case review the adviser did not have to run
// by hand. These are estimates for the leading dashboard, revisited with real
// timing data post-M2.
export const MINUTES_SAVED_PER_DRAFT = 12;
export const MINUTES_SAVED_PER_WATCHER_DECISION = 8;

export interface DraftOutcome {
  raisedAt: number;
  /** Set once the adviser approved & sent; absent while the gate is still open. */
  approvedAt?: number;
  /** True when the adviser changed the draft before approving. */
  edited?: boolean;
}

export interface FactFindSpan {
  startedAt: number;
  /** Set once the fact-find reached "ready"; absent while still incomplete. */
  readyAt?: number;
}

export interface LeadingMetricInputs {
  drafts?: DraftOutcome[];
  factFind?: FactFindSpan[];
  /** Count of watcher proposals surfaced (each stands in for a manual review). */
  watcherDecisions?: number;
}

export interface LeadingMetrics {
  /** Median case start → fact-find-ready, in ms; null when no case completed. */
  timeToFactFindMs: number | null;
  /** Share of approved drafts sent without an edit; null when none approved. */
  draftsApprovedUneditedPct: number | null;
  /** Modeled adviser minutes reclaimed across drafts + watcher proposals. */
  adviserMinutesSaved: number;
  sampleSizes: { drafts: number; factFind: number; watcherDecisions: number };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Pure core: leading-indicator inputs in, the three metrics out (FR-022). */
export function computeLeadingMetrics(
  inputs: LeadingMetricInputs
): LeadingMetrics {
  const drafts = inputs.drafts ?? [];
  const factFind = inputs.factFind ?? [];
  const watcherDecisions = inputs.watcherDecisions ?? 0;

  const factFindDurations = factFind
    .filter((f) => f.readyAt !== undefined)
    .map((f) => f.readyAt! - f.startedAt);

  const approved = drafts.filter((d) => d.approvedAt !== undefined);
  const unedited = approved.filter((d) => d.edited !== true);
  const draftsApprovedUneditedPct =
    approved.length === 0
      ? null
      : Math.round((unedited.length / approved.length) * 100);

  const adviserMinutesSaved =
    approved.length * MINUTES_SAVED_PER_DRAFT +
    watcherDecisions * MINUTES_SAVED_PER_WATCHER_DECISION;

  return {
    timeToFactFindMs: median(factFindDurations),
    draftsApprovedUneditedPct,
    adviserMinutesSaved,
    sampleSizes: {
      drafts: approved.length,
      factFind: factFindDurations.length,
      watcherDecisions,
    },
  };
}

/**
 * Live leading metrics, sourced from the durable fold. The G1 gate mirror is the
 * reliable draft signal (raised → resolved-with-allow = an approved send); the
 * fact-find spans and watcher-decision count are supplied by the caller when it
 * has them (the dashboard passes what it has folded).
 */
export function selectLeadingMetrics(
  extra: Pick<LeadingMetricInputs, 'factFind' | 'watcherDecisions'> = {}
): LeadingMetrics {
  const { openGates } = useCrmEventLogStore.getState();
  const drafts: DraftOutcome[] = Object.values(openGates)
    .filter((gate) => gate.gateId === 'G1')
    .map((gate) => ({
      raisedAt: gate.raisedAt,
      approvedAt:
        gate.status === 'resolved' && gate.decision === 'allow'
          ? gate.resolvedAt
          : undefined,
    }));
  return computeLeadingMetrics({ drafts, ...extra });
}
