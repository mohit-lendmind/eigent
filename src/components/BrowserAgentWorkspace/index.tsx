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

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import type { SelectedProjectTurn } from '@/hooks/useSelectedProjectTurn';
import { useHost } from '@/host';
import { TaskStatus } from '@/types/constants';
import {
  ArrowDown,
  ArrowUp,
  Bird,
  ChevronLeft,
  CodeXml,
  FileText,
  GalleryThumbnails,
  Globe,
  Hand,
  Image,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TaskState } from '../TaskState';
import { Button } from '../ui/button';
import { DesktopBrowserControls } from './DesktopBrowserControls';

export default function BrowserAgentWorkspace({
  selectedTurn,
}: {
  selectedTurn?: SelectedProjectTurn;
}) {
  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();
  const host = useHost();

  const [isSingleMode, setIsSingleMode] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const agentMap = {
    developer_agent: {
      name: 'Developer Agent',
      icon: (
        <CodeXml size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-emerald-700',
      bgColor: 'bg-ds-bg-terminal-default-default',
      shapeColor: 'bg-ds-bg-terminal-subtle-default',
      borderColor: 'border-ds-border-terminal-default-default',
      bgColorLight: 'bg-emerald-200',
    },
    browser_agent: {
      name: 'Browser Agent',
      icon: (
        <Globe size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-blue-700',
      bgColor: 'bg-ds-bg-browser-default-default',
      shapeColor: 'bg-ds-bg-browser-subtle-default',
      borderColor: 'border-ds-border-browser-default-default',
      bgColorLight: 'bg-blue-200',
    },
    document_agent: {
      name: 'Document Agent',
      icon: (
        <FileText size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-yellow-700',
      bgColor: 'bg-ds-bg-document-default-default',
      shapeColor: 'bg-ds-bg-document-subtle-default',
      borderColor: 'border-ds-border-document-default-default',
      bgColorLight: 'bg-yellow-200',
    },
    multi_modal_agent: {
      name: 'Multi Modal Agent',
      icon: (
        <Image size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-fuchsia-700',
      bgColor: 'bg-ds-bg-neutral-default-default',
      shapeColor: 'bg-ds-bg-neutral-subtle-default',
      borderColor: 'border-ds-border-neutral-default-default',
      bgColorLight: 'bg-fuchsia-200',
    },
    social_media_agent: {
      name: 'Social Media Agent',
      icon: <Bird size={16} className="text-ds-text-neutral-default-default" />,
      textColor: 'text-purple-700',
      bgColor: 'bg-violet-700',
      shapeColor: 'bg-violet-300',
      borderColor: 'border-violet-700',
      bgColorLight: 'bg-purple-50',
    },
  };
  // Extract complex expressions to avoid lint error in dependency array
  const selectedChatState = selectedTurn?.chatStore?.getState();
  const targetChatStore = selectedChatState ?? chatStore;
  const activeTaskId =
    selectedTurn?.taskId ?? (targetChatStore?.activeTaskId as string);
  const taskAssigning = targetChatStore?.tasks[activeTaskId]?.taskAssigning;
  const activeWorkspace = targetChatStore?.tasks[activeTaskId]?.activeWorkspace;

  // Derive activeAgent from taskAssigning and activeWorkspace (no setState in effect)
  const activeAgent = useMemo(() => {
    if (!taskAssigning) return null;
    return (
      taskAssigning.find((item) => item.agent_id === activeWorkspace) ?? null
    );
  }, [taskAssigning, activeWorkspace]);

  const [isTakeControl, setIsTakeControl] = useState(false);

  // An aion run's browser card renders the run's published frames, newest
  // last, whether the page ran in a sandbox pod (remote — nothing to attach
  // to, no takeover to offer) or in the agent's own window on this desktop
  // (local — the filmstrip is the same server evidence, and takeover rides
  // the agent-browser bridge via the controls strip, not a webview id).
  const filmView = useMemo(() => {
    const views = activeAgent?.activeWebviewIds ?? [];
    return views.length === 1 && (views[0]?.remote || views[0]?.local)
      ? views[0]
      : null;
  }, [activeAgent]);
  const shownFrames = useMemo(() => filmView?.frames ?? [], [filmView]);
  // Which frame the user is looking at, pinned by URL rather than by position:
  // only the tail of a run's frames is resolved, so the same index names a
  // different frame once the window slides. An unpinned card — and one whose
  // pinned frame has aged out of the window — follows the newest frame.
  const [pinnedFrame, setPinnedFrame] = useState<string | null>(null);
  const shownFrame =
    pinnedFrame && shownFrames.includes(pinnedFrame)
      ? pinnedFrame
      : (shownFrames[shownFrames.length - 1] ?? '');

  const getSize = useCallback(() => {
    const webviewContainer = document.getElementById('webview-container');
    if (webviewContainer) {
      const rect = webviewContainer.getBoundingClientRect();
      host?.electronAPI?.setSize?.({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [host]);

  // Handing the window over is all the desktop can do on its own: the agent
  // keeps its turn, so the browser is shared rather than taken.
  const handleTakeControl = (id: string) => {
    setIsTakeControl(true);
    setTimeout(() => {
      getSize();
      // show corresponding webview
      host?.electronAPI?.showWebview?.(id);
    }, 400);
  };

  // listen to webview container size
  useEffect(() => {
    const webviewContainer = document.getElementById('webview-container');
    if (webviewContainer) {
      const resizeObserver = new ResizeObserver(() => {
        getSize();
      });
      resizeObserver.observe(webviewContainer);

      return () => {
        resizeObserver.disconnect();
      };
    }
  }, [getSize]);

  const [_url, setUrl] = useState('');

  useEffect(() => {
    host?.ipcRenderer?.on('url-updated', (_event: any, newUrl: any) => {
      setUrl(newUrl);
    });

    // optional: clear listener when uninstall
    return () => {
      host?.ipcRenderer?.removeAllListeners?.('url-updated');
    };
  }, [host]);

  if (!targetChatStore) {
    return <div>Loading...</div>;
  }

  return isTakeControl ? (
    <div className="flex h-full w-full flex-col items-center justify-start rounded-xl border border-solid border-ds-border-status-completed-default-default bg-ds-bg-neutral-strong-default">
      <div className="flex w-full items-start justify-start gap-sm p-sm">
        <div className="rounded-full border border-solid border-ds-border-neutral-strong-default bg-transparent p-1">
          <Button
            onClick={() => {
              setIsTakeControl(false);
              host?.electronAPI?.hideAllWebview?.();
            }}
            size="sm"
            variant="success"
            className="rounded-full"
          >
            <ChevronLeft size={16} />
            <span>Give back to Agent</span>
          </Button>
        </div>
        {/* <div className="mx-2 bg-border-primary">{url}</div> */}
      </div>
      <div id="webview-container" className="h-full w-full"></div>
    </div>
  ) : (
    <div className="flex h-full w-full flex-1 items-center justify-center">
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-ds-bg-neutral-default-default backdrop-blur-sm">
        <div className="flex flex-shrink-0 items-center justify-between rounded-t-2xl px-2 pb-2 pt-3">
          <div className="flex items-center justify-start gap-sm">
            <Button
              size="xs"
              buttonContent="icon-only"
              variant="ghost"
              onClick={() => {
                targetChatStore.setActiveWorkspace(activeTaskId, 'workflow');
              }}
            >
              <ChevronLeft size={16} />
            </Button>
            <div
              className={`text-base font-bold leading-snug ${
                agentMap[activeAgent?.type as keyof typeof agentMap]?.textColor
              }`}
            >
              {agentMap[activeAgent?.type as keyof typeof agentMap]?.name}
            </div>
            <TaskState
              all={activeAgent?.tasks?.length || 0}
              reAssignTo={
                activeAgent?.tasks?.filter((task) => task.reAssignTo).length ||
                0
              }
              done={
                activeAgent?.tasks?.filter(
                  (task) =>
                    task.status === TaskStatus.COMPLETED && !task.reAssignTo
                ).length || 0
              }
              progress={
                activeAgent?.tasks?.filter(
                  (task) =>
                    task.status !== TaskStatus.FAILED &&
                    task.status !== TaskStatus.COMPLETED &&
                    task.status !== TaskStatus.SKIPPED &&
                    task.status !== TaskStatus.WAITING &&
                    task.status !== TaskStatus.EMPTY &&
                    !task.reAssignTo
                ).length || 0
              }
              failed={
                activeAgent?.tasks?.filter(
                  (task) =>
                    task.status === TaskStatus.FAILED && !task.reAssignTo
                ).length || 0
              }
              skipped={
                activeAgent?.tasks?.filter(
                  (task) =>
                    (task.status === TaskStatus.SKIPPED ||
                      task.status === TaskStatus.WAITING ||
                      task.status === TaskStatus.EMPTY) &&
                    !task.reAssignTo
                ).length || 0
              }
            />
            {/* <div className="text-[10px] leading-17 font-medium text-ds-text-neutral-muted-default">
							{
								activeAgent?.tasks?.filter(
									(task) => task.status && task.status !== "running"
								).length
							}
							/{activeAgent?.tasks?.length}
						</div> */}
          </div>
          {/* <div className="w-6 h-6 flex items-center justify-center">
						<Settings2 size={16} />
					</div> */}
        </div>

        {filmView ? (
          <div
            data-testid="browser-filmstrip"
            data-frame-count={filmView.frameCount ?? 0}
            className="flex min-h-0 flex-1 flex-col gap-sm px-2 pb-2"
          >
            {filmView.local && (
              <DesktopBrowserControls
                runId={filmView.processTaskId}
                sessionMode={filmView.sessionMode}
              />
            )}
            <div className="flex items-center justify-between gap-sm text-xs leading-17 text-ds-text-neutral-muted-default">
              <div className="flex items-center gap-1">
                <GalleryThumbnails size={14} />
                <span>
                  {filmView.frameCount
                    ? `Filmstrip · ${shownFrames.length} of ${filmView.frameCount} frames`
                    : 'Filmstrip'}
                </span>
              </div>
              <span className="truncate">{filmView.url}</span>
            </div>
            <div className="min-h-0 flex-1">
              {shownFrame ? (
                <img
                  data-testid="browser-filmstrip-current"
                  src={shownFrame}
                  alt=""
                  className="h-full w-full rounded-lg object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center rounded-lg text-sm text-ds-text-neutral-muted-default">
                  Waiting for the first frame…
                </div>
              )}
            </div>
            {shownFrames.length > 1 && (
              <div className="scrollbar flex flex-shrink-0 gap-1 overflow-x-auto">
                {shownFrames.map((frame) => (
                  <button
                    key={frame}
                    type="button"
                    data-testid="browser-filmstrip-frame"
                    onClick={() => setPinnedFrame(frame)}
                    className={`h-12 flex-shrink-0 overflow-hidden rounded border border-solid ${
                      frame === shownFrame
                        ? 'border-ds-border-browser-default-default'
                        : 'border-ds-border-neutral-default-default'
                    }`}
                  >
                    <img src={frame} alt="" className="h-full w-auto" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : activeAgent?.activeWebviewIds?.length === 1 ? (
          <div className="min-h-0 flex-1">
            {activeAgent?.activeWebviewIds[0]?.img && (
              <div
                onClick={() =>
                  handleTakeControl(
                    activeAgent?.activeWebviewIds?.[0]?.id || ''
                  )
                }
                className="group relative h-full w-full cursor-pointer rounded-b-2xl pt-sm"
              >
                <img
                  src={activeAgent?.activeWebviewIds[0]?.img}
                  alt=""
                  className="h-full w-full rounded-b-2xl object-contain"
                />
                <div className="bg-dialog-overlay-dark pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center rounded-b-lg opacity-0 transition-opacity group-hover:opacity-[0.67]">
                  <Button
                    size="sm"
                    variant="primary"
                    className="cursor-pointer rounded-full"
                  >
                    <Hand size={24} />
                    <span className="text-base font-medium leading-9">
                      Take Control
                    </span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            className={`${
              isSingleMode ? 'px-0' : 'px-2 pb-2'
            } scrollbar relative flex min-h-0 flex-1 flex-wrap justify-start gap-4 overflow-y-auto`}
          >
            {activeAgent?.activeWebviewIds
              ?.filter((item) => item?.img)
              .map((item, index) => {
                return (
                  <div
                    key={index}
                    onClick={() => handleTakeControl(item.id)}
                    className={`card-box group relative cursor-pointer rounded-lg ${
                      isSingleMode
                        ? 'h-[calc(100%)] w-[calc(100%)]'
                        : 'h-[calc(50%-8px)] w-[calc(50%-8px)]'
                    }`}
                  >
                    {item.img && (
                      <img
                        src={item.img}
                        alt=""
                        className="h-full w-full rounded-2xl object-contain"
                      />
                    )}
                    <div
                      onClick={() =>
                        handleTakeControl(
                          activeAgent?.activeWebviewIds?.[0]?.id || ''
                        )
                      }
                      className="bg-dialog-overlay-dark pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center rounded-lg opacity-0 transition-opacity group-hover:opacity-[0.67]"
                    >
                      <Button
                        size="sm"
                        variant="primary"
                        className="cursor-pointer rounded-full"
                      >
                        <Hand size={24} />
                        <span className="text-base font-medium leading-9">
                          Take Control
                        </span>
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
        {activeAgent?.activeWebviewIds?.length !== 1 && (
          <div className="z-100 absolute bottom-2 right-2 flex w-auto items-center gap-1 rounded-lg border border-solid border-ds-border-neutral-strong-default bg-ds-bg-neutral-strong-default p-1">
            <Button
              size="xs"
              buttonContent="icon-only"
              variant="ghost"
              onClick={() => {
                if (scrollContainerRef.current) {
                  const container = scrollContainerRef.current;
                  const card = container.querySelector('div.card-box');
                  if (!card) return;
                  const cardHeight = card.getBoundingClientRect().height;
                  const gap = 16;
                  const rowCount = isSingleMode ? 1 : 2;
                  const scrollAmount = (cardHeight + gap) * rowCount;
                  container.scrollTo({
                    top: Math.min(
                      container.scrollHeight - container.clientHeight,
                      container.scrollTop + scrollAmount
                    ),
                    behavior: 'smooth',
                  });
                }
              }}
            >
              <ArrowDown size={16} />
            </Button>
            <Button
              size="xs"
              buttonContent="icon-only"
              variant="ghost"
              onClick={() => {
                if (scrollContainerRef.current) {
                  const container = scrollContainerRef.current;
                  const card = container.querySelector('div.card-box');
                  if (!card) return;
                  const cardHeight = card.getBoundingClientRect().height;
                  const gap = 16;
                  const rowCount = isSingleMode ? 1 : 2;
                  const scrollAmount = (cardHeight + gap) * rowCount;
                  container.scrollTo({
                    top: Math.max(0, container.scrollTop - scrollAmount),
                    behavior: 'smooth',
                  });
                }
              }}
            >
              <ArrowUp size={16} />
            </Button>
            <Button
              size="xs"
              buttonContent="icon-only"
              variant="ghost"
              onClick={() => {
                setIsSingleMode(!isSingleMode);
                if (scrollContainerRef.current) {
                  scrollContainerRef.current.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                  });
                }
              }}
            >
              <GalleryThumbnails size={16} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
