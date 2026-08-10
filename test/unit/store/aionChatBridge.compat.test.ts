// The product bind path negotiates versions BEFORE any project traffic
// (doc 10 §12 diagnostics/updates row): an incompatible backend rejects the
// task with the actionable negotiation message, and createProject is never
// reached — the failure is visible, not a degraded session.
import { describe, expect, it, vi } from 'vitest';

const { getIntegrationStatus, listModelAliases, createProject } = vi.hoisted(
  () => ({
    getIntegrationStatus: vi.fn(),
    listModelAliases: vi.fn(),
    createProject: vi.fn(),
  })
);

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listModelAliases = listModelAliases;
    createProject = createProject;
  },
}));

describe('aionChatBridge version negotiation', () => {
  it('refuses an incompatible backend before creating any project', async () => {
    getIntegrationStatus.mockResolvedValue({
      edge_api_version: '9.0.0',
      event_schema_version: '1.0',
      minimum_desktop_version: '1.0.0',
    });
    (globalThis as Record<string, any>).electronAPI = {
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test',
        apiKey: 'test-key',
      }),
    };
    vi.resetModules();
    const { startAionTask } = await import('@/store/aionChatBridge');
    await expect(
      startAionTask({
        chatStore: { getState: () => ({}) as never },
        taskId: 'task-1',
        eigentProjectId: 'proj-1',
        question: 'hello',
      })
    ).rejects.toThrow(/edge API 9\.0\.0/);
    expect(createProject).not.toHaveBeenCalled();
    expect(listModelAliases).not.toHaveBeenCalled();
  });
});
