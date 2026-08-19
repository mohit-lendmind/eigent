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

// Drives parked browser delegations through the local agent window. Fed by
// aionChatBridge's onState with each wave of `pendingBrowserDelegations`;
// executes strictly one action at a time per project (one window, one input
// stream), POSTs each result back, and keeps a completed-results LRU so a
// replayed or re-listed delegation re-POSTs the recorded result instead of
// re-driving the page. A result landing after the run stopped waiting
// converges as 409 delegation_not_pending — already-resolved, never a retry.

import type { PendingBrowserDelegation } from '@/api/aion/v1/reducer';
import type {
  BrowserDelegationList,
  BrowserDelegationResult,
} from '@/api/aion/v1/transport';
import { EdgeProblemError } from '@/api/aion/v1/problems';

/**
 * The main-process executor's in-band answer once the user closes the agent
 * window mid-run — the kill switch. The renderer cannot import the main
 * module, so this is a copy of its WINDOW_CLOSED_ERROR, pinned byte-equal by
 * a parity test; recognizing it is what turns a stream of failing actions
 * into one legible notice.
 */
export const LOCAL_BROWSER_WINDOW_CLOSED =
  'the user closed the agent browser window; wait, then re-observe the page before continuing';

export interface DelegationTransport {
  respondToBrowserDelegation(
    projectId: string,
    delegationId: string,
    result: BrowserDelegationResult
  ): Promise<void>;
  listPendingBrowserDelegations(
    projectId: string
  ): Promise<BrowserDelegationList>;
}

interface ExecuteRequest {
  delegationId: string;
  runId: string;
  toolName: string;
  argumentsJson: string;
  sessionMode: string;
}

interface ExecuteReply {
  success: boolean;
  result?: {
    resultJson: string;
    frameBase64?: string;
    frameName?: string;
    screenshotBase64?: string;
    screenshotName?: string;
  };
  error?: string;
}

interface ExecutorDeps {
  execute(request: ExecuteRequest): Promise<ExecuteReply>;
  delay(ms: number): Promise<void>;
  now(): number;
  /** Fired once per run when its window-closed kill switch trips. */
  onWindowClosed?(runId: string): void;
}

/** Executed delegations remembered for replay re-POSTs. */
const COMPLETED_LRU_CAP = 200;
const POST_ATTEMPTS = 3;

/**
 * Replay state is keyed per RUN, not per delegation id. A delegation id is
 * `bd-<sessionId>:<toolCallId>`, and a provider can mint the same tool_call_id
 * in two successive runs of one session — so the id repeats while naming a
 * different action. aion clears its own recorded results at StartRun for
 * exactly this reason; this is the desktop half of the same rule. Keyed on the
 * id alone, every action of a second run reads as already-answered, is never
 * executed, and parks until the server-side deadline expires.
 */
function replayKey(row: { runId: string; delegationId: string }): string {
  return `${row.runId}\u0000${row.delegationId}`;
}

interface ProjectLane {
  transport: DelegationTransport;
  queue: PendingBrowserDelegation[];
  /** Every set/map below is keyed by replayKey(row), never the bare id. */
  queued: Set<string>;
  inFlight: string | null;
  /** Executed → the recorded wire result; null when there is nothing to send
   * (the deadline had already passed, so the run has abandoned the action). */
  completed: Map<string, BrowserDelegationResult | null>;
  /** Keys whose POST reached a terminal answer (202 accepted or 4xx converged). */
  posted: Set<string>;
  pumping: boolean;
  rehydrated: boolean;
}

export class BrowserDelegationExecutor {
  private lanes = new Map<string, ProjectLane>();
  /** Runs whose window-closed notice already fired. */
  private windowClosedRuns = new Set<string>();

  constructor(private deps: ExecutorDeps) {}

  /**
   * One state wave from a project's event stream. Enqueues delegations not
   * yet seen, re-POSTs recorded results for executed-but-undelivered ones,
   * and drops queued work the run stopped waiting for.
   */
  notePending(
    projectId: string,
    transport: DelegationTransport,
    pending: Record<string, PendingBrowserDelegation>
  ): void {
    const lane = this.lane(projectId, transport);
    if (!lane.rehydrated) {
      // A rebuilt snapshot carries no pending state, so the first wave also
      // reads the list route once and merges what the stream missed.
      lane.rehydrated = true;
      void this.rehydrate(projectId, lane);
    }
    this.merge(projectId, lane, Object.values(pending));
    // The run settles a delegation (result, timeout, or terminal) by removing
    // its row; executing a removed row would drive the visible window for a
    // run that stopped listening.
    if (lane.queue.length > 0) {
      lane.queue = lane.queue.filter((row) => {
        if (pending[row.delegationId]) return true;
        lane.queued.delete(replayKey(row));
        return false;
      });
    }
  }

  private lane(projectId: string, transport: DelegationTransport): ProjectLane {
    let lane = this.lanes.get(projectId);
    if (!lane) {
      lane = {
        transport,
        queue: [],
        queued: new Set(),
        inFlight: null,
        completed: new Map(),
        posted: new Set(),
        pumping: false,
        rehydrated: false,
      };
      this.lanes.set(projectId, lane);
    } else {
      lane.transport = transport;
    }
    return lane;
  }

  private merge(
    projectId: string,
    lane: ProjectLane,
    rows: PendingBrowserDelegation[]
  ): void {
    for (const row of rows) {
      if (!row.delegationId) continue;
      const key = replayKey(row);
      if (
        lane.posted.has(key) ||
        lane.queued.has(key) ||
        lane.inFlight === key
      ) {
        continue;
      }
      if (lane.completed.has(key)) {
        // Executed already but the POST never landed — deliver the recorded
        // result, never re-drive the page.
        void this.post(projectId, lane, row);
        continue;
      }
      lane.queue.push(row);
      lane.queued.add(key);
    }
    if (!lane.pumping && lane.queue.length > 0) {
      lane.pumping = true;
      void this.pump(projectId, lane);
    }
  }

  private async rehydrate(projectId: string, lane: ProjectLane): Promise<void> {
    try {
      const list = await lane.transport.listPendingBrowserDelegations(projectId);
      const rows = (list.delegations ?? []).map((d) => ({
        delegationId: d.delegation_id,
        runId: d.run_id,
        sequence: '',
        toolCallId: d.tool_call_id,
        toolName: d.tool_name,
        argumentsJson: d.arguments_json,
        sessionMode: d.session_mode,
        deadlineAt: d.deadline_at,
      }));
      this.merge(projectId, lane, rows);
    } catch (error) {
      // The stream still announces every delegation; the list is a catch-up
      // read, so a failure costs only what a reload lost.
      console.warn('browser delegation rehydrate failed', error);
      lane.rehydrated = false;
    }
  }

  private async pump(projectId: string, lane: ProjectLane): Promise<void> {
    try {
      for (;;) {
        const row = lane.queue.shift();
        if (!row) return;
        lane.queued.delete(replayKey(row));
        lane.inFlight = replayKey(row);
        try {
          await this.executeOne(projectId, lane, row);
        } catch (error) {
          console.error('browser delegation execution failed', error);
        } finally {
          lane.inFlight = null;
        }
      }
    } finally {
      lane.pumping = false;
    }
  }

  private async executeOne(
    projectId: string,
    lane: ProjectLane,
    row: PendingBrowserDelegation
  ): Promise<void> {
    const deadline = Date.parse(row.deadlineAt);
    if (Number.isFinite(deadline) && this.deps.now() > deadline) {
      // The run abandoned this action before we got to it (a laptop waking
      // from sleep); a result would only converge as 409, and driving the
      // window for it would be visible motion nobody asked for.
      lane.completed.set(replayKey(row), null);
      lane.posted.add(replayKey(row));
      return;
    }
    const reply = await this.deps.execute({
      delegationId: row.delegationId,
      runId: row.runId,
      toolName: row.toolName,
      argumentsJson: row.argumentsJson,
      sessionMode: row.sessionMode,
    });
    let result: BrowserDelegationResult;
    if (reply.success && reply.result) {
      this.noteKillSwitch(row.runId, reply.result.resultJson);
      result = {
        result_json: reply.result.resultJson,
        ...(reply.result.frameBase64
          ? {
              frame_base64: reply.result.frameBase64,
              frame_name: reply.result.frameName,
            }
          : {}),
        ...(reply.result.screenshotBase64
          ? {
              screenshot_base64: reply.result.screenshotBase64,
              screenshot_name: reply.result.screenshotName,
            }
          : {}),
      };
    } else {
      // Executor-level failure (window plumbing, not the page): still a
      // result — in-band, so the model sees why instead of waiting out the
      // server-side deadline.
      result = {
        result_json: JSON.stringify({
          error: `the local browser executor failed: ${reply.error ?? 'unknown error'}`,
        }),
      };
    }
    lane.completed.set(replayKey(row), result);
    this.trimCompleted(lane);
    await this.post(projectId, lane, row);
  }

  /**
   * The window-closed NACK repeats on every remaining action of the run;
   * the user should hear about the kill switch exactly once.
   */
  private noteKillSwitch(runId: string, resultJson: string): void {
    if (!this.deps.onWindowClosed || this.windowClosedRuns.has(runId)) {
      return;
    }
    try {
      const parsed = JSON.parse(resultJson) as { error?: unknown };
      if (parsed.error === LOCAL_BROWSER_WINDOW_CLOSED) {
        this.windowClosedRuns.add(runId);
        this.deps.onWindowClosed(runId);
      }
    } catch {
      // Not JSON — not the kill switch.
    }
  }

  private trimCompleted(lane: ProjectLane): void {
    while (lane.completed.size > COMPLETED_LRU_CAP) {
      const oldest = lane.completed.keys().next().value as string;
      lane.completed.delete(oldest);
      lane.posted.delete(oldest);
    }
  }

  private async post(
    projectId: string,
    lane: ProjectLane,
    row: PendingBrowserDelegation
  ): Promise<void> {
    const key = replayKey(row);
    const result = lane.completed.get(key);
    if (!result || lane.posted.has(key)) return;
    for (let attempt = 1; attempt <= POST_ATTEMPTS; attempt++) {
      try {
        await lane.transport.respondToBrowserDelegation(
          projectId,
          row.delegationId,
          result
        );
        lane.posted.add(key);
        return;
      } catch (error) {
        if (error instanceof EdgeProblemError && error.problem.status < 500) {
          // 409 delegation_not_pending (the run settled first) and every
          // other 4xx: a retry re-sends the same bytes, so the answer stands.
          lane.posted.add(key);
          return;
        }
        if (attempt === POST_ATTEMPTS) {
          // Left un-posted deliberately: the next wave still naming this
          // delegation re-POSTs the recorded result.
          console.error('browser delegation result POST failed', error);
          return;
        }
        await this.deps.delay(1000 * attempt);
      }
    }
  }
}

function hostAPI(): Record<string, any> | undefined {
  return (globalThis as Record<string, any>).electronAPI;
}

export const browserDelegationExecutor = new BrowserDelegationExecutor({
  execute: async (request) => {
    const api = hostAPI();
    if (!api?.agentBrowserExecute) {
      return {
        success: false,
        error: 'the local browser executor is unavailable in this build',
      };
    }
    return api.agentBrowserExecute(request);
  },
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  onWindowClosed: () => {
    // Loaded on demand: the kill switch is rare, and pulling the i18n
    // resource graph into this module would tax every importer for it.
    void Promise.all([import('sonner'), import('@/i18n')]).then(
      ([{ toast }, i18n]) => {
        toast.warning(i18n.default.t('chat.local-browser-closed-notice'));
      }
    );
  },
});
