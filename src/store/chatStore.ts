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
  getAionRemoteConfig,
  startAionTask,
  stopAionTurn,
} from '@/store/aionChatBridge';
import type { AppHost } from '@/host/types';
import { generateUniqueId } from '@/lib';
import {
  recordFeatureUsed,
  recordTaskFailed,
  recordTaskSubmitted,
} from '@/lib/events/appEvents';
import {
  AgentStep,
  ChatTaskStatus,
  SessionMode,
  TaskStatus,
  type ChatTaskStatusType,
  type SessionModeType,
} from '@/types/constants';
import { FileText } from 'lucide-react';
import { createStore } from 'zustand';
import { getWorkerList } from './authStore';
import { useProjectStore } from './projectStore';
import { useSpaceStore } from './spaceStore';


type ConfirmedUserPromptSources = {
  lastMessageContent?: unknown;
  messageContent?: unknown;
  question?: unknown;
  isFollowUpConfirm: boolean;
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export function resolveConfirmedUserMessageContent({
  lastMessageContent,
  messageContent,
  question,
  isFollowUpConfirm,
}: ConfirmedUserPromptSources): string {
  const optimisticMessage = nonEmptyString(lastMessageContent);
  if (optimisticMessage) return optimisticMessage;

  const capturedStartMessage = nonEmptyString(messageContent);
  const eventQuestion = nonEmptyString(question);

  if (isFollowUpConfirm) {
    return eventQuestion || capturedStartMessage || '';
  }

  return capturedStartMessage || eventQuestion || '';
}


let _host: AppHost | null = null;



export function injectHost(host: AppHost | null): void {
  _host = host;
}




function getHostIpcRenderer() {
  return _host?.ipcRenderer ?? null;
}





interface Task {
  source: 'user' | 'trigger';
  sessionMode?: SessionModeType;
  messages: Message[];
  type: string;
  summaryTask: string;
  taskInfo: TaskInfo[];
  attaches: File[];
  taskRunning: TaskInfo[];
  taskAssigning: Agent[];
  fileList: FileInfo[];
  webViewUrls: { url: string; processTaskId: string }[];
  activeAsk: string;
  askList: Message[];
  progressValue: number;
  isPending: boolean;
  activeWorkspace: string | null;
  hasMessages: boolean;
  activeAgent: string;
  status: ChatTaskStatusType;
  taskTime: number;
  elapsed: number;
  tokens: number;
  hasWaitComfirm: boolean;
  cotList: string[];
  hasAddWorker: boolean;
  nuwFileNum: number;
  delayTime: number;
  selectedFile: FileInfo | null;
  snapshots: any[];
  isTakeControl: boolean;
  planDirty: boolean;
  autoConfirmDeadline: number | null;
  isContextExceeded?: boolean;
  // Streaming decompose text - stored separately to avoid frequent re-renders
  streamingDecomposeText: string;
  // Trigger execution ID for tracking trigger task completion
  executionId?: string;
  nextExecutionId?: string;
  /** Unix ms timestamp when this task was created — used for TurnTabs ordering. */
  createdAt: number;
}

type UploadFileSource = 'project_output' | 'user_attachment';

interface UploadCandidate {
  path: string;
  name: string;
  uploadName: string;
  source: UploadFileSource;
}

interface GeneratedUploadFile {
  path?: string;
  name?: string;
  isFolder?: boolean;
  relativePath?: string;
  source?: Exclude<UploadFileSource, 'user_attachment'>;
}


function getFileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || 'file';
}

function isReadableLocalPath(filePath?: string): filePath is string {
  if (!filePath) return false;
  return !/^(https?:|file:|blob:|data:)/i.test(filePath);
}

function buildUploadName(fileName: string, source: UploadFileSource): string {
  return `${source === 'user_attachment' ? 'user_attachment' : 'project_output'}/${fileName}`;
}


const compactContextText = (value?: string | null) =>
  (value ?? '').replace(/\s+/g, ' ').trim();

export function extractEndPayloadText(endData: unknown): string {
  if (typeof endData === 'string') {
    return endData;
  }
  if (!endData || typeof endData !== 'object') {
    return '';
  }

  for (const key of ['message', 'content', 'result', 'summary']) {
    const value = (endData as Record<string, unknown>)[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return '';
}

function completedSubtaskReportFallback(task?: Task): string {
  if (!task) return '';

  const reports =
    task.taskAssigning
      ?.flatMap((agent) => agent.tasks || [])
      .map((subtask) => compactContextText(subtask.report))
      .filter(Boolean) || [];

  if (reports.length <= 1) {
    return reports[0] || '';
  }

  return reports
    .map((report, index) => `**Subtask ${index + 1}**\n${report}`)
    .join('\n\n');
}

export function resolveEndMessageText(
  rawEndPayload: string,
  messages: Message[],
  task?: Task
) {
  const summary = rawEndPayload.match(/<summary>(.*?)<\/summary>/s)?.[1];
  if (summary) return summary;

  if (rawEndPayload.trim()) {
    return rawEndPayload;
  }

  const agentSummaryEnd = messages.findLast(
    (message) => message.step === AgentStep.AGENT_SUMMARY_END
  );
  return agentSummaryEnd?.summary || completedSubtaskReportFallback(task);
}

export function collectTaskUploadFiles(
  generatedFiles: GeneratedUploadFile[],
  messages: Message[],
  pendingAttaches: File[] = [],
  taskOutputFiles: FileInfo[] = []
): UploadCandidate[] {
  const uploadCandidates: Array<
    Omit<UploadCandidate, 'uploadName'> & { relativePath?: string }
  > = [];

  for (const file of generatedFiles) {
    if (!file?.path || !file?.name || file.isFolder) continue;
    uploadCandidates.push({
      path: file.path,
      name: file.name,
      relativePath: file.relativePath,
      source: 'project_output',
    });
  }

  for (const file of taskOutputFiles) {
    if (!file?.path || !file?.name || file.isFolder) continue;
    if (!isReadableLocalPath(file.path)) continue;
    uploadCandidates.push({
      path: file.path,
      name: file.name,
      relativePath: file.relativePath,
      source: 'project_output',
    });
  }

  for (const file of messages.flatMap((message) => message.fileList || [])) {
    if (!file?.path || !file?.name || file.isFolder) continue;
    if (!isReadableLocalPath(file.path)) continue;
    uploadCandidates.push({
      path: file.path,
      name: file.name,
      relativePath: file.relativePath,
      source: 'project_output',
    });
  }

  const attachmentFiles = [
    ...messages.flatMap((message) => message.attaches || []),
    ...pendingAttaches,
  ];

  for (const attachment of attachmentFiles) {
    if (!isReadableLocalPath(attachment?.filePath)) continue;
    uploadCandidates.push({
      path: attachment.filePath,
      name:
        attachment.fileName?.trim() || getFileNameFromPath(attachment.filePath),
      source: 'user_attachment',
    });
  }

  const uniqueCandidates = new Map<string, UploadCandidate>();
  for (const file of uploadCandidates) {
    if (!uniqueCandidates.has(file.path)) {
      const { relativePath: _relativePath, ...rest } = file;
      uniqueCandidates.set(file.path, {
        ...rest,
        uploadName: buildUploadName(file.name, file.source),
      });
    }
  }

  return Array.from(uniqueCandidates.values());
}


export interface StartTaskOptions {
  preserveTaskId?: boolean;
  skipHistoryCreate?: boolean;
  historyId?: string | number | null;
}

export interface ChatStore {
  updateCount: number;
  activeTaskId: string | null;
  nextTaskId: string | null;
  tasks: { [key: string]: Task };
  create: (id?: string, type?: any) => string;
  /**
   * Replace a task's full state in one commit — used by the IDB-backed
   * project cache to skip the SSE replay path when we already have a
   * reconstructed final state from a previous session. Volatile fields
   * (pending/streaming/timers) are forced to safe defaults.
   */
  hydrateTask: (taskId: string, state: Task) => void;
  removeTask: (taskId: string) => void;
  stopTask: (taskId: string) => void;
  setStatus: (taskId: string, status: ChatTaskStatusType) => void;
  setActiveTaskId: (taskId: string) => void;
  setTaskSessionMode: (taskId: string, mode: SessionModeType) => void;
  startTask: (
    taskId: string,
    messageContent?: string,
    messageAttaches?: File[],
    executionId?: string,
    projectId?: string,
    sessionMode?: SessionModeType,
    options?: StartTaskOptions
  ) => Promise<void>;
  handleConfirmTask: (
    project_id: string,
    taskId: string,
    type?: string
  ) => void;
  addMessages: (taskId: string, messages: Message) => void;
  setMessages: (taskId: string, messages: Message[]) => void;
  updateMessage: (taskId: string, messageId: string, message: Message) => void;
  removeMessage: (taskId: string, messageId: string) => void;
  setAttaches: (taskId: string, attaches: File[]) => void;
  setSummaryTask: (taskId: string, summaryTask: string) => void;
  setHasWaitComfirm: (taskId: string, hasWaitComfirm: boolean) => void;
  setTaskAssigning: (taskId: string, taskAssigning: Agent[]) => void;
  setTaskInfo: (taskId: string, taskInfo: TaskInfo[]) => void;
  setTaskRunning: (taskId: string, taskRunning: TaskInfo[]) => void;
  setActiveAsk: (taskId: string, agentName: string) => void;
  setActiveAskList: (taskId: string, message: Message[]) => void;
  addWebViewUrl: (
    taskId: string,
    webViewUrl: string,
    processTaskId: string
  ) => void;
  setWebViewUrls: (
    taskId: string,
    webViewUrls: { url: string; processTaskId: string }[]
  ) => void;
  setProgressValue: (taskId: string, progressValue: number) => void;
  computedProgressValue: (taskId: string) => void;
  setIsPending: (taskId: string, isPending: boolean) => void;
  addTerminal: (
    taskId: string,
    processTaskId: string,
    terminal: string
  ) => void;
  addFileList: (
    taskId: string,
    processTaskId: string,
    fileInfo: FileInfo
  ) => void;
  setFileList: (
    taskId: string,
    processTaskId: string,
    fileList: FileInfo[]
  ) => void;
  setActiveWorkspace: (taskId: string, activeWorkspace: string) => void;
  setActiveAgent: (taskId: string, agentName: string) => void;
  setHasMessages: (taskId: string, hasMessages: boolean) => void;
  getLastUserMessage: () => Message | null;
  addTaskInfo: () => void;
  updateTaskInfo: (index: number, content: string) => void;
  deleteTaskInfo: (index: number) => void;
  setTaskTime: (taskId: string, taskTime: number) => void;
  setElapsed: (taskId: string, taskTime: number) => void;
  getFormattedTaskTime: (taskId: string) => string;
  addTokens: (taskId: string, tokens: number) => void;
  getTokens: (taskId: string) => number;
  setUpdateCount: () => void;
  setCotList: (taskId: string, cotList: string[]) => void;
  setHasAddWorker: (taskId: string, hasAddWorker: boolean) => void;
  setNuwFileNum: (taskId: string, nuwFileNum: number) => void;
  setDelayTime: (taskId: string, delayTime: number) => void;
  setType: (taskId: string, type: string) => void;
  setSelectedFile: (taskId: string, selectedFile: FileInfo | null) => void;
  setSnapshots: (taskId: string, snapshots: any[]) => void;
  setIsTakeControl: (taskId: string, isTakeControl: boolean) => void;
  setPlanDirty: (taskId: string, dirty: boolean) => void;
  setAutoConfirmDeadline: (taskId: string, deadline: number | null) => void;
  savePlan: (taskId: string) => Promise<void>;
  clearTasks: () => void;
  setIsContextExceeded: (taskId: string, isContextExceeded: boolean) => void;
  setNextTaskId: (taskId: string | null) => void;
  setStreamingDecomposeText: (taskId: string, text: string) => void;
  clearStreamingDecomposeText: (taskId: string) => void;
  setExecutionId: (taskId: string, executionId: string | undefined) => void;
  setTaskSource: (taskId: string, source: 'user' | 'trigger') => void;
  setNextExecutionId: (
    taskId: string,
    nextExecutionId: string | undefined
  ) => void;
}

export type VanillaChatStore = {
  getState: () => ChatStore;
  subscribe: (listener: (state: ChatStore) => void) => () => void;
};

// Track auto-confirm timers per task to avoid reusing stale timers across rounds
const autoConfirmTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const AUTO_CONFIRM_TIMEOUT_MS = 30000;

// Track active SSE connections for proper cleanup. `live` distinguishes
// real Brain runs from history/share playback streams.
const activeSSEControllers: Record<
  string,
  { controller: AbortController; live: boolean }
> = {};

const FINAL_OUTPUT_FILE_PATH_REGEX =
  /(?<![A-Za-z0-9:\\/])(?:[A-Za-z]:)?[\\/][^\s`"'<>|*]+?\.[A-Za-z0-9]{1,12}(?=$|[\s`"'<>|*),;:\]}])/g;

const FINAL_OUTPUT_SANDBOX_SCHEME_REGEX =
  /(^|[^A-Za-z0-9_+.-])sandbox:(?=(?:[A-Za-z]:)?[\\/])/gi;

const FINAL_OUTPUT_FILE_EXTENSIONS = new Set([
  'csv',
  'doc',
  'docx',
  'gif',
  'htm',
  'html',
  'jpeg',
  'jpg',
  'json',
  'log',
  'md',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'svg',
  'tsv',
  'txt',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'zip',
]);

function normalizeOutputPath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

function getOutputFileNameFromPath(path: string): string {
  return normalizeOutputPath(path).split('/').pop() || '';
}

function getFileTypeFromName(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return extension === name.toLowerCase() ? '' : extension;
}

function getProjectRelativeFilePath(
  filePath: string,
  projectId?: string
): string | undefined {
  const normalizedPath = normalizeOutputPath(filePath);
  if (projectId) {
    const projectMarker = `/project_${projectId}/`;
    const projectIndex = normalizedPath.indexOf(projectMarker);
    if (projectIndex !== -1) {
      return normalizedPath.slice(projectIndex + projectMarker.length);
    }
  }

  return normalizedPath.match(/\/project_[^/]+\/(.+)$/)?.[1];
}

function buildRemoteFileInfoPath({
  baseURL,
  email,
  projectId,
  relativePath,
}: {
  baseURL?: string;
  email?: string;
  projectId?: string;
  relativePath?: string;
}): string | undefined {
  if (!baseURL || !email || !projectId || !relativePath) {
    return undefined;
  }

  const params = new URLSearchParams({
    path: relativePath,
    project_id: projectId,
    email,
  });

  return `${baseURL.replace(/\/$/, '')}/files/stream?${params.toString()}`;
}

export function extractFinalOutputFileList(
  content: string,
  projectId?: string,
  email?: string,
  baseURL?: string
): FileInfo[] {
  if (!content) {
    return [];
  }

  const fileInfos: FileInfo[] = [];
  const seen = new Set<string>();
  const parseableContent = content.replace(
    FINAL_OUTPUT_SANDBOX_SCHEME_REGEX,
    '$1'
  );

  for (const match of parseableContent.matchAll(FINAL_OUTPUT_FILE_PATH_REGEX)) {
    const filePath = normalizeOutputPath(match[0]);
    if (!filePath || filePath.startsWith('//') || filePath.includes('://')) {
      continue;
    }

    const name = getOutputFileNameFromPath(filePath);
    const type = getFileTypeFromName(name);
    if (!name || !FINAL_OUTPUT_FILE_EXTENSIONS.has(type)) {
      continue;
    }

    const relativePath = getProjectRelativeFilePath(filePath, projectId);
    const remotePath = buildRemoteFileInfoPath({
      baseURL,
      email,
      projectId,
      relativePath,
    });
    const identity = normalizeOutputPath(relativePath || filePath);
    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    fileInfos.push({
      name,
      type,
      path: remotePath || filePath,
      icon: FileText,
      relativePath,
      isRemote: Boolean(remotePath),
    });
  }

  return fileInfos;
}

function getFileInfoIdentities(file: FileInfo): string[] {
  return [
    file.relativePath,
    file.path,
    file.name,
    getOutputFileNameFromPath(file.path || ''),
  ]
    .filter(Boolean)
    .map((value) => normalizeOutputPath(value as string).toLowerCase());
}

function isLegacySandboxDrivePath(
  existingPath: string,
  extractedPath: string
): boolean {
  const normalizedExisting = normalizeOutputPath(existingPath).toLowerCase();
  const normalizedExtracted = normalizeOutputPath(extractedPath).toLowerCase();
  return normalizedExisting === `x:${normalizedExtracted}`;
}

export function mergeFileInfoLists(
  existingFileList: FileInfo[],
  extractedFileList: FileInfo[]
): FileInfo[] {
  const merged = [...existingFileList];
  const mergedIdentities = merged.map(getFileInfoIdentities);

  extractedFileList.forEach((file) => {
    const identities = getFileInfoIdentities(file);
    const existingIndex = mergedIdentities.findIndex((existingIdentities) =>
      identities.some((identity) => existingIdentities.includes(identity))
    );

    if (existingIndex === -1) {
      merged.push(file);
      mergedIdentities.push(identities);
      return;
    }

    const existingFile = merged[existingIndex];
    if (
      (file.isRemote && !existingFile.isRemote) ||
      isLegacySandboxDrivePath(existingFile.path, file.path)
    ) {
      merged[existingIndex] = {
        ...existingFile,
        ...file,
      };
      mergedIdentities[existingIndex] = identities;
    }
  });

  return merged;
}




// Throttle streaming decompose text updates to prevent excessive re-renders
const streamingDecomposeTextBuffer: Record<string, string> = {};
const streamingDecomposeTextTimers: Record<
  string,
  ReturnType<typeof setTimeout>
> = {};

const chatStore = (initial?: Partial<ChatStore>) =>
  createStore<ChatStore>()((set, get) => ({
    activeTaskId: null,
    nextTaskId: null,
    tasks: initial?.tasks ?? {},
    updateCount: 0,
    hydrateTask(taskId: string, state: Task) {
      set((s) => ({
        activeTaskId: taskId,
        tasks: {
          ...s.tasks,
          [taskId]: {
            ...state,
            // Never resurrect a task as pending / awaiting confirmation
            // from a cached snapshot — those are in-flight flags only.
            isPending: false,
            activeAsk: '',
            askList: [],
            autoConfirmDeadline: null,
            streamingDecomposeText: '',
            // File handles can't round-trip through JSON, so cached
            // attaches always come back empty.
            attaches: [],
          },
        },
      }));
    },
    create(id?: string, type?: any) {
      const taskId = id ? id : generateUniqueId();
      console.log('Create Task', taskId);
      set((state) => ({
        activeTaskId: taskId,
        tasks: {
          ...state.tasks,
          [taskId]: {
            type: type,
            source: 'user',
            messages: [],
            summaryTask: '',
            taskInfo: [],
            attaches: [],
            taskRunning: [],
            taskAssigning: [],
            fileList: [],
            webViewUrls: [],
            activeAsk: '',
            askList: [],
            progressValue: 0,
            isPending: false,
            activeWorkspace: 'workflow',
            hasMessages: false,
            activeAgent: '',
            status: ChatTaskStatus.PENDING,
            taskTime: 0,
            tokens: 0,
            elapsed: 0,
            hasWaitComfirm: false,
            cotList: [],
            hasAddWorker: false,
            nuwFileNum: 0,
            delayTime: 0,
            selectedFile: null,
            snapshots: [],
            isTakeControl: false,
            planDirty: false,
            autoConfirmDeadline: null,
            streamingDecomposeText: '',
            executionId: undefined,
            createdAt: Date.now(),
          },
        },
      }));
      return taskId;
    },
    computedProgressValue(taskId: string) {
      const { tasks, setProgressValue, activeTaskId } = get();
      const taskRunning = [...tasks[taskId].taskRunning];
      const finishedTask = taskRunning?.filter(
        (task) =>
          task.status === TaskStatus.COMPLETED ||
          task.status === TaskStatus.FAILED
      ).length;
      const taskProgress = (
        ((finishedTask || 0) / (taskRunning?.length || 0)) *
        100
      ).toFixed(2);
      setProgressValue(activeTaskId as string, Number(taskProgress));
    },
    removeTask(taskId: string) {
      // Clean up any pending auto-confirm timers when removing a task
      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        get().setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn('Error clearing auto-confirm timer in removeTask:', error);
      }

      // Clean up SSE connection if it exists
      try {
        if (activeSSEControllers[taskId]) {
          activeSSEControllers[taskId].controller.abort();
          delete activeSSEControllers[taskId];
        }
      } catch (error) {
        console.warn('Error aborting SSE connection in removeTask:', error);
      }

      set((state) => {
        delete state.tasks[taskId];
        return {
          tasks: {
            ...state.tasks,
          },
        };
      });
    },
    updateMessage(taskId: string, messageId: string, message: Message) {
      set((state) => {
        const task = state.tasks[taskId];
        if (!task) return state;
        const messages = task.messages.map((m) => {
          if (m.id === messageId) {
            return message;
          }
          return m;
        });
        return {
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...task,
              messages,
            },
          },
        };
      });
    },
    stopTask(taskId: string) {
      // aion remote mode: epoch-fenced cancel for the Run bound to this task
      // (no-op when the task is legacy-backed). The run_cancelled event, not
      // this call, is what settles the pane.
      stopAionTurn(taskId);
      // Abort the SSE connection for this task
      try {
        if (activeSSEControllers[taskId]) {
          console.log(`Stopping SSE connection for task ${taskId}`);
          activeSSEControllers[taskId].controller.abort();
          delete activeSSEControllers[taskId];
        }
      } catch (error) {
        console.warn('Error aborting SSE connection in stopTask:', error);
        // Even if abort fails, still clean up the reference
        try {
          delete activeSSEControllers[taskId];
        } catch (cleanupError) {
          console.warn(
            'Error cleaning up SSE controller reference:',
            cleanupError
          );
        }
      }

      // Clean up any pending auto-confirm timers
      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        get().setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn('Error clearing auto-confirm timer in stopTask:', error);
      }

      // Update task status to finished - ensure this happens even if cleanup fails
      try {
        set((state) => {
          // Check if task exists before updating
          if (!state.tasks[taskId]) {
            console.warn(`Task ${taskId} not found when trying to stop it`);
            return state;
          }

          return {
            ...state,
            tasks: {
              ...state.tasks,
              [taskId]: {
                ...state.tasks[taskId],
                status: ChatTaskStatus.FINISHED,
              },
            },
          };
        });
      } catch (error) {
        console.error(
          'Error updating task status to finished in stopTask:',
          error
        );
      }
    },
    startTask: async (
      taskId: string,
      messageContent?: string,
      messageAttaches?: File[],
      executionId?: string,
      projectId?: string,
      sessionMode?: SessionModeType,
      options?: StartTaskOptions
    ) => {
      //ProjectStore must exist as chatStore is already
      const projectStore = useProjectStore.getState();
      if (!projectId) {
        throw new Error('No active Project selected.');
      }
      const startOptions = options || {};
      const project = projectStore.getProjectById(projectId);
      if (!project) {
        throw new Error('Selected Project is not available.');
      }
      const sessionModeForRequest =
        sessionMode || project.mode || SessionMode.SINGLE_AGENT;
      // Powers the "time to first task" lifecycle event.
      const submitWorkers = getWorkerList();
      const submitHasMcp = submitWorkers.some(
        (w) => (w.workerInfo?.mcp_tools?.length ?? 0) > 0
      );
      recordTaskSubmitted({
        session_mode: sessionModeForRequest,
        task_source: executionId ? 'trigger' : 'user',
        agent_count: submitWorkers.length,
        has_mcp: submitHasMcp,
      });
      if (sessionModeForRequest === SessionMode.WORKFORCE) {
        recordFeatureUsed('multi_agent', {
          session_mode: sessionModeForRequest,
        });
      }
      if (!project.mode) {
        useSpaceStore
          .getState()
          .updateProjectMeta(projectId, { mode: sessionModeForRequest });
      }
      //Create a new chatStore on Start
      let newTaskId = taskId;
      let targetChatStore = { getState: () => get() }; // Default to current store
      console.log('Creating a new Chat Instance for current project on end');
      const newChatResult = projectStore.appendInitChatStore(
        projectId,
        startOptions.preserveTaskId ? taskId : undefined
      );

      if (newChatResult) {
        newTaskId = newChatResult.taskId;
        targetChatStore = newChatResult.chatStore;
        targetChatStore.getState().setIsPending(newTaskId, true);

        // Set executionId if this is a trigger-initiated task
        if (executionId) {
          targetChatStore.getState().setExecutionId(newTaskId, executionId);
          targetChatStore.getState().setTaskSource(newTaskId, 'trigger');
        } else {
          targetChatStore.getState().setTaskSource(newTaskId, 'user');
        }

        //From handleSend if message is given
        // Add the message to the new chatStore if provided
        if (messageContent) {
          targetChatStore.getState().addMessages(newTaskId, {
            id: generateUniqueId(),
            role: 'user',
            content: messageContent,
            attaches: messageAttaches || [],
          });
          targetChatStore.getState().setHasMessages(newTaskId, true);
        }
      }

      const targetState = targetChatStore.getState();
      // aion owns orchestration; the workforce projection arrives as its own
      // events, so the pane renders the single-agent layout.
      targetState.setTaskSessionMode(newTaskId, SessionMode.SINGLE_AGENT);
      const question =
        messageContent ||
        targetState.tasks[newTaskId]?.messages.findLast(
          (m) => m.role === 'user'
        )?.content ||
        '';
      const attachesToSend =
        messageAttaches ||
        targetState.tasks[newTaskId]?.messages.findLast(
          (m) => m.role === 'user'
        )?.attaches ||
        [];
      try {
        const aionConfig = await getAionRemoteConfig();
        // A desktop with no transport has nothing to run the turn on, and
        // saying so beats leaving the composer locked on a pending task.
        if (!aionConfig) {
          throw new Error('This desktop is not connected to a backend.');
        }
        if ('error' in aionConfig) {
          throw new Error(aionConfig.error);
        }
        await startAionTask({
          chatStore: targetChatStore,
          taskId: newTaskId,
          eigentProjectId: projectId,
          question,
          attaches: attachesToSend.map((f) => ({
            fileName: f.fileName,
            filePath: f.filePath,
          })),
        });
      } catch (error) {
        recordTaskFailed({
          error_type: 'backend_unavailable',
          session_mode: sessionModeForRequest,
        });
        const failedState = targetChatStore.getState();
        failedState.addMessages(newTaskId, {
          id: generateUniqueId(),
          role: 'agent',
          content: `❌ ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        failedState.setIsPending(newTaskId, false);
        failedState.setStatus(newTaskId, ChatTaskStatus.FINISHED);
      }
    },

    setUpdateCount() {
      set((state) => ({
        ...state,
        updateCount: state.updateCount + 1,
      }));
    },
    setActiveTaskId: (taskId: string) => {
      set({
        activeTaskId: taskId,
      });
    },
    setTaskSessionMode: (taskId: string, mode: SessionModeType) => {
      set((state) => {
        const task = state.tasks[taskId];
        if (!task || task.sessionMode === mode) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...task,
              sessionMode: mode,
            },
          },
        };
      });
    },
    addMessages(taskId, message) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            messages: [...state.tasks[taskId].messages, message],
          },
        },
      }));
    },
    setAttaches(taskId, attaches) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            attaches: [...attaches],
          },
        },
      }));
    },
    setMessages(taskId, messages) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            messages: [...messages],
          },
        },
      }));
    },
    removeMessage(taskId, messageId) {
      set((state) => {
        if (!state.tasks[taskId]) {
          return state;
        }
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              messages: state.tasks[taskId].messages.filter(
                (message) => message.id !== messageId
              ),
            },
          },
        };
      });
    },
    setCotList(taskId, cotList) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            cotList: [...cotList],
          },
        },
      }));
    },

    setSummaryTask(taskId, summaryTask) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            summaryTask,
          },
        },
      }));
    },
    setIsTakeControl(taskId, isTakeControl) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            isTakeControl,
          },
        },
      }));
    },
    setHasWaitComfirm(taskId, hasWaitComfirm) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            hasWaitComfirm,
          },
        },
      }));
    },
    setTaskInfo(taskId, taskInfo) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskInfo: [...taskInfo],
          },
        },
      }));
    },
    setTaskRunning(taskId, taskRunning) {
      const { computedProgressValue } = get();
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskRunning: [...taskRunning],
          },
        },
      }));
      computedProgressValue(taskId);
    },
    addWebViewUrl(taskId: string, webViewUrl: string, processTaskId: string) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            webViewUrls: [
              ...state.tasks[taskId].webViewUrls,
              { url: webViewUrl, processTaskId: processTaskId },
            ],
          },
        },
      }));
    },
    setWebViewUrls(
      taskId: string,
      webViewUrls: { url: string; processTaskId: string }[]
    ) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            webViewUrls: [...webViewUrls],
          },
        },
      }));
    },
    setActiveAskList(taskId, askList) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            askList: [...askList],
          },
        },
      }));
    },
    setTaskAssigning(taskId, taskAssigning) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskAssigning: [...taskAssigning],
          },
        },
      }));
    },
    setStatus(taskId: string, status: ChatTaskStatusType) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            status,
          },
        },
      }));
    },
    handleConfirmTask: async (
      project_id: string,
      taskId: string,
      type?: string
    ) => {
      const {
        tasks,
        setMessages,
        setActiveWorkspace,
        setStatus,
        setTaskTime,
        setTaskInfo,
        setTaskRunning,
        setPlanDirty,
        setAutoConfirmDeadline,
      } = get();
      if (!taskId) return;
      const task = tasks[taskId];
      if (!task) return;

      const setLatestPlanConfirmed = (isConfirm: boolean) => {
        const latestTask = get().tasks[taskId];
        if (!latestTask) return;
        const messages = [...latestTask.messages];
        const cardTaskIndex = messages.findLastIndex(
          (message) => message.step === AgentStep.TO_SUB_TASKS
        );
        if (cardTaskIndex === -1) return;
        messages[cardTaskIndex] = {
          ...messages[cardTaskIndex],
          isConfirm,
          taskType: isConfirm ? 2 : messages[cardTaskIndex].taskType,
        };
        setMessages(taskId, messages);
      };

      // Stop any pending auto-confirm timers for this task (manual confirmation)
      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn(
          'Error clearing auto-confirm timer in handleConfirmTask:',
          error
        );
      }

      // record task start time
      setTaskTime(taskId, Date.now());
      // Filter out empty tasks from the user-edited taskInfo
      const taskInfo = task.taskInfo.filter((task) => task.content !== '');
      setTaskInfo(taskId, taskInfo);
      // Sync taskRunning with the filtered taskInfo (user edits should be reflected
      setTaskRunning(
        taskId,
        taskInfo.map((task) => ({ ...task }))
      );

      // IMPORTANT: Set isConfirm BEFORE sending API requests to prevent race condition
      // where backend sends to_sub_tasks SSE event before we mark task as confirmed
      setLatestPlanConfirmed(true);

      if (!type) {
        setActiveWorkspace(taskId, 'workflow');
        setStatus(taskId, ChatTaskStatus.RUNNING);
      }

      // Reset editing state after manual confirmation so next round can auto-start
      setPlanDirty(taskId, false);
    },
    addTaskInfo() {
      const { tasks, activeTaskId, setTaskInfo } = get();
      if (!activeTaskId) return;
      let targetTaskInfo = [...tasks[activeTaskId].taskInfo];
      const newTaskInfo = {
        id: '',
        content: '',
      };
      targetTaskInfo.push(newTaskInfo);
      setTaskInfo(activeTaskId, targetTaskInfo);
      // No backend persist here — the new task is empty, so it gets filtered out.
      // It will be persisted once the user types content (via updateTaskInfo).
    },
    addTerminal(taskId, processTaskId, terminal) {
      if (!processTaskId) return;
      const { tasks, setTaskAssigning } = get();
      const taskAssigning = [...tasks[taskId].taskAssigning];
      const taskAssigningIndex = taskAssigning.findIndex((task) =>
        task.tasks.find((task) => task.id === processTaskId)
      );
      if (taskAssigningIndex !== -1) {
        const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex(
          (task) => task.id === processTaskId
        );
        taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal ??= [];
        taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal?.push(
          terminal
        );
        console.log(
          taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal
        );
        setTaskAssigning(taskId, taskAssigning);
      }
    },
    setActiveAsk(taskId, agentName) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            activeAsk: agentName,
          },
        },
      }));
    },
    setProgressValue(taskId: string, progressValue: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            progressValue,
          },
        },
      }));
    },
    setIsPending(taskId: string, isPending: boolean) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              isPending,
            },
          },
        };
      });
    },
    setActiveWorkspace(taskId: string, activeWorkspace: string) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              activeWorkspace,
            },
          },
        };
      });
    },
    setActiveAgent(taskId: string, agent_id: string) {
      console.log('setActiveAgent', taskId, agent_id);

      set((state) => {
        if (!state.tasks[taskId]) return state;
        if (state.tasks[taskId]?.activeAgent === agent_id) {
          return state;
        }
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              activeAgent: agent_id,
            },
          },
        };
      });
    },
    setHasMessages(taskId: string, hasMessages: boolean) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            hasMessages,
          },
        },
      }));
    },
    setHasAddWorker(taskId: string, hasAddWorker: boolean) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            hasAddWorker,
          },
        },
      }));
    },
    addFileList(taskId, processTaskId, fileInfo) {
      const { tasks, setTaskAssigning } = get();
      const taskAssigning = [...tasks[taskId].taskAssigning];
      let agentId = '';
      const taskAssigningIndex = taskAssigning.findIndex((agent) => {
        const hasTask = agent.tasks.find((task) => task.id === processTaskId);
        if (hasTask) {
          agentId = agent.agent_id;
        }
        return hasTask;
      });
      if (taskAssigningIndex !== -1) {
        const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex(
          (task) => task.id === processTaskId
        );
        if (taskIndex !== -1) {
          taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList ??= [];
          taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList?.push({
            ...fileInfo,
            agent_id: agentId,
            task_id: processTaskId,
          });
          setTaskAssigning(taskId, taskAssigning);
        }
      }
    },
    setFileList(taskId, processTaskId, fileList: FileInfo[]) {
      const { tasks, setTaskAssigning } = get();
      const taskAssigning = [...tasks[taskId].taskAssigning];

      const taskAssigningIndex = taskAssigning.findIndex((task) =>
        task.tasks.find((task) => task.id === processTaskId)
      );
      const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex(
        (task) => task.id === processTaskId
      );
      if (taskAssigningIndex !== -1) {
        taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList = [
          ...fileList,
        ];
        setTaskAssigning(taskId, taskAssigning);
      }
    },
    updateTaskInfo(index: number, content: string) {
      const { tasks, activeTaskId, setTaskInfo } = get();
      if (!activeTaskId) return;
      const targetTaskInfo = tasks[activeTaskId].taskInfo.map((item, i) =>
        i === index ? { ...item, content } : item
      );
      setTaskInfo(activeTaskId, targetTaskInfo);
    },
    deleteTaskInfo(index: number) {
      const { tasks, activeTaskId, setTaskInfo } = get();
      if (!activeTaskId) return;
      const targetTaskInfo = [...tasks[activeTaskId].taskInfo];
      targetTaskInfo.splice(index, 1);
      setTaskInfo(activeTaskId, targetTaskInfo);
    },
    getLastUserMessage() {
      const { activeTaskId, tasks } = get();
      if (!activeTaskId) return null;
      return (
        tasks[activeTaskId]?.messages.findLast(
          (message: Message) => message.role === 'user'
        ) || null
      );
    },
    setTaskTime(taskId: string, taskTime: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            taskTime,
          },
        },
      }));
    },
    setNuwFileNum(taskId: string, nuwFileNum: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            nuwFileNum,
          },
        },
      }));
    },
    setType(taskId: string, type: string) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            type,
          },
        },
      }));
    },
    setDelayTime(taskId: string, delayTime: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            delayTime,
          },
        },
      }));
    },
    setElapsed(taskId: string, elapsed: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            elapsed,
          },
        },
      }));
    },
    getFormattedTaskTime(taskId: string) {
      const { tasks } = get();
      if (!taskId || !tasks[taskId]) return 'N/A';

      const task = tasks[taskId];
      let taskTime = task.taskTime;
      let elapsed = task.elapsed;
      let time = 0;
      // if task is running, compute current time
      if (taskTime !== 0) {
        const currentTime = Date.now();
        time = currentTime - taskTime + elapsed;
      } else {
        time = elapsed;
      }
      const hours = Math.floor(time / 3600000);
      const minutes = Math.floor((time % 3600000) / 60000);
      const seconds = Math.floor((time % 60000) / 1000);
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    },
    addTokens(taskId: string, tokens: number) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            tokens: state.tasks[taskId].tokens + tokens,
          },
        },
      }));
    },
    getTokens(taskId: string) {
      const { tasks } = get();
      return tasks[taskId]?.tokens ?? 0;
    },
    setSelectedFile(taskId: string, selectedFile: FileInfo | null) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              selectedFile: selectedFile,
            },
          },
        };
      });
    },
    setSnapshots(taskId: string, snapshots: any[]) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            snapshots,
          },
        },
      }));
    },
    setPlanDirty(taskId: string, dirty: boolean) {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            planDirty: dirty,
          },
        },
      }));
    },
    setAutoConfirmDeadline(taskId: string, deadline: number | null) {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              autoConfirmDeadline: deadline,
            },
          },
        };
      });
    },
    async savePlan(taskId: string) {
      const { tasks, setPlanDirty, setAutoConfirmDeadline } = get();
      const task = tasks[taskId];
      if (!task) return;
      setPlanDirty(taskId, false);

      // After Save, restart the 30-second auto-confirm timer for predictable UX.
      const projectId = useProjectStore.getState().activeProjectId;
      const lastToSubTasks = task.messages.findLast(
        (m: Message) => m.step === AgentStep.TO_SUB_TASKS
      );
      if (
        !projectId ||
        !lastToSubTasks ||
        lastToSubTasks.isConfirm ||
        task.isTakeControl
      ) {
        return;
      }

      try {
        if (autoConfirmTimers[taskId]) {
          clearTimeout(autoConfirmTimers[taskId]);
          delete autoConfirmTimers[taskId];
        }
        setAutoConfirmDeadline(taskId, null);
      } catch (error) {
        console.warn('Error clearing auto-confirm timer in savePlan:', error);
      }

      setAutoConfirmDeadline(taskId, Date.now() + AUTO_CONFIRM_TIMEOUT_MS);
      autoConfirmTimers[taskId] = setTimeout(() => {
        try {
          const latestState = get();
          const latest = latestState.tasks[taskId];
          if (!latest) {
            delete autoConfirmTimers[taskId];
            return;
          }
          const message = latest.messages.findLast(
            (item: Message) => item.step === AgentStep.TO_SUB_TASKS
          );
          const isConfirm = message?.isConfirm || false;
          const isTakeControl = latest.isTakeControl;

          if (projectId && !isConfirm && !isTakeControl && !latest.planDirty) {
            latestState.handleConfirmTask(projectId, taskId);
          }
          latestState.setPlanDirty(taskId, false);
          latestState.setAutoConfirmDeadline(taskId, null);
          delete autoConfirmTimers[taskId];
        } catch (error) {
          console.error('Error in savePlan auto-confirm handler:', error);
          get().setAutoConfirmDeadline(taskId, null);
          delete autoConfirmTimers[taskId];
        }
      }, AUTO_CONFIRM_TIMEOUT_MS);
    },
    clearTasks: () => {
      const { create } = get();
      console.log('clearTasks');

      // Clean up all pending auto-confirm timers when clearing tasks
      try {
        Object.keys(autoConfirmTimers).forEach((taskId) => {
          try {
            if (autoConfirmTimers[taskId]) {
              clearTimeout(autoConfirmTimers[taskId]);
              delete autoConfirmTimers[taskId];
            }
          } catch (error) {
            console.warn(`Error clearing timer for task ${taskId}:`, error);
          }
        });
      } catch (error) {
        console.error('Error during timer cleanup in clearTasks:', error);
      }

      // Clean up all active SSE connections
      try {
        Object.keys(activeSSEControllers).forEach((taskId) => {
          try {
            if (activeSSEControllers[taskId]) {
              activeSSEControllers[taskId].controller.abort();
              delete activeSSEControllers[taskId];
            }
          } catch (error) {
            console.warn(
              `Error aborting SSE connection for task ${taskId}:`,
              error
            );
          }
        });
      } catch (error) {
        console.error('Error during SSE cleanup in clearTasks:', error);
      }

      const restartPromise = getHostIpcRenderer()?.invoke?.('restart-backend');
      if (restartPromise) {
        restartPromise
          .then((res: unknown) => {
            console.log('restart-backend', res);
          })
          .catch((error: unknown) => {
            console.error('Error in clearTasks cleanup:', error);
          });
      }

      // Immediately create new task to maintain UI responsiveness
      const newTaskId = create();
      set((state) => ({
        ...state,
        tasks: {
          [newTaskId]: {
            ...state.tasks[newTaskId],
          },
        },
      }));
    },
    setIsContextExceeded: (taskId, isContextExceeded) => {
      set((state) => ({
        ...state,
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            isContextExceeded: isContextExceeded,
          },
        },
      }));
    },
    setNextTaskId: (taskId) => {
      set((state) => ({
        ...state,
        nextTaskId: taskId,
      }));
    },
    setStreamingDecomposeText: (taskId, text) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              streamingDecomposeText: text,
            },
          },
        };
      });
    },
    clearStreamingDecomposeText: (taskId) => {
      // Clear buffer and any pending timer
      delete streamingDecomposeTextBuffer[taskId];
      if (streamingDecomposeTextTimers[taskId]) {
        clearTimeout(streamingDecomposeTextTimers[taskId]);
        delete streamingDecomposeTextTimers[taskId];
      }

      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              streamingDecomposeText: '',
            },
          },
        };
      });
    },
    setExecutionId: (taskId, executionId) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              executionId,
            },
          },
        };
      });
    },
    setTaskSource: (taskId, source) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              source,
            },
          },
        };
      });
    },
    setNextExecutionId: (taskId, nextExecutionId) => {
      set((state) => {
        if (!state.tasks[taskId]) return state;
        return {
          ...state,
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              nextExecutionId,
            },
          },
        };
      });
    },
  }));


export const useChatStore = chatStore;

/** Create a new chat store instance. Use this in non-React code (e.g. projectStore). */
export const createChatStoreInstance = chatStore;

export const getToolStore = () => chatStore().getState();

/** Returns true if any task has an active SSE connection. */
export function hasActiveSSEConnection(taskIds: string[]): boolean {
  return taskIds.some((taskId) => !!activeSSEControllers[taskId]);
}

/**
 * Returns true when any run, in any Project, still has a live SSE
 * connection. Closing the window kills these streams and the backend
 * aborts the in-flight work, so the close guard must consider every
 * Project, not just the active one.
 */
export function hasAnyActiveRun(): boolean {
  return Object.values(activeSSEControllers).some(
    (connection) => connection.live
  );
}

/** Close SSE for given tasks (e.g. after completion, so triggers can start fresh). */
export function closeSSEConnectionsForTasks(taskIds: string[]): void {
  for (const taskId of taskIds) {
    if (activeSSEControllers[taskId]) {
      console.log(
        '[closeSSEConnectionsForTasks] Closing SSE for task:',
        taskId
      );
      try {
        activeSSEControllers[taskId].controller.abort();
      } catch (_e) {
        // Ignore if already aborted
      }
      delete activeSSEControllers[taskId];
    }
  }
}
