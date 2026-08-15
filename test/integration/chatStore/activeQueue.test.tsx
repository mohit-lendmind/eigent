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

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Also Mock authStore
import '../../mocks/authStore.mock';

// Import chat store to ensure it's available
import '../../../src/store/chatStore';

import useChatStoreAdapter from '../../../src/hooks/useChatStoreAdapter';
import { useProjectStore } from '../../../src/store/projectStore';

// Mock electron IPC
(global as any).ipcRenderer = {
  invoke: vi.fn((channel) => {
    if (channel === 'get-system-language') return Promise.resolve('en');
    if (channel === 'get-browser-port') return Promise.resolve(9222);
    if (channel === 'get-env-path') return Promise.resolve('/path/to/env');
    if (channel === 'mcp-list') return Promise.resolve({});
    if (channel === 'get-file-list') return Promise.resolve([]);
    return Promise.resolve();
  }),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: {
    uploadLog: vi.fn().mockResolvedValue(undefined),
    // Add other electronAPI methods as needed
  },
  writable: true,
});

describe('Case 3: Add to the workforce queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const { result } = renderHook(() => useProjectStore());
    //Reset projectStore
    result.current.getAllProjects().forEach((project) => {
      result.current.removeProject(project.id);
    });

    //Create initial Project
    const projectId = result.current.createProject(
      'Queue Test Project',
      'Testing message queue functionality'
    );
    expect(projectId).toBeDefined();

    // Get chatStore (automatically created)
    let chatStore = result.current.getActiveChatStore(projectId)!;
    expect(chatStore).toBeDefined();
    const initiatorTaskId = chatStore.getState().activeTaskId!;
    expect(initiatorTaskId).toBeDefined();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle multiple queue additions and removals correctly', async () => {
    const { result, rerender: _rerender } = renderHook(() =>
      useChatStoreAdapter()
    );
    const { projectStore } = result.current;
    const projectId = projectStore.activeProjectId as string;

    // Verify initial state
    expect(projectStore.getProjectById(projectId)?.queuedMessages).toEqual([]);

    await act(async () => {
      // Add multiple messages to queue
      const messages = [
        'Build a calculator',
        'Create a todo app',
        'Develop a weather app',
        'Make a chat application',
      ];

      const taskIds: string[] = [];

      messages.forEach((message, _index) => {
        const taskId = projectStore.addQueuedMessage(projectId, message, []);
        taskIds.push(taskId);
        expect(taskId).toBeDefined();
      });

      // Verify all messages are queued
      const project = projectStore.getProjectById(projectId);
      expect(project?.queuedMessages).toHaveLength(4);

      messages.forEach((message, index) => {
        expect(project?.queuedMessages?.[index].content).toBe(message);
        expect(project?.queuedMessages?.[index].task_id).toBe(taskIds[index]);
      });

      // Remove middle message
      projectStore.removeQueuedMessage(projectId, taskIds[1]);

      // Verify removal
      const updatedProject = projectStore.getProjectById(projectId);
      expect(updatedProject?.queuedMessages).toHaveLength(3);
      expect(
        updatedProject?.queuedMessages?.map((m: any) => m.content)
      ).toEqual([
        'Build a calculator',
        'Develop a weather app',
        'Make a chat application',
      ]);

      // Remove first message
      projectStore.removeQueuedMessage(projectId, taskIds[0]);

      // Verify second removal
      const finalProject = projectStore.getProjectById(projectId);
      expect(finalProject?.queuedMessages).toHaveLength(2);
      expect(finalProject?.queuedMessages?.map((m: any) => m.content)).toEqual([
        'Develop a weather app',
        'Make a chat application',
      ]);
    });
  });

  it('should restore queued message when removal fails', async () => {
    const { result, rerender: _rerender } = renderHook(() =>
      useChatStoreAdapter()
    );
    const { projectStore } = result.current;
    const projectId = projectStore.activeProjectId as string;

    await act(async () => {
      // Add a message to queue
      const messageContent = 'Test message for restoration';
      const attachments: any[] = [
        { fileName: 'test.txt', filePath: '/test/path' },
      ];

      const taskId = projectStore.addQueuedMessage(
        projectId,
        messageContent,
        attachments
      );

      // Verify message is queued
      let project = projectStore.getProjectById(projectId);
      expect(project?.queuedMessages).toHaveLength(1);
      expect(project?.queuedMessages?.[0].content).toBe(messageContent);
      expect(project?.queuedMessages?.[0].attaches).toEqual(attachments);

      // Store original message for comparison
      const originalMessage = project?.queuedMessages?.[0];

      // Remove the message (this would normally trigger an API call)
      projectStore.removeQueuedMessage(projectId, taskId);

      // Verify optimistic removal
      project = projectStore.getProjectById(projectId);
      expect(project?.queuedMessages).toHaveLength(0);

      // Simulate restoration (as would happen on API failure)
      if (originalMessage) {
        projectStore.restoreQueuedMessage(projectId, {
          task_id: originalMessage.task_id,
          content: originalMessage.content,
          timestamp: originalMessage.timestamp,
          attaches: originalMessage.attaches,
        });
      }

      // Verify message is restored
      project = projectStore.getProjectById(projectId);
      expect(project?.queuedMessages).toHaveLength(1);
      expect(project?.queuedMessages?.[0].content).toBe(messageContent);
      expect(project?.queuedMessages?.[0].attaches).toEqual(attachments);
      expect(project?.queuedMessages?.[0].task_id).toBe(taskId);
    });
  });

  it('should maintain queue order and timestamps correctly', async () => {
    const { result, rerender: _rerender } = renderHook(() =>
      useChatStoreAdapter()
    );
    const { projectStore } = result.current;
    const projectId = projectStore.activeProjectId as string;

    await act(async () => {
      const messages = ['First message', 'Second message', 'Third message'];
      const taskIds: string[] = [];
      const timestamps: number[] = [];

      // Add messages with small delays to ensure different timestamps
      for (let i = 0; i < messages.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));

        const taskId = projectStore.addQueuedMessage(
          projectId,
          messages[i],
          []
        );
        taskIds.push(taskId);

        const project = projectStore.getProjectById(projectId);
        const addedMessage = project?.queuedMessages?.find(
          (m: any) => m.task_id === taskId
        );
        if (addedMessage) {
          timestamps.push(addedMessage.timestamp);
        }
      }

      // Verify order and timestamps
      const project = projectStore.getProjectById(projectId);
      expect(project?.queuedMessages).toHaveLength(3);

      project?.queuedMessages?.forEach((message: any, index: number) => {
        expect(message.content).toBe(messages[index]);
        expect(message.task_id).toBe(taskIds[index]);
        expect(message.timestamp).toBe(timestamps[index]);

        // Verify timestamps are in ascending order
        if (index > 0) {
          expect(message.timestamp).toBeGreaterThanOrEqual(
            timestamps[index - 1]
          );
        }
      });
    });
  });

});
