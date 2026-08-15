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

import {
  AgentStep,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';

type SessionModeAgent = {
  type?: string;
};

type SessionModeMessage = {
  step?: string;
  taskAssigning?: SessionModeAgent[];
};

type SessionModeTask = {
  sessionMode?: SessionModeType;
  taskAssigning?: SessionModeAgent[];
  taskInfo?: unknown[];
  taskRunning?: unknown[];
  messages?: SessionModeMessage[];
};

function hasSingleAgent(agents: SessionModeAgent[] | undefined) {
  return (agents ?? []).some((agent) => agent.type === 'single_agent');
}

function hasWorkforceAgent(agents: SessionModeAgent[] | undefined) {
  return (agents ?? []).some(
    (agent) => agent.type && agent.type !== 'single_agent'
  );
}

/**
 * Resolve a task's session mode from its data.
 *
 * Pass `fallback: null` to detect the "not yet determined" case — useful
 * while a project/session is still loading, so the UI can render a neutral
 * state instead of flashing the wrong mode (workforce → single-agent).
 */
export function inferSessionModeFromTask(
  task: SessionModeTask | null | undefined,
  fallback: SessionModeType | null = SessionMode.WORKFORCE
): SessionModeType | null {
  if (!task) return fallback;

  // Delegation is read first, ahead of both the stated mode and the
  // single-agent card. A stated mode is an intent stamped at submit time, when
  // nothing about the run is known yet, and a run that fanned out carries the
  // orchestrator's own card alongside one per worker it staffed — so neither
  // rules out a workforce. Workers actually being on the run is the stronger
  // evidence, and it only ever upgrades: nothing here turns a stated workforce
  // back into one agent.
  if (hasWorkforceAgent(task.taskAssigning)) {
    return SessionMode.WORKFORCE;
  }
  if (task.sessionMode) return task.sessionMode;
  if (hasSingleAgent(task.taskAssigning)) {
    return SessionMode.SINGLE_AGENT;
  }

  const messages = task.messages ?? [];
  if (
    messages.some(
      (message) =>
        message.step === AgentStep.TO_SUB_TASKS ||
        hasWorkforceAgent(message.taskAssigning)
    )
  ) {
    return SessionMode.WORKFORCE;
  }

  if ((task.taskInfo?.length ?? 0) > 0 || (task.taskRunning?.length ?? 0) > 0) {
    return SessionMode.WORKFORCE;
  }

  return fallback;
}

/**
 * Reconcile the mode a Project has stored against the mode its live turn turned
 * out to be.
 *
 * The stored mode is stamped when the Project is created, before anything about
 * the run is known — so it can say single-agent about a session that then goes
 * on to staff workers. Delegation is the stronger evidence and wins. Nothing
 * downgrades a Project that was created as a workforce one.
 */
export function resolveSessionMode(
  storedMode: SessionModeType | null | undefined,
  inferredMode: SessionModeType | null
): SessionModeType | null {
  if (inferredMode === SessionMode.WORKFORCE) return SessionMode.WORKFORCE;
  return storedMode ?? inferredMode ?? null;
}
