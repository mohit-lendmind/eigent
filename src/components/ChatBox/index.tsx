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

import { isWeb } from '@/client/platform';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useHost } from '@/host';
import {
  isProjectAchieved,
  setProjectAchievedState,
} from '@/lib/projectAchievement';
import { inferSessionModeFromTask, resolveSessionMode } from '@/lib/sessionMode';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import BottomBox from './BottomBox';
import { ProjectChatContainer } from './ProjectChatContainer';
import { PLAN_OVERLAY_SLOT_ID } from './TaskBox/PlanTaskBox';

/** Minimum scroll padding under messages (matches previous ~8rem floor). */
const CHAT_SCROLL_BOTTOM_MIN_PX = 128;
/** Small gap between last message and BottomBox top. */
const CHAT_SCROLL_BOTTOM_GAP_PX = 8;

export default function ChatBox(): JSX.Element {
  const [message, setMessage] = useState<string>('');
  const host = useHost();

  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const { t } = useTranslation();
  const textareaRef = useRef<HTMLDivElement>(null);
  const workspaceChatFocusRequestId = usePageTabStore(
    (s) => s.workspaceChatFocusRequestId
  );
  const activeProjectId = projectStore.activeProjectId;
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const updateProjectMeta = useSpaceStore((s) => s.updateProjectMeta);
  const activeProject = activeProjectId
    ? projectStore.getProjectById(activeProjectId)
    : null;
  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : undefined;
  // Project mode in three forms: `inferred` is a legacy Run fallback;
  // `effective` always resolves to a concrete mode; `display` stays nullable
  // so a still-loading Project renders empty instead of the wrong mode.
  const inferredSessionMode = inferSessionModeFromTask(activeTask, null);
  const activeProjectMode = activeProjectMeta?.mode ?? activeProject?.mode;
  const resolvedSessionMode = resolveSessionMode(
    activeProjectMode,
    inferredSessionMode
  );
  const effectiveSessionMode = resolvedSessionMode ?? SessionMode.SINGLE_AGENT;
  const displaySessionMode = resolvedSessionMode ?? undefined;
  const ensureActiveProjectMode = useCallback(() => {
    const projectId = projectStore.activeProjectId;
    if (!projectId || activeProjectMode === effectiveSessionMode) return;
    // A stored mode is only overwritten upward: a run that delegated makes the
    // Project a workforce one for good, and nothing turns it back.
    if (activeProjectMode && effectiveSessionMode !== SessionMode.WORKFORCE) {
      return;
    }
    updateProjectMeta(projectId, { mode: effectiveSessionMode });
  }, [
    activeProjectMode,
    effectiveSessionMode,
    projectStore,
    updateProjectMeta,
  ]);
  const { hasModel } = useModelConfigCheck();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomBoxOverlayRef = useRef<HTMLDivElement>(null);
  const [scrollBottomInsetPx, setScrollBottomInsetPx] = useState(
    CHAT_SCROLL_BOTTOM_MIN_PX
  );
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { modelType } = useAuthStore();
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);

  useEffect(() => {
    // Only show warning message, don't block functionality
    if (
      import.meta.env.VITE_USE_LOCAL_PROXY === 'true' &&
      modelType === 'cloud'
    ) {
      setUseCloudModelInDev(true);
    } else {
      setUseCloudModelInDev(false);
    }
  }, [modelType]);
  useEffect(() => {
    if (workspaceChatFocusRequestId === 0) return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);
    return () => clearTimeout(focusTimer);
  }, [workspaceChatFocusRequestId]);

  const [searchParams, setSearchParams] = useSearchParams();
  const skill_prompt = searchParams.get('skill_prompt');

  const handleSendRef = useRef<
    ((messageStr?: string, taskId?: string) => Promise<void>) | null
  >(null);

  const navigate = useNavigate();

  const handleSelectModel = useCallback(() => {
    navigate('/history?tab=agents');
  }, [navigate]);

  // Task time tracking
  const [, setTaskTime] = useState(
    chatStore?.getFormattedTaskTime(chatStore?.activeTaskId as string) ||
      '00:00'
  );

  const [loading, setLoading] = useState(false);
  const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);

  useEffect(() => {
    if (!chatStore?.activeTaskId) return;
    const interval = setInterval(() => {
      if (chatStore.activeTaskId) {
        setTaskTime(chatStore.getFormattedTaskTime(chatStore.activeTaskId));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [chatStore?.activeTaskId, chatStore]);

  const getAllChatStoresMemoized = useMemo(() => {
    if (!projectStore.activeProjectId) return [];
    return projectStore.getAllChatStores(projectStore.activeProjectId);
  }, [projectStore]);

  // Check if any chat store in the project has messages
  const hasAnyMessages = useMemo(() => {
    const hasMessages = (store: typeof chatStore) =>
      !!store &&
      Object.values(store.tasks).some(
        (task) => (task.messages?.length || 0) > 0 || task.hasMessages
      );

    if (hasMessages(chatStore)) return true;

    // Then check all other chat stores in the project
    return getAllChatStoresMemoized.some(({ chatStore: store }) => {
      const state = store.getState();
      return Object.values(state.tasks).some(
        (task) => (task.messages?.length || 0) > 0 || task.hasMessages
      );
    });
  }, [chatStore, getAllChatStoresMemoized]);

  useLayoutEffect(() => {
    if (!chatStore?.activeTaskId || !hasAnyMessages) return;

    const el = bottomBoxOverlayRef.current;
    if (!el) return;

    const measure = () => {
      const raw = el.getBoundingClientRect().height;
      setScrollBottomInsetPx(
        Math.max(
          CHAT_SCROLL_BOTTOM_MIN_PX,
          Math.round(raw) + CHAT_SCROLL_BOTTOM_GAP_PX
        )
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chatStore?.activeTaskId, hasAnyMessages]);

  const isTaskBusy = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return false;
    const task = chatStore.tasks[chatStore.activeTaskId];

    return (
      // running or paused
      task.status === ChatTaskStatus.RUNNING ||
      task.status === ChatTaskStatus.PAUSE ||
      // splitting phase
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      // skeleton/computing phase
      ((task.status as string) !== ChatTaskStatus.FINISHED &&
        (task.status as string) !== ChatTaskStatus.RUNNING &&
        !task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      task.isTakeControl
    );
  }, [chatStore?.activeTaskId, chatStore?.tasks]);

  const isInputDisabled = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return true;

    const task = chatStore.tasks[chatStore.activeTaskId];

    if (isTaskBusy) return true;

    // Standard checks - check model
    if (!hasModel) return true;
    if (useCloudModelInDev) return true;
    if (task.isContextExceeded) return true;

    return false;
  }, [
    chatStore?.activeTaskId,
    chatStore?.tasks,
    hasModel,
    useCloudModelInDev,
    isTaskBusy,
  ]);

  // Handle skill_prompt from URL - pre-fill message when navigating from Skills page
  useEffect(() => {
    if (skill_prompt) {
      setMessage(skill_prompt);
      // Clear the skill_prompt param from URL after setting the message
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('skill_prompt');
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [skill_prompt, searchParams, setSearchParams]);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current!.scrollTo({
          top: scrollContainerRef.current!.scrollHeight + 20,
          behavior: 'smooth',
        });
      }, 200);
    }
  }, []);

  // Handle scrollbar visibility on scroll
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      // Add scrolling class
      scrollContainer.classList.add('scrolling');

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Remove scrolling class after 1 second of no scrolling
      scrollTimeoutRef.current = setTimeout(() => {
        scrollContainer.classList.remove('scrolling');
      }, 1000);
    };

    scrollContainer.addEventListener('scroll', handleScroll);

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const handleSend = async (
    messageStr?: string,
    taskId?: string,
    executionId?: string
  ) => {
    const _taskId = taskId || chatStore.activeTaskId;
    if (message.trim() === '' && !messageStr) return;

    if (!hasModel) {
      toast.error('Please select a model first.');
      navigate('/history?tab=agents');
      return;
    }

    const targetProjectId = projectStore.activeProjectId;
    if (!targetProjectId) {
      toast.error('No active Project selected.');
      return;
    }

    const targetProjectMeta = useSpaceStore
      .getState()
      .getProjectMeta(targetProjectId);
    const shouldResumeProject = isProjectAchieved(targetProjectMeta?.metadata);

    const rawMessageContent = messageStr || message;
    let tempMessageContent = rawMessageContent;

    if (executionId && targetProjectId) {
      const project = projectStore.getProjectById(targetProjectId);
      const isInQueue = project?.queuedMessages?.some(
        (m) => m.executionId === executionId
      );
      if (isInQueue) {
        console.warn(
          `[handleSend] Skipping message with executionId ${executionId} - already in queue, will be processed by useBackgroundTaskProcessor`
        );
        return;
      }
    }
    chatStore.setHasMessages(_taskId as string, true);
    if (!_taskId) return;

    // Multi-turn support: Check if task is running or planning (splitting/confirm)
    const task = chatStore.tasks[_taskId];
    const isTaskBusy =
      (task.status === ChatTaskStatus.RUNNING && task.hasMessages) ||
      task.status === ChatTaskStatus.PAUSE ||
      // splitting phase: has to_sub_tasks not confirmed OR skeleton computing
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      (!task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0 &&
        task.status !== ChatTaskStatus.FINISHED) ||
      task.isTakeControl ||
      // explicit confirm wait while task is pending but card not confirmed yet
      (!!task.messages.find(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) &&
        task.status === ChatTaskStatus.PENDING);
    const _isTaskInProgress = ['running', 'pause'].includes(task?.status || '');
    const isReplayChatStore = task?.type === 'replay';
    if (isTaskBusy && !isReplayChatStore) {
      toast.error(
        'Current task is in progress. Please wait for it to finish before sending a new request.',
        {
          closeButton: true,
        }
      );
      return;
    }

    if (shouldResumeProject) {
      void setProjectAchievedState({
        projectStore,
        projectId: targetProjectId,
        achieved: false,
      }).catch((error) => {
        console.error('[handleSend] Failed to resume achieved Project:', error);
        toast.error('Failed to persist resumed Project state.');
      });
    }

    if (textareaRef.current) textareaRef.current.style.height = '60px';
    try {
      // Check if we should continue the conversation or start a new task
      const hasMessages =
        chatStore.tasks[_taskId as string].messages.length > 0;
      const isFinished =
        chatStore.tasks[_taskId as string].status === 'finished';
      const hasWaitComfirm =
        chatStore.tasks[_taskId as string]?.hasWaitComfirm;

      // Check if this task was manually stopped (finished but without natural completion)
      const wasTaskStopped =
        isFinished &&
        !chatStore.tasks[_taskId as string].messages.some(
          (m) => m.step === 'end' // Natural completion has an "end" step message
        );

      // Continue conversation if:
      // 1. Has wait confirm (simple query response) - but not if task was stopped
      // 2. Task is naturally finished (complex task completed) - but not if task was stopped
      // 3. Has any messages but pending (ongoing conversation)
      const shouldContinueConversation =
        (hasWaitComfirm && !wasTaskStopped) ||
        (isFinished && !wasTaskStopped) ||
        (hasMessages &&
          chatStore.tasks[_taskId as string].status ===
            ChatTaskStatus.PENDING);

      if (shouldContinueConversation) {
        // Check if this is the very first message and task hasn't started
        const hasSimpleResponse = chatStore.tasks[
          _taskId as string
        ].messages.some((m) => m.step === 'wait_confirm');
        const hasComplexTask = chatStore.tasks[
          _taskId as string
        ].messages.some((m) => m.step === 'to_sub_tasks');
        const hasErrorMessage = chatStore.tasks[
          _taskId as string
        ].messages.some(
          (m) => m.role === 'agent' && m.content.startsWith('❌ **Error**:')
        );

        // Only start a new task if: pending, no messages processed yet
        // OR while or after replaying a project
        if (
          (chatStore.tasks[_taskId as string].status ===
            ChatTaskStatus.PENDING &&
            !hasSimpleResponse &&
            !hasComplexTask &&
            !isFinished) ||
          chatStore.tasks[_taskId].type === 'replay' ||
          hasErrorMessage
        ) {
          setMessage('');
          // Pass the message content to startTask instead of adding it to current chatStore
          const attachesToSend =
            JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
            [];
          try {
            ensureActiveProjectMode();
            await chatStore.startTask(
              _taskId,
              tempMessageContent,
              attachesToSend,
              executionId,
              targetProjectId,
              effectiveSessionMode
            );
            chatStore.setAttaches(_taskId, []);
            // If activeTaskId changed (new task created), clear its draft too
            const newActiveId = chatStore.activeTaskId;
            if (newActiveId && newActiveId !== _taskId) {
              chatStore.setAttaches(newActiveId, []);
            }
          } catch (err: any) {
            console.error('Failed to start task:', err);
            toast.error(
              err?.message ||
                'Failed to start task. Please check your model configuration.'
            );
            return;
          }
          // keep hasWaitComfirm as true so that follow-up improves work as usual
        } else {
          // A follow-up is just another command on the same aion Project:
          // the conversation context lives server-side, so the normal start
          // path serves it and opens the next turn's pane.
          const remoteAttaches = JSON.parse(
            JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
          );
          setMessage('');
          try {
            ensureActiveProjectMode();
            await chatStore.startTask(
              _taskId,
              tempMessageContent,
              remoteAttaches,
              executionId,
              targetProjectId,
              effectiveSessionMode
            );
            chatStore.setAttaches(_taskId, []);
            const remoteActiveId = chatStore.activeTaskId;
            if (remoteActiveId && remoteActiveId !== _taskId) {
              chatStore.setAttaches(remoteActiveId, []);
            }
          } catch (err: any) {
            console.error('Failed to start follow-up task:', err);
            toast.error(err?.message || 'Failed to send message.');
          }
        }
      } else {
        setTimeout(() => {
          scrollToBottom();
        }, 200);

        // For the very first message, add it to the current chatStore first, then call startTask
        const attachesToSend =
          JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
          [];
        setMessage('');
        try {
          ensureActiveProjectMode();
          await chatStore.startTask(
            _taskId,
            tempMessageContent,
            attachesToSend,
            executionId,
            targetProjectId,
            effectiveSessionMode
          );
          chatStore.setHasWaitComfirm(_taskId as string, true);
          chatStore.setAttaches(_taskId, []);
          // If activeTaskId changed (new task created), clear its draft too
          const newActiveId2 = chatStore.activeTaskId;
          if (newActiveId2 && newActiveId2 !== _taskId) {
            chatStore.setAttaches(newActiveId2, []);
          }
        } catch (err: any) {
          console.error('Failed to start task:', err);
          toast.error(
            err?.message ||
              'Failed to start task. Please check your model configuration.'
          );
          return;
        }
      }
    } catch (error) {
      console.error('error:', error);
    }
  };

  handleSendRef.current = handleSend;

  // Reactive queuedMessages for the active project
  const queuedMessages = useMemo(() => {
    const pid = projectStore.activeProjectId;
    if (!pid) return [];
    const project = projectStore.getProjectById(pid);
    return (project?.queuedMessages || []).map((m) => ({
      id: m.task_id,
      content: m.content,
      timestamp: m.timestamp,
    }));
  }, [projectStore]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const handleConfirmTask = async (taskId?: string) => {
    const _taskId = taskId || chatStore.activeTaskId;
    if (!_taskId || !projectStore.activeProjectId) {
      return;
    }
    setLoading(true);
    await chatStore.handleConfirmTask(projectStore.activeProjectId, _taskId);
    setLoading(false);
  };

  // File selection handler
  const handleFileSelect = async () => {
    try {
      const taskId = chatStore.activeTaskId as string;
      const existingFiles = chatStore.tasks[taskId].attaches || [];

      // An attachment is a path the agent's workspace can open, and only the
      // desktop app can produce one.
      if (isWeb()) {
        toast.error('Attaching files requires the desktop app.');
        return;
      }

      const result = await host?.electronAPI?.selectFile({
        title: t('chat.select-file'),
        filters: [{ name: t('chat.all-files'), extensions: ['*'] }],
      });

      if (result?.success && result.files && result.files.length > 0) {
        const files = [
          ...existingFiles,
          ...result.files.filter(
            (r: File) =>
              !existingFiles.some((f: File) => f.filePath === r.filePath)
          ),
        ];
        chatStore.setAttaches(taskId, files);
      }
    } catch (error) {
      console.error('Select File Error:', error);
    }
  };

  // Stopping ends the turn but keeps the Project: the conversation continues
  // from where it stopped rather than starting over.
  const handleSkip = async () => {
    const taskId = chatStore.activeTaskId as string;
    setIsPauseResumeLoading(true);

    try {
      chatStore.stopTask(taskId);
      chatStore.setIsPending(taskId, false);
      toast.success('Task stopped successfully', {
        closeButton: true,
      });
    } catch (error) {
      console.error('Failed to stop task:', error);
      toast.error('Failed to stop task. Please refresh the page.', {
        closeButton: true,
      });
    } finally {
      setIsPauseResumeLoading(false);
    }
  };

  // Edit query handler
  const handleEditQuery = async () => {
    const taskId = chatStore.activeTaskId as string;
    const projectId = projectStore.activeProjectId;

    // Early validation
    if (!projectId) {
      console.error('No active project ID found for edit operation');
      return;
    }

    // Get question and attachments before any deletions
    const messageIndex = chatStore.tasks[taskId].messages.findLastIndex(
      (item) => item.step === 'to_sub_tasks'
    );
    const questionMessage = chatStore.tasks[taskId].messages[messageIndex - 2];
    const question = questionMessage.content;
    // Get the file attachments from the original user message (not from task.attaches which gets cleared after sending)
    const attachments = questionMessage.attaches || [];

    // Create new task and clean up locally
    let id = chatStore.create();
    chatStore.setHasMessages(id, true);
    // Copy the file attachments to the new task
    if (attachments.length > 0) {
      chatStore.setAttaches(id, attachments);
    }
    chatStore.removeTask(taskId);
    setMessage(question);
  };

  // Determine BottomBox state
  const getBottomBoxState = () => {
    if (!chatStore.activeTaskId) return 'input';
    const task = chatStore.tasks[chatStore.activeTaskId];

    // The plan-mode splitting UI now lives in PlanTaskBox, not BottomBox.
    // BottomBox surfaces the action for the unconfirmed plan: `save` if the
    // user has unsaved subtask edits, otherwise `confirm`.
    const toSubTasksMessage = task.messages.find(
      (m) => m.step === 'to_sub_tasks' && !m.isConfirm
    );

    if (
      toSubTasksMessage &&
      !toSubTasksMessage.isConfirm &&
      task.status === 'pending'
    ) {
      return task.planDirty ? 'save' : 'confirm';
    }
    if (toSubTasksMessage && !toSubTasksMessage.isConfirm) {
      return task.planDirty ? 'save' : 'confirm';
    }

    // Check task status
    if (task.status === ChatTaskStatus.PAUSE) {
      return 'running';
    }
    if (task.status === ChatTaskStatus.RUNNING) {
      const hasSubTasks = task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS
      );
      const isDirectMode =
        !hasSubTasks && (task.taskAssigning?.length ?? 0) > 0;
      return isDirectMode ? 'input' : 'running';
    }

    if (task.status === 'finished' && task.type !== '') {
      return 'finished';
    }

    return 'input';
  };

  const handleRemoveTaskQueue = (task_id: string) => {
    const project_id = projectStore.activeProjectId;
    if (!project_id) {
      console.error('No active project ID found');
      return;
    }
    projectStore.removeQueuedMessage(project_id, task_id);
  };

  const chatColumn = (
    <>
      {/* Main: scroll (scrollbar on panel edge) + BottomBox overlay when chatting */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="scrollbar-always-visible min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pl-2"
        >
          {hasAnyMessages ? (
            <ProjectChatContainer
              scrollContainerRef={scrollContainerRef}
              scrollBottomInsetPx={scrollBottomInsetPx}
              onSkip={handleSkip}
              isPauseResumeLoading={isPauseResumeLoading}
            />
          ) : (
            <div className="mx-auto flex min-h-full w-full max-w-[600px] flex-col">
              <div className="flex flex-1 flex-col items-center justify-end gap-1 pb-4"></div>

              {chatStore.activeTaskId && (
                <BottomBox
                  state="input"
                  queuedMessages={queuedMessages}
                  onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                  noModelOverlay={!hasModel}
                  onSelectModel={handleSelectModel}
                  inputProps={{
                    value: message,
                    onChange: setMessage,
                    onSend: handleSend,
                    files:
                      chatStore.tasks[chatStore.activeTaskId]?.attaches?.map(
                        (f) => ({
                          fileName: f.fileName,
                          filePath: f.filePath,
                        })
                      ) || [],
                    onFilesChange: (files) =>
                      chatStore.setAttaches(
                        chatStore.activeTaskId as string,
                        files as any
                      ),
                    onAddFile: handleFileSelect,
                    disabled: isInputDisabled,
                    textareaRef: textareaRef,
                    allowDragDrop: true,
                    useCloudModelInDev: useCloudModelInDev,
                  }}
                  sessionMode={effectiveSessionMode}
                  sessionModeSelectInteractive={false}
                  modelSelectProjectId={activeProjectId}
                />
              )}
            </div>
          )}
        </div>

        {chatStore.activeTaskId && hasAnyMessages && (
          <div id={PLAN_OVERLAY_SLOT_ID} className="contents" />
        )}
        {chatStore.activeTaskId && hasAnyMessages && (
          <div
            ref={bottomBoxOverlayRef}
            data-bottom-box-overlay
            className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center"
          >
            <div className="pointer-events-auto mx-auto w-full max-w-[600px] rounded-t-3xl bg-ds-bg-neutral-subtle-default px-2 pb-1">
              <BottomBox
                state={getBottomBoxState()}
                queuedMessages={queuedMessages}
                onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                noModelOverlay={!hasModel}
                onSelectModel={handleSelectModel}
                subtitle={
                  getBottomBoxState() === 'confirm' ||
                  getBottomBoxState() === 'save'
                    ? (() => {
                        const messages =
                          chatStore.tasks[chatStore.activeTaskId]?.messages ||
                          [];
                        const lastUserMessage = messages
                          .slice()
                          .reverse()
                          .find((msg) => msg.role === 'user');
                        return (
                          lastUserMessage?.content ||
                          chatStore.tasks[chatStore.activeTaskId]?.summaryTask
                        );
                      })()
                    : chatStore.tasks[chatStore.activeTaskId]?.summaryTask
                }
                autoStartDeadline={
                  chatStore.tasks[chatStore.activeTaskId]?.autoConfirmDeadline
                }
                onStartTask={() => handleConfirmTask()}
                onSavePlan={async () => {
                  if (chatStore.activeTaskId) {
                    setLoading(true);
                    await chatStore.savePlan(chatStore.activeTaskId);
                    setLoading(false);
                  }
                }}
                onEdit={handleEditQuery}
                loading={loading}
                inputProps={{
                  value: message,
                  onChange: setMessage,
                  onSend: handleSend,
                  files:
                    chatStore.tasks[chatStore.activeTaskId]?.attaches?.map(
                      (f) => ({
                        fileName: f.fileName,
                        filePath: f.filePath,
                      })
                    ) || [],
                  onFilesChange: (files) =>
                    chatStore.setAttaches(
                      chatStore.activeTaskId as string,
                      files as any
                    ),
                  onAddFile: handleFileSelect,
                  placeholder: t('chat.follow-up-placeholder'),
                  disabled: isInputDisabled,
                  textareaRef: textareaRef,
                  allowDragDrop: true,
                  useCloudModelInDev: useCloudModelInDev,
                }}
                sessionMode={displaySessionMode}
                sessionModeSelectInteractive={false}
                modelSelectProjectId={activeProjectId}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {chatColumn}
    </div>
  );
}
