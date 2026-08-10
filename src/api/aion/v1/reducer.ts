// The single UI event reducer for aion Projects (doc 10 §10 WP2): a pure,
// deterministic fold from the durable Project event stream to renderer state.
// Live tailing and cursor replay MUST reduce to identical state, so the
// reducer depends only on (state, event) — never on wall clock, connection
// state, or call site. Events already applied (sequence <= lastSequence) are
// dropped, which makes overlapping replay after reconnect idempotent.

import {
  KNOWN_EVENT_VISIBILITIES,
  type ProjectEvent,
} from './contracts';
import type { components } from './gen/edge-api';

type ProjectSnapshot = components['schemas']['ProjectSnapshot'];

export type RunUIStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export interface RunState {
  runId: string;
  status: RunUIStatus;
  runEpoch?: string;
  /** run_failed reason code / run_cancelled reason, verbatim from the event. */
  outcomeReason?: string;
  /** run_completed summary or run_failed message, verbatim from the event. */
  outcomeDetail?: string;
}

export interface ToolResultState {
  sequence: string;
  content: string;
  isError: boolean;
}

export type TimelineEntry =
  | { type: 'text'; runId: string; sequence: string; text: string }
  | {
      type: 'tool';
      runId: string;
      sequence: string;
      toolCallId: string;
      toolName: string;
      argumentsJson: string;
      result?: ToolResultState;
    }
  | {
      type: 'approval';
      runId: string;
      sequence: string;
      approvalId: string;
      toolCallId?: string;
      toolName?: string;
      reason?: string;
      argumentsJson?: string;
      decision?: string;
      resolvedBy?: string;
    }
  | {
      type: 'artifact';
      runId: string;
      sequence: string;
      artifact: Record<string, unknown>;
    }
  | {
      type: 'run_boundary';
      runId: string;
      sequence: string;
      status: RunUIStatus;
      kind: string;
      detail?: string;
    }
  // An event kind this client version does not know. Rendered opaquely; the
  // full decoded event is retained so nothing additive is lost.
  | { type: 'opaque'; runId: string; sequence: string; kind: string; event: ProjectEvent };

export interface ProjectUIState {
  projectId: string | null;
  /** Last applied event sequence — the resume cursor. "0" before any event. */
  lastSequence: string;
  /**
   * Sequence floor this state was rehydrated from ("0" for a from-scratch
   * reduction): timeline entries below it were never seen, by design.
   */
  rehydratedFrom: string;
  runs: Record<string, RunState>;
  activeRunId: string | null;
  timeline: TimelineEntry[];
  pendingApprovals: Record<
    string,
    { approvalId: string; runId: string; sequence: string; toolName?: string; reason?: string }
  >;
  artifacts: Record<string, Record<string, unknown>>;
  /** user-invisible (internal/audit/unknown-visibility) events applied. */
  suppressedEventCount: number;
  /** Sequence discontinuities observed (diagnostic; transport owns recovery). */
  gapCount: number;
}

export function initialProjectState(projectId?: string): ProjectUIState {
  return {
    projectId: projectId ?? null,
    lastSequence: '0',
    rehydratedFrom: '0',
    runs: {},
    activeRunId: null,
    timeline: [],
    pendingApprovals: {},
    artifacts: {},
    suppressedEventCount: 0,
    gapCount: 0,
  };
}

/**
 * Builds state from a Project snapshot after cursor expiry: the timeline
 * before last_sequence is intentionally absent, and the resume cursor is the
 * snapshot's last_sequence (events strictly after it replay gapless).
 */
export function stateFromSnapshot(snapshot: ProjectSnapshot): ProjectUIState {
  const state = initialProjectState(snapshot.project.project_id);
  state.lastSequence = snapshot.last_sequence;
  state.rehydratedFrom = snapshot.last_sequence;
  const run = snapshot.active_run;
  if (run) {
    state.runs = {
      [run.run_id]: {
        runId: run.run_id,
        status: runStatusToUI(run.status),
        runEpoch: run.run_epoch,
      },
    };
    state.activeRunId = run.run_id;
  }
  return state;
}

// Contract rendering policy (gen/meta.ts): unknown run status is busy, never
// terminal.
function runStatusToUI(status: string): RunUIStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'failed_final':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'accepted':
    case 'running':
    case 'awaiting_approval':
    case 'cancelling':
    case 'recovery':
      return 'running';
    default:
      return 'running';
  }
}

const knownVisibilities = new Set<string>(KNOWN_EVENT_VISIBILITIES);

function compareSequence(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Applies one decoded event. Pure: returns a new state object and never
 * mutates the input. Unknown kinds and visibilities follow the open-set
 * policy — retained, never dropped, never rendered as if understood.
 */
export function reduceProjectEvent(
  state: ProjectUIState,
  event: ProjectEvent
): ProjectUIState {
  // Already applied: an overlapping replay after reconnect returns the SAME
  // state object, so overlap is invisible — live and replayed reduction of
  // one event window are identical by construction.
  if (compareSequence(event.sequence, state.lastSequence) <= 0) {
    return state;
  }

  const next: ProjectUIState = {
    ...state,
    projectId: state.projectId ?? event.project_id,
    lastSequence: event.sequence,
    runs: { ...state.runs },
    timeline: [...state.timeline],
    pendingApprovals: { ...state.pendingApprovals },
    artifacts: { ...state.artifacts },
  };
  // The edge replays gapless from any admitted cursor (including a snapshot
  // floor), so anything but lastSequence+1 is a protocol anomaly. Recorded,
  // not repaired — the transport owns resubscription.
  if (BigInt(event.sequence) !== BigInt(state.lastSequence) + 1n) {
    next.gapCount += 1;
  }

  // Unknown visibility renders as internal (never shown), per the contract's
  // open-set policy; the event still advances the cursor.
  if (event.visibility !== 'user' || !knownVisibilities.has(event.visibility)) {
    next.suppressedEventCount += 1;
    return next;
  }

  const runId = event.run_id;
  const sequence = event.sequence;
  const data = event.data;

  switch (event.kind) {
    case 'run_accepted': {
      next.runs[runId] = {
        runId,
        status: 'running',
        runEpoch: str(data.run_epoch),
      };
      next.activeRunId = runId;
      next.timeline.push({
        type: 'run_boundary',
        runId,
        sequence,
        status: 'running',
        kind: event.kind,
      });
      return next;
    }
    case 'text_delta': {
      const text = str(data.text) ?? '';
      const last = next.timeline[next.timeline.length - 1];
      if (last && last.type === 'text' && last.runId === runId) {
        next.timeline[next.timeline.length - 1] = {
          ...last,
          sequence,
          text: last.text + text,
        };
      } else {
        next.timeline.push({ type: 'text', runId, sequence, text });
      }
      return next;
    }
    case 'tool_call': {
      next.timeline.push({
        type: 'tool',
        runId,
        sequence,
        toolCallId: str(data.tool_call_id) ?? '',
        toolName: str(data.tool_name) ?? '',
        argumentsJson: str(data.arguments_json) ?? '',
      });
      return next;
    }
    case 'tool_result': {
      const toolCallId = str(data.tool_call_id);
      const index = toolCallId
        ? next.timeline.findIndex(
            (entry) =>
              entry.type === 'tool' &&
              entry.toolCallId === toolCallId &&
              entry.result === undefined
          )
        : -1;
      if (index < 0) {
        // No visible matching call (e.g. the call happened before a snapshot
        // rehydrate floor). Retained opaquely rather than invented or lost.
        next.timeline.push({ type: 'opaque', runId, sequence, kind: event.kind, event });
        return next;
      }
      const entry = next.timeline[index];
      if (entry.type === 'tool') {
        next.timeline[index] = {
          ...entry,
          result: {
            sequence,
            content: str(data.content) ?? '',
            isError: data.is_error === true,
          },
        };
      }
      return next;
    }
    case 'approval_required': {
      const approvalId = str(data.approval_id) ?? '';
      next.timeline.push({
        type: 'approval',
        runId,
        sequence,
        approvalId,
        toolCallId: str(data.tool_call_id),
        toolName: str(data.tool_name),
        reason: str(data.reason),
        argumentsJson: str(data.arguments_json),
      });
      next.pendingApprovals[approvalId] = {
        approvalId,
        runId,
        sequence,
        toolName: str(data.tool_name),
        reason: str(data.reason),
      };
      return next;
    }
    case 'approval_resolved': {
      const approvalId = str(data.approval_id) ?? '';
      const index = next.timeline.findIndex(
        (entry) =>
          entry.type === 'approval' &&
          entry.approvalId === approvalId &&
          entry.decision === undefined
      );
      if (index < 0) {
        next.timeline.push({ type: 'opaque', runId, sequence, kind: event.kind, event });
        delete next.pendingApprovals[approvalId];
        return next;
      }
      const entry = next.timeline[index];
      if (entry.type === 'approval') {
        next.timeline[index] = {
          ...entry,
          decision: str(data.decision),
          resolvedBy: str(data.resolved_by),
        };
      }
      delete next.pendingApprovals[approvalId];
      return next;
    }
    case 'artifact_created': {
      const artifact =
        typeof data.artifact === 'object' && data.artifact !== null && !Array.isArray(data.artifact)
          ? (data.artifact as Record<string, unknown>)
          : {};
      const artifactId = str(artifact.artifact_id) ?? `seq-${sequence}`;
      next.artifacts[artifactId] = artifact;
      next.timeline.push({ type: 'artifact', runId, sequence, artifact });
      return next;
    }
    case 'run_completed':
      return settleRun(next, event, 'succeeded', undefined, str(data.summary));
    case 'run_failed':
      return settleRun(next, event, 'failed', str(data.reason), str(data.message));
    case 'run_cancelled':
      return settleRun(next, event, 'cancelled', str(data.reason), undefined);
    default: {
      next.timeline.push({
        type: 'opaque',
        runId,
        sequence,
        kind: event.kind,
        event,
      });
      return next;
    }
  }
}

function settleRun(
  next: ProjectUIState,
  event: ProjectEvent,
  status: RunUIStatus,
  outcomeReason: string | undefined,
  outcomeDetail: string | undefined
): ProjectUIState {
  const runId = event.run_id;
  const existing = next.runs[runId] ?? { runId, status: 'unknown' as RunUIStatus };
  next.runs[runId] = { ...existing, status, outcomeReason, outcomeDetail };
  if (next.activeRunId === runId) {
    next.activeRunId = null;
  }
  next.timeline.push({
    type: 'run_boundary',
    runId,
    sequence: event.sequence,
    status,
    kind: event.kind,
    detail: outcomeDetail ?? outcomeReason,
  });
  return next;
}

export function reduceProjectEvents(
  state: ProjectUIState,
  events: readonly ProjectEvent[]
): ProjectUIState {
  return events.reduce(reduceProjectEvent, state);
}
