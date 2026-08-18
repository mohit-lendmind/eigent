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

/**
 * A run parked on a durable recovery label. Not a terminal — the run keeps the
 * Project's active-run slot and a terminal still follows if one resolves it —
 * which is why it rides beside `status` rather than as another value of it: a
 * client that does not know this kind still renders the run as busy, exactly as
 * it did before the kind existed.
 */
export interface RunRecoveryState {
  /** The durable label, verbatim (e.g. `blocked_poison_event`). */
  label: string;
  /** Why the run parked, verbatim from the event. */
  detail?: string;
  /**
   * True only where waiting is the wrong advice: nothing moves until an
   * operator requeues or tombstones the quarantined record. The other labels
   * settle on their own, and a surface that could not tell them apart would
   * either page an operator over a transient wait or leave a stuck run to a
   * spinner nobody is watching.
   */
  blocking: boolean;
  sequence: string;
}

/**
 * The latest admission-chain stage the worker announced (`dispatching`,
 * `workspace_ready`, `starting` — an OPEN set; render the string). Never
 * cleared: staleness is decided by the reader (the pre-content indicator
 * stops rendering once the run has renderable output), because the stages
 * end with the run's first real event, not with an un-announce.
 */
export interface RunProgressState {
  stage: string;
  detail?: string;
  sequence: string;
}

export interface RunState {
  runId: string;
  status: RunUIStatus;
  runEpoch?: string;
  /** Set by run_progress while the run is still being dispatched. */
  progress?: RunProgressState;
  /** run_failed reason code / run_cancelled reason, verbatim from the event. */
  outcomeReason?: string;
  /** run_completed summary or run_failed message, verbatim from the event. */
  outcomeDetail?: string;
  /**
   * Set while parked, cleared by the next event on this run. The stream moving
   * again IS the proof the park ended: leaving a label writes only the run row,
   * so there is no un-park event to wait for and a banner that waited for one
   * would outlive the condition it describes.
   */
  recovery?: RunRecoveryState;
}

export interface ToolResultState {
  sequence: string;
  content: string;
  isError: boolean;
}

export type WorkerUIStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  /** Started, and the run ended without this worker's end ever arriving. */
  | 'unknown';

/**
 * One worker in a run's fan-out. Both lifecycle events are forwarded
 * non-blocking upstream, so a start can arrive with no end and an end with no
 * start; and an ephemeral (non-persisted) spawn carries no child session id at
 * all, which leaves the worker unidentifiable and therefore unpairable. Each
 * of those is recorded as what it is rather than smoothed into a clean pair.
 */
export interface WorkerState {
  /** Stable key within the project; identity when known, else the start's sequence. */
  workerKey: string;
  runId: string;
  /** Empty for an ephemeral spawn: such a worker can only be reported as started. */
  childSessionId: string;
  role?: string;
  name?: string;
  status: WorkerUIStatus;
  /** The child's engine outcome reason, verbatim, once its end is observed. */
  reason?: string;
  /** Set when the child ended in error. */
  error?: string;
  /** Absent when only the end was observed — the start was dropped in transit. */
  startedSequence?: string;
  endedSequence?: string;
}

export type TimelineEntry =
  // `reasoning` is the thinking trace accompanying the text, accumulated with
  // the same append semantics; absent when the model streamed none.
  | { type: 'text'; runId: string; sequence: string; text: string; reasoning?: string }
  | {
      type: 'tool';
      runId: string;
      sequence: string;
      toolCallId: string;
      toolName: string;
      argumentsJson: string;
      /**
       * Live stdout/stderr accumulated from tool_output chunks while the tool
       * runs, in arrival order (how a terminal would show it). The final
       * `result.content` is the authoritative settled output; this buffer is
       * what existed before settlement and is kept afterwards so a surface
       * can keep showing the stream it already rendered.
       */
      liveOutput?: string;
      /** True once any chunk reported the per-tool retention cap was hit. */
      liveOutputTruncated?: boolean;
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
  // Where a worker joined the run. The lane's own state lives in `workers` and
  // keeps changing after this point, so the entry carries only the key.
  | { type: 'worker'; runId: string; sequence: string; workerKey: string }
  // Where the run parked. Kept in the timeline even once the run moves again,
  // because a run that stalled and recovered did not have the same history as
  // one that never stalled.
  | {
      type: 'recovery';
      runId: string;
      sequence: string;
      label: string;
      detail?: string;
      blocking: boolean;
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

/**
 * The reserved artifact-name prefix that marks a browser viewfinder frame.
 * Mirrors aion's `engine.BrowserFrameArtifactPrefix`: the object itself is
 * content-addressed, so this name is the only place a frame is distinguishable
 * from a report the agent deliberately wrote.
 */
export const BROWSER_FRAME_ARTIFACT_PREFIX = 'aion-browser-frame-';

/** One viewfinder frame, as named by the event that published it. */
export interface BrowserFrame {
  artifactId: string;
  runId: string;
  sequence: string;
  name: string;
}

export interface TodoEvidenceRef {
  kind: string;
  ref: string;
}

/**
 * One step of the plan the agent wrote down. The map is keyed by todoId and
 * relies on Record insertion order for creation order; parentId links children
 * to the step they decompose. An update or close arriving without a prior
 * create still materializes the row — title and parent_id ride every
 * transition for exactly that late-joiner case.
 */
export interface TodoState {
  todoId: string;
  title: string;
  /** Open set; this contract version emits pending | in_progress | done | cancelled. */
  status: string;
  priorStatus?: string;
  parentId?: string;
  /** Meaningful on parents: sequential | parallel | any. */
  childExecution?: string;
  assignee?: string;
  dependsOn?: string[];
  requiresApproval?: boolean;
  evidence?: TodoEvidenceRef[];
  closingOutcome?: string;
  /** True once todo_closed arrived; status then carries done | cancelled. */
  closed: boolean;
  runId: string;
  /** Sequence of the last transition applied to this row. */
  sequence: string;
}

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
  /**
   * The browser viewfinder, oldest first. Kept apart from `timeline` because
   * frames are produced by the tool layer after every browser action rather
   * than by anything the agent decided to say, and tens of them interleaved
   * into a transcript would bury the run they are a picture of.
   */
  browserFrames: BrowserFrame[];
  /** The run fan-out, keyed by WorkerState.workerKey, in observation order. */
  workers: Record<string, WorkerState>;
  /**
   * The plan, keyed by todoId in creation order. Folded from todo_* events;
   * on an edge older than 1.20 the kinds never arrive and this stays empty,
   * which is the whole degradation story (see supportsTodoEvents).
   */
  todos: Record<string, TodoState>;
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
    browserFrames: [],
    workers: {},
    todos: {},
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

/** Evidence accumulates on the row server-side, so each event carries the
 * whole set; undefined (absent key) means "no change", never "cleared". */
function todoEvidenceList(value: unknown): TodoEvidenceRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const refs: TodoEvidenceRef[] = [];
  for (const item of value) {
    if (item && typeof item === 'object') {
      const kind = str((item as Record<string, unknown>).kind);
      const ref = str((item as Record<string, unknown>).ref);
      if (kind && ref) refs.push({ kind, ref });
    }
  }
  return refs.length > 0 ? refs : undefined;
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
    browserFrames: [...state.browserFrames],
    workers: { ...state.workers },
    todos: { ...state.todos },
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

  // Any other event on a parked run is that run producing again, which is the
  // only signal that the park is over — including a terminal, since parking
  // does not preclude one. Clearing here rather than per-case means a kind this
  // build has never heard of still lifts the banner.
  const parked = next.runs[runId];
  if (parked?.recovery && event.kind !== 'run_recovery') {
    const { recovery: _cleared, ...moving } = parked;
    next.runs[runId] = moving;
  }

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
      const reasoning = str(data.reasoning) ?? '';
      const last = next.timeline[next.timeline.length - 1];
      if (last && last.type === 'text' && last.runId === runId) {
        const merged = (last.reasoning ?? '') + reasoning;
        next.timeline[next.timeline.length - 1] = {
          ...last,
          sequence,
          text: last.text + text,
          ...(merged ? { reasoning: merged } : {}),
        };
      } else {
        next.timeline.push({
          type: 'text',
          runId,
          sequence,
          text,
          ...(reasoning ? { reasoning } : {}),
        });
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
    // The three plan kinds fold into `todos` and leave no timeline entry: the
    // Plan panel owns rendering them, and a transcript row per status flip
    // would bury the conversation under its own bookkeeping.
    case 'todo_created':
    case 'todo_updated':
    case 'todo_closed': {
      const todoId = str(data.todo_id);
      if (!todoId) {
        return next;
      }
      const existing = next.todos[todoId];
      const evidence = todoEvidenceList(data.evidence);
      const row: TodoState = {
        // Merge onto what we knew: a transition carries title/parent_id but
        // not the create-only fields, and those must survive the update.
        ...(existing ?? {}),
        todoId,
        title: str(data.title) ?? existing?.title ?? '',
        status: str(data.status) ?? existing?.status ?? '',
        closed: event.kind === 'todo_closed' || (existing?.closed ?? false),
        runId,
        sequence,
      };
      const priorStatus = str(data.prior_status);
      if (priorStatus !== undefined) row.priorStatus = priorStatus;
      const parentId = str(data.parent_id);
      if (parentId) row.parentId = parentId;
      if (event.kind === 'todo_created') {
        const childExecution = str(data.child_execution);
        if (childExecution) row.childExecution = childExecution;
        const assignee = str(data.assignee);
        if (assignee) row.assignee = assignee;
        if (Array.isArray(data.depends_on)) {
          const deps = data.depends_on.filter((d): d is string => typeof d === 'string');
          if (deps.length > 0) row.dependsOn = deps;
        }
        if (data.requires_approval === true) row.requiresApproval = true;
      }
      if (evidence) row.evidence = evidence;
      const closingOutcome = str(data.closing_outcome);
      if (closingOutcome) row.closingOutcome = closingOutcome;
      next.todos[todoId] = row;
      return next;
    }
    case 'artifact_created': {
      const artifact =
        typeof data.artifact === 'object' && data.artifact !== null && !Array.isArray(data.artifact)
          ? (data.artifact as Record<string, unknown>)
          : {};
      const artifactId = str(artifact.artifact_id) ?? `seq-${sequence}`;
      next.artifacts[artifactId] = artifact;
      const name = str(artifact.name) ?? '';
      if (name.startsWith(BROWSER_FRAME_ARTIFACT_PREFIX)) {
        next.browserFrames.push({ artifactId, runId, sequence, name });
        return next;
      }
      next.timeline.push({ type: 'artifact', runId, sequence, artifact });
      return next;
    }
    case 'subagent_started': {
      const childSessionId = str(data.child_session_id) ?? '';
      // An ephemeral spawn has no identity to pair an end against, so it gets
      // a key nothing can ever match — that worker stays "started" honestly
      // rather than borrowing another worker's end.
      const workerKey = childSessionId
        ? `${runId}#${childSessionId}`
        : `${runId}#seq-${sequence}`;
      const existing = next.workers[workerKey];
      next.workers[workerKey] = {
        ...existing,
        workerKey,
        runId,
        childSessionId,
        role: str(data.role),
        name: str(data.name),
        status: existing?.status ?? 'running',
        startedSequence: existing?.startedSequence ?? sequence,
      };
      if (!existing) {
        next.timeline.push({ type: 'worker', runId, sequence, workerKey });
      }
      return next;
    }
    case 'subagent_ended': {
      const childSessionId = str(data.child_session_id) ?? '';
      const error = str(data.error) ?? '';
      // An end whose start was dropped still proves the worker existed, so it
      // opens its own lane rather than being discarded as unmatched.
      const workerKey = childSessionId ? `${runId}#${childSessionId}` : `${runId}#seq-${sequence}`;
      const existing = next.workers[workerKey];
      next.workers[workerKey] = {
        ...existing,
        workerKey,
        runId,
        childSessionId,
        role: str(data.role) ?? existing?.role,
        name: existing?.name,
        status: error ? 'failed' : 'succeeded',
        reason: str(data.reason),
        error: error || undefined,
        endedSequence: sequence,
      };
      if (!existing) {
        next.timeline.push({ type: 'worker', runId, sequence, workerKey });
      }
      return next;
    }
    case 'run_progress': {
      // Dispatch narration: run-state only, no timeline entry. The stages
      // describe the wait before the run's first real content, so a timeline
      // row would survive as clutter exactly when it stopped meaning anything.
      const stage = str(data.stage) ?? '';
      if (!stage) {
        return next;
      }
      const existing = next.runs[runId] ?? { runId, status: 'running' as RunUIStatus };
      next.runs[runId] = {
        ...existing,
        progress: { stage, detail: str(data.detail), sequence },
      };
      return next;
    }
    case 'tool_output': {
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
        // No visible matching call (pre-snapshot, or the call event was
        // suppressed). Retained opaquely rather than invented or lost.
        next.timeline.push({ type: 'opaque', runId, sequence, kind: event.kind, event });
        return next;
      }
      const entry = next.timeline[index];
      if (entry.type === 'tool') {
        next.timeline[index] = {
          ...entry,
          sequence: entry.sequence,
          liveOutput: (entry.liveOutput ?? '') + (str(data.content) ?? ''),
          ...(data.truncated === true || entry.liveOutputTruncated
            ? { liveOutputTruncated: true }
            : {}),
        };
      }
      return next;
    }
    case 'run_recovery': {
      const label = str(data.label) ?? '';
      const existing = next.runs[runId] ?? { runId, status: 'running' as RunUIStatus };
      const recovery: RunRecoveryState = {
        label,
        detail: str(data.detail),
        blocking: data.blocking === true,
        sequence,
      };
      next.runs[runId] = { ...existing, recovery };
      next.timeline.push({
        type: 'recovery',
        runId,
        sequence,
        label,
        detail: recovery.detail,
        blocking: recovery.blocking,
      });
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
  // The run is over, so none of its workers is still running. One whose end
  // never arrived is reported as unknown — the truthful statement is that we
  // were not told how it finished, not that it is still working.
  for (const worker of Object.values(next.workers)) {
    if (worker.runId === runId && worker.status === 'running') {
      next.workers[worker.workerKey] = { ...worker, status: 'unknown' };
    }
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

/**
 * A run's workers in the order they were first observed. An empty result means
 * the run did not fan out — but only on a backend that reports the workforce
 * at all, so read it beside compat's supportsWorkforceEvents.
 */
export function workersForRun(
  state: ProjectUIState,
  runId: string
): WorkerState[] {
  return Object.values(state.workers)
    .filter((worker) => worker.runId === runId)
    .sort((a, b) =>
      compareSequence(
        a.startedSequence ?? a.endedSequence ?? '0',
        b.startedSequence ?? b.endedSequence ?? '0'
      )
    );
}

export function reduceProjectEvents(
  state: ProjectUIState,
  events: readonly ProjectEvent[]
): ProjectUIState {
  return events.reduce(reduceProjectEvent, state);
}
