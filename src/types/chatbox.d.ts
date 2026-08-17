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

import type {
  AgentMessageStatusType,
  AgentStatusType,
  AgentStepType,
  TaskStatusType,
} from './constants';

// Global type definitions for ChatBox component

declare global {
  interface FileInfo {
    name: string;
    type: string;
    path: string;
    content?: string;
    icon?: React.ElementType;
    agent_id?: string;
    task_id?: string;
    project_id?: string;
    isFolder?: boolean;
    isRemote?: boolean;
    relativePath?: string;
  }

  interface ProjectInfo {
    id: string;
    name: string;
    path: string;
    taskCount: number;
    createdAt: Date;
  }

  interface TaskInfo {
    report?: string | undefined;
    id: string;
    content: string;
    status?: TaskStatusType;
    agent?: Agent;
    terminal?: string[];
    fileList?: FileInfo[];
    project_id?: string;
    toolkits?: {
      toolkitName: string;
      toolkitMethods: string;
      message: string;
      toolkitStatus?: AgentStatus;
    }[];
    failure_count?: number;
    reAssignTo?: string;
  }

  interface File {
    fileName: string;
    filePath: string;
    fileId?: string;
    source?: 'local' | 'upload';
  }

  type AgentStatus = AgentStatusType;

  interface ActiveWebView {
    id: string;
    url: string;
    processTaskId: string;
    img: string;
    /**
     * The browser is somewhere this app cannot attach a WebContentsView to —
     * a headless Chromium inside a sandbox pod. `img` is then a captured
     * frame rather than a live surface, so handing the window over is not an
     * offer that can be honored.
     */
    remote?: boolean;
    /**
     * Recent viewfinder frames, oldest first, as resolved download URLs. Only
     * the tail is carried: each URL is a time-boxed grant minted per frame.
     */
    frames?: string[];
    /** How many frames the run produced, which is usually more than `frames`. */
    frameCount?: number;
  }

  interface Agent {
    agent_id: string;
    name: string;
    type: AgentNameType;
    status?: AgentStatus;
    tasks: TaskInfo[];
    log: AgentMessage[];
    img?: string[];
    activeWebviewIds?: ActiveWebView[];
    tools?: string[];
    workerInfo?: {
      name: string;
      description: string;
      // Set only by the retired local-workforce path; nothing writes them now.
      tools?: any;
      mcp_tools?: any;
      selectedTools?: any;
      model_provider_id?: number;
    };
  }

  interface Message {
    id: string;
    role: 'user' | 'agent';
    content: string;
    /** aion remote mode: streamed thinking trace accompanying the content. */
    reasoning?: string;
    step?: AgentStepType;
    agent_id?: string;
    isConfirm?: boolean;
    taskType?: 1 | 2 | 3;
    taskInfo?: TaskInfo[];
    taskRunning?: TaskInfo[];
    summaryTask?: string;
    taskAssigning?: Agent[];
    showType?: 'tree' | 'list';
    rePort?: any;
    fileList?: FileInfo[];
    task_id?: string;
    summary?: string;
    agent_name?: string;
    attaches?: File[];
    /** aion remote mode: a durable human-gate approval rendered in-chat. */
    approval?: {
      /** aion Project id — routes the verdict back over the edge. */
      projectId: string;
      approvalId: string;
      toolName?: string;
      reason?: string;
      argumentsJson?: string;
      /** Set once approval_resolved streams back ('allow' | 'deny'). */
      decision?: string;
    };
    /**
     * aion remote mode: a tool call rendered as a typed card interleaved in
     * the chat timeline (bash/code/browser/generic lane by tool name).
     */
    toolCard?: {
      toolName: string;
      argumentsJson: string;
      status: 'running' | 'done' | 'error';
      /** Streamed tail while the tool runs; absent once the result lands. */
      liveOutput?: string;
      /** Settled result content (preview-capped). */
      resultContent?: string;
    };
  }

  interface AgentMessage {
    timestamp?: number | null;
    created_at?: string | null;
    step: AgentStepType;
    data: {
      project_id?: string;
      failure_count?: number;
      tokens?: number;
      sub_tasks?: TaskInfo[];
      summary_task?: string;
      content?: string;
      notice?: string;
      answer?: string;
      agent_name?: string;
      agent_id?: string;
      assignee_id?: string;
      task_id?: string;
      toolkit_name?: string;
      method_name?: string;
      state?: string;
      message?: string;
      /**
       * aion remote mode: the tail of a still-running tool's streamed
       * stdout/stderr (tool_output events), absent once the result lands.
       */
      live_output?: string;
      /**
       * aion remote mode: the tool call's raw arguments JSON — the work-log
       * row renders a typed card from it (message keeps the capped preview
       * for the legacy fold).
       */
      arguments_json?: string;
      question?: string;
      reply?: string;
      agent?: string;
      file_path?: string;
      process_task_id?: string;
      request_index?: number;
      response_id?: string;
      step_total_tokens?: number;
      output?: string;
      result?: string;
      tools?: string[];
      todos?: {
        id: string;
        content: string;
        active_form?: string;
        status: 'pending' | 'in_progress' | 'completed';
      }[];
      //Context Length
      current_length?: number;
      max_length?: number;
      text?: string;
    };
    status?: AgentMessageStatusType;
  }

  type AgentNameType =
    | 'developer_agent'
    | 'browser_agent'
    | 'document_agent'
    | 'multi_modal_agent'
    | 'social_media_agent'
    | 'single_agent'
    /**
     * One worker of a run's fan-out. Its label is the worker's own name or
     * role, so it deliberately has no preset in `agentMap` — every lane in a
     * run carries this type and they are told apart by `name`/`agent_id`.
     */
    | 'worker_agent';

  interface AgentNameMap {
    developer_agent: 'Developer Agent';
    browser_agent: 'Browser Agent';
    document_agent: 'Document Agent';
    multi_modal_agent: 'Multi Modal Agent';
    social_media_agent: 'Social Media Agent';
    single_agent: 'Agent';
    worker_agent: 'Worker';
  }
  type WorkspaceType =
    | 'workflow'
    | 'developer_agent'
    | 'browser_agent'
    | 'document_agent'
    | 'multi_modal_agent'
    | 'social_media_agent'
    | null;
}

export {};
