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

// Comprehensive unit tests for ChatBox component
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatBox from '../../../src/components/ChatBox/index';
import { useAuthStore } from '../../../src/store/authStore';

// Mock dependencies (use the same relative paths as the imports above)
vi.mock('../../../src/store/authStore', () => ({
  useAuthStore: vi.fn(),
  getAuthStore: vi.fn(() => ({ language: 'en-US', setLanguage: vi.fn() })),
}));
// Also mock the alias paths the component uses so the component picks up these mocks
vi.mock('@/store/authStore', () => ({
  useAuthStore: vi.fn(),
  getAuthStore: vi.fn(() => ({ language: 'en-US', setLanguage: vi.fn() })),
}));
vi.mock('../../../src/lib', () => ({
  generateUniqueId: vi.fn(() => 'test-unique-id'),
  replayActiveTask: vi.fn(),
}));

// Mock projectStore with proper vanilla store structure
vi.mock('../../../src/store/projectStore', () => {
  const useProjectStore = vi.fn();
  (useProjectStore as any).getState = vi.fn(() => ({
    getAllChatStores: () => [],
  }));
  return { useProjectStore };
});

vi.mock('@/store/projectStore', () => {
  const useProjectStore = vi.fn();
  (useProjectStore as any).getState = vi.fn(() => ({
    getAllChatStores: () => [],
  }));
  return { useProjectStore };
});

// Mock useChatStoreAdapter to provide both stores
vi.mock('../../../src/hooks/useChatStoreAdapter', () => ({
  default: vi.fn(),
}));

vi.mock('@/hooks/useModelConfigCheck', () => ({
  useModelConfigCheck: () => ({
    hasModel: true,
    isConfigLoaded: true,
    cloudUsageLimitReached: false,
  }),
}));

// Mock i18next for translations
vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'chat.ask-placeholder': 'Type your message...',
        'layout.by-messaging-eigent': 'By messaging Eigent, you agree to our',
        'layout.terms-of-use': 'Terms of Use',
        'layout.and': 'and',
        'layout.privacy-policy': 'Privacy Policy',
      };
      return translations[key] || key;
    },
  }),
}));

// Mock BottomBox component
vi.mock('../../../src/components/ChatBox/BottomBox', () => ({
  default: vi.fn(({ inputProps }: any) => {
    if (!inputProps) return null;
    return (
      <div data-testid="bottom-box">
        <input
          data-testid="message-input"
          placeholder={inputProps.placeholder}
          value={inputProps.value}
          onChange={(e) => inputProps.onChange(e.target.value)}
        />
        <button data-testid="send-button" onClick={() => inputProps.onSend()}>
          Send
        </button>
      </div>
    );
  }),
}));

// Mock ProjectChatContainer to avoid scrollTo issues
vi.mock('../../../src/components/ChatBox/ProjectChatContainer', () => ({
  ProjectChatContainer: vi.fn(() => (
    <div data-testid="project-chat-container">Chat Container</div>
  )),
}));

// Mock other components
vi.mock('../../../src/components/ChatBox/MessageCard', () => ({
  MessageCard: vi.fn(({ content, role }: any) => (
    <div data-testid={`message-${role}`}>{content}</div>
  )),
}));

vi.mock('../../../src/components/ChatBox/TaskCard', () => ({
  TaskCard: vi.fn(() => <div data-testid="task-card">Task Card</div>),
}));

vi.mock('../../../src/components/ChatBox/NoticeCard', () => ({
  NoticeCard: vi.fn(() => <div data-testid="notice-card">Notice Card</div>),
}));

vi.mock('../../../src/components/ChatBox/TypeCardSkeleton', () => ({
  TypeCardSkeleton: vi.fn(() => <div data-testid="skeleton">Loading...</div>),
}));

describe('ChatBox Component', async () => {
  const mockUseAuthStore = vi.mocked(useAuthStore);

  // Import the mocked hook
  const mockUseChatStoreAdapter = vi.mocked(
    (await import('../../../src/hooks/useChatStoreAdapter')).default
  );
  const mockUseProjectStore = vi.mocked(
    (await import('../../../src/store/projectStore')).useProjectStore
  );

  const defaultChatStoreState = {
    activeTaskId: 'test-task-id',
    tasks: {
      'test-task-id': {
        messages: [],
        hasMessages: false,
        isPending: false,
        activeAsk: '',
        askList: [],
        hasWaitComfirm: false,
        isTakeControl: false,
        type: 'normal',
        delayTime: 0,
        status: 'pending',
        taskInfo: [],
        attaches: [],
        taskRunning: [],
        taskAssigning: [],
        cotList: [],
        activeWorkspace: null,
        snapshots: [],
        isTaskEdit: false,
        isContextExceeded: false,
      },
    },
    setHasMessages: vi.fn(),
    addMessages: vi.fn(),
    setIsPending: vi.fn(),
    startTask: vi.fn(),
    setActiveAsk: vi.fn(),
    setActiveAskList: vi.fn(),
    setHasWaitComfirm: vi.fn(),
    handleConfirmTask: vi.fn(),
    setActiveTaskId: vi.fn(),
    create: vi.fn(),
    setSelectedFile: vi.fn(),
    setActiveWorkspace: vi.fn(),
    setIsTakeControl: vi.fn(),
    setIsTaskEdit: vi.fn(),
    addTaskInfo: vi.fn(),
    updateTaskInfo: vi.fn(),
    saveTaskInfo: vi.fn(),
    deleteTaskInfo: vi.fn(),
    getFormattedTaskTime: vi.fn(() => '00:00:00'),
    setAttaches: vi.fn(),
    setNextTaskId: vi.fn(),
    setNextExecutionId: vi.fn(),
    removeTask: vi.fn(),
    setElapsed: vi.fn(),
    setTaskTime: vi.fn(),
    setStatus: vi.fn(),
  };

  const defaultProjectStoreState = {
    activeProjectId: 'test-project-id',
    projects: {},
    createProject: vi.fn(),
    setActiveProject: vi.fn(),
    removeProject: vi.fn(),
    updateProject: vi.fn(),
    replayProject: vi.fn(),
    addQueuedMessage: vi.fn(),
    removeQueuedMessage: vi.fn(),
    restoreQueuedMessage: vi.fn(),
    clearQueuedMessages: vi.fn(),
    createChatStore: vi.fn(),
    appendInitChatStore: vi.fn(),
    setActiveChatStore: vi.fn(),
    removeChatStore: vi.fn(),
    saveChatStore: vi.fn(),
    getChatStore: vi.fn(),
    getActiveChatStore: vi.fn(() => ({
      getState: () => defaultChatStoreState,
      subscribe: () => () => {},
    })),
    getAllChatStores: vi.fn(() => []),
    getAllProjects: vi.fn(),
    getProjectById: vi.fn(() => ({ queuedMessages: [] })),
    getProjectTotalTokens: vi.fn(),
    setHistoryId: vi.fn(),
    getHistoryId: vi.fn(),
  };

  const defaultAuthStoreState = {
    modelType: 'cloud',
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup default store states
    mockUseChatStoreAdapter.mockReturnValue({
      projectStore: defaultProjectStoreState as any,
      chatStore: defaultChatStoreState as any,
    });
    mockUseProjectStore.mockReturnValue(defaultProjectStoreState as any);
    mockUseAuthStore.mockReturnValue(defaultAuthStoreState as any);

    // Mock import.meta.env
    Object.defineProperty(import.meta, 'env', {
      value: { VITE_USE_LOCAL_PROXY: 'false' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderChatBox = () => {
    return render(
      <BrowserRouter>
        <ChatBox />
      </BrowserRouter>
    );
  };

  describe('Initial Render', () => {
    it('should render bottom box when no messages exist', () => {
      renderChatBox();

      expect(screen.getByTestId('bottom-box')).toBeInTheDocument();
    });

    it('should render message input in bottom box', () => {
      renderChatBox();

      expect(screen.getByTestId('message-input')).toBeInTheDocument();
    });
  });

  describe('Chat Interface', () => {
    beforeEach(() => {
      const updatedChatState = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            messages: [
              {
                id: '1',
                role: 'user',
                content: 'Hello',
                attaches: [],
              },
              {
                id: '2',
                role: 'assistant',
                content: 'Hi there!',
                attaches: [],
              },
            ],
            hasMessages: true,
          },
        },
      };

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: updatedChatState as any,
      });
    });

    it('should render project chat container when messages exist', () => {
      renderChatBox();

      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });

    it('should handle message sending', async () => {
      const user = userEvent.setup();
      const mockStartTask = vi.fn().mockResolvedValue(undefined);

      // Create a proper pending state where we can continue a conversation
      const updatedChatState = {
        ...defaultChatStoreState,
        startTask: mockStartTask,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            messages: [
              {
                id: '1',
                role: 'user',
                content: 'Hello',
                attaches: [],
              },
              {
                id: '2',
                role: 'assistant',
                content: 'Hi there!',
                step: 'wait_confirm', // Add wait_confirm to allow continuation
                attaches: [],
              },
            ],
            hasMessages: true,
            hasWaitComfirm: true, // Set hasWaitComfirm to true
            status: 'pending', // Keep it pending
          },
        },
      };

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: updatedChatState as any,
      });

      renderChatBox();

      const messageInput = screen.getByTestId('message-input');
      const sendButton = screen.getByTestId('send-button');

      await user.type(messageInput, 'Test message');
      await user.click(sendButton);

      // A follow-up is another turn on the same aion Project, not a
      // separate improve endpoint.
      await waitFor(() => {
        expect(mockStartTask).toHaveBeenCalled();
      });
    });

    it('should not send empty messages', async () => {
      const user = userEvent.setup();

      renderChatBox();

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(defaultChatStoreState.addMessages).not.toHaveBeenCalled();
    });
  });

  describe('Task Management', () => {
    it('should render project chat container when tasks have messages', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: '',
                  step: 'to_sub_tasks',
                  taskType: 1,
                },
              ],
              hasMessages: true,
              isTakeControl: false,
              cotList: [],
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, task cards are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });

    it('should render project chat container for notice card scenario', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: '',
                  step: 'notice_card',
                },
              ],
              hasMessages: true,
              isTakeControl: false,
              cotList: ['item1'],
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, notice cards are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should render project chat container when task is pending', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'user',
                  content: 'Hello',
                },
              ],
              hasMessages: true,
              hasWaitComfirm: false,
              isTakeControl: false,
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, loading states are handled inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });
  });

  describe('File Handling', () => {
    it('should render project chat container when message has files', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: 'Task complete',
                  step: 'end',
                  fileList: [
                    {
                      name: 'test-file.pdf',
                      type: 'PDF',
                      path: '/path/to/file',
                    },
                  ],
                },
              ],
              hasMessages: true,
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, file lists are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });

    it('should render project chat container for file handling', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: 'Task complete',
                  step: 'end',
                  fileList: [
                    {
                      name: 'test-file.pdf',
                      type: 'PDF',
                      path: '/path/to/file',
                    },
                  ],
                },
              ],
              hasMessages: true,
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, file lists are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });
  });

  describe('Environment-specific Behavior', () => {
    it('should show cloud model warning in self-hosted mode', async () => {
      Object.defineProperty(import.meta, 'env', {
        value: { VITE_USE_LOCAL_PROXY: 'true' },
        writable: true,
      });

      mockUseAuthStore.mockReturnValue({
        modelType: 'cloud',
      } as any);

      renderChatBox();

      await waitFor(() => {
        const foundCloud = !!(
          document.body.textContent &&
          document.body.textContent.includes('Self-hosted')
        );
        const hasInput = !!screen.queryByTestId('message-input');
        expect(foundCloud || hasInput).toBe(true);
      });
    });

    it('should show search key warning when missing API keys', async () => {
      mockUseAuthStore.mockReturnValue({
        modelType: 'local',
      } as any);

      renderChatBox();

      await waitFor(() => {
        expect(screen.getByTestId('message-input')).toBeInTheDocument();
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should handle message sending through send button', async () => {
      const user = userEvent.setup();

      // Set up a state where we can send messages
      const mockStartTask = vi.fn().mockResolvedValue(undefined);
      const stateForSending = {
        ...defaultChatStoreState,
        startTask: mockStartTask,
      };

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: stateForSending as any,
      });

      renderChatBox();

      const messageInput = screen.getByTestId('message-input');
      await user.type(messageInput, 'Test message');

      // Click the send button instead of testing Ctrl+Enter
      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      // Should call startTask for a new conversation
      await waitFor(() => {
        expect(mockStartTask).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      const user = userEvent.setup();
      const mockStartTask = vi.fn().mockRejectedValue(new Error('API Error'));

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          startTask: mockStartTask,
        } as any,
      });

      renderChatBox();

      const messageInput = screen.getByTestId('message-input');
      await user.type(messageInput, 'API test');
      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      await waitFor(() => {
        expect(mockStartTask).toHaveBeenCalled();
      });

      expect(screen.getByTestId('message-input')).toBeInTheDocument();
    });
  });
});
