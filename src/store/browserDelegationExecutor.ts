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
}

/** Executed delegations remembered for replay re-POSTs. */
const COMPLETED_LRU_CAP = 200;
const POST_ATTEMPTS = 3;

interface ProjectLane {
  transport: DelegationTransport;
  queue: PendingBrowserDelegation[];
  queued: Set<string>;
  inFlight: string | null;
  /** Executed → the recorded wire result; null when there is nothing to send
   * (the deadline had already passed, so the run has abandoned the action). */
  completed: Map<string, BrowserDelegationResult | null>;
  /** Ids whose POST reached a terminal answer (202 accepted or 4xx converged). */
  posted: Set<string>;
  pumping: boolean;
  rehydrated: boolean;
}

export class BrowserDelegationExecutor {
  private lanes = new Map<string, ProjectLane>();

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
        lane.queued.delete(row.delegationId);
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
      const id = row.delegationId;
      if (!id || lane.posted.has(id) || lane.queued.has(id) || lane.inFlight === id) {
        continue;
      }
      if (lane.completed.has(id)) {
        // Executed already but the POST never landed — deliver the recorded
        // result, never re-drive the page.
        void this.post(projectId, lane, id);
        continue;
      }
      lane.queue.push(row);
      lane.queued.add(id);
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
        lane.queued.delete(row.delegationId);
        lane.inFlight = row.delegationId;
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
      lane.completed.set(row.delegationId, null);
      lane.posted.add(row.delegationId);
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
    lane.completed.set(row.delegationId, result);
    this.trimCompleted(lane);
    await this.post(projectId, lane, row.delegationId);
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
    delegationId: string
  ): Promise<void> {
    const result = lane.completed.get(delegationId);
    if (!result || lane.posted.has(delegationId)) return;
    for (let attempt = 1; attempt <= POST_ATTEMPTS; attempt++) {
      try {
        await lane.transport.respondToBrowserDelegation(
          projectId,
          delegationId,
          result
        );
        lane.posted.add(delegationId);
        return;
      } catch (error) {
        if (error instanceof EdgeProblemError && error.problem.status < 500) {
          // 409 delegation_not_pending (the run settled first) and every
          // other 4xx: a retry re-sends the same bytes, so the answer stands.
          lane.posted.add(delegationId);
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
});
