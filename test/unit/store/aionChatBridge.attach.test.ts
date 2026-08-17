// Composer attachments in aion mode: a file the user attached is published
// through the upload route and named on the command, in order — and a backend
// below the attachment floor refuses the turn loudly instead of running it
// without the file the user watched themselves attach.
import { describe, expect, it, vi } from 'vitest';

const {
  getIntegrationStatus,
  listModelAliases,
  createProject,
  uploadAttachment,
  submitCommand,
  sessionStart,
} = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  listModelAliases: vi.fn(),
  createProject: vi.fn(),
  uploadAttachment: vi.fn(),
  submitCommand: vi.fn(),
  sessionStart: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listModelAliases = listModelAliases;
    createProject = createProject;
    uploadAttachment = uploadAttachment;
  },
}));

vi.mock('@/api/aion/v1/session', () => ({
  ProjectSession: class {
    start = sessionStart;
    submitCommand = submitCommand;
  },
  newCommandId: () => 'cmd_0123456789abcdef',
}));

vi.mock('@/store/aionSpaceBinding', () => ({
  fileProjectUnderBoundSpace: vi.fn(),
}));

function compatibleStatus(edgeApiVersion: string) {
  return {
    edge_api_version: edgeApiVersion,
    event_schema_version: '1.0.0',
    minimum_desktop_version: '0.0.1',
  };
}

async function freshStartAionTask(edgeApiVersion: string) {
  getIntegrationStatus.mockReset();
  listModelAliases.mockReset();
  createProject.mockReset();
  uploadAttachment.mockReset();
  submitCommand.mockReset();
  getIntegrationStatus.mockResolvedValue(compatibleStatus(edgeApiVersion));
  listModelAliases.mockResolvedValue({
    aliases: [{ alias: 'aion-default', internal: false, is_default: true }],
  });
  createProject.mockResolvedValue({
    project_id: 'prj_1',
    status: 'active',
  });
  submitCommand.mockResolvedValue({ run_id: 'run_1', run_epoch: '1' });
  (globalThis as Record<string, any>).electronAPI = {
    getAionTransportConfig: async () => ({
      mode: 'remote',
      edgeBaseUrl: 'http://edge.test',
      apiKey: 'test-key',
    }),
    readFileAsDataUrl: async () => 'data:image/png;base64,aGVsbG8=',
  };
  vi.resetModules();
  const { startAionTask } = await import('@/store/aionChatBridge');
  return startAionTask;
}

const chatStoreHandle = () =>
  ({ getState: () => ({ setSummaryTask: vi.fn() }) }) as never;

describe('aionChatBridge attachments', () => {
  it('publishes each attach and names the ids on the command in order', async () => {
    const startAionTask = await freshStartAionTask('1.16.0');
    uploadAttachment
      .mockResolvedValueOnce({ artifact_id: 'art_a' })
      .mockResolvedValueOnce({ artifact_id: 'art_b' });
    await startAionTask({
      chatStore: chatStoreHandle(),
      taskId: 'task-1',
      eigentProjectId: 'proj-1',
      question: 'what is in these screenshots?',
      attaches: [
        { fileName: 'a.png', filePath: '/tmp/a.png' },
        { fileName: 'b.png', filePath: '/tmp/b.png' },
      ],
    });
    expect(uploadAttachment).toHaveBeenNthCalledWith(1, 'prj_1', {
      name: 'a.png',
      media_type: 'image/png',
      data_base64: 'aGVsbG8=',
    });
    expect(submitCommand).toHaveBeenCalledWith({
      command_id: 'cmd_0123456789abcdef',
      text: 'what is in these screenshots?',
      attachment_ids: ['art_a', 'art_b'],
    });
  });

  it('sends no attachment_ids member at all on a plain turn', async () => {
    const startAionTask = await freshStartAionTask('1.16.0');
    await startAionTask({
      chatStore: chatStoreHandle(),
      taskId: 'task-1',
      eigentProjectId: 'proj-1',
      question: 'hello',
    });
    expect(uploadAttachment).not.toHaveBeenCalled();
    // The edge strictly decodes the body, so an empty list is not the same
    // request as an absent member.
    expect(submitCommand.mock.calls[0][0]).not.toHaveProperty(
      'attachment_ids'
    );
  });

  it('refuses attaches against a backend below the 1.16 floor', async () => {
    const startAionTask = await freshStartAionTask('1.15.0');
    await expect(
      startAionTask({
        chatStore: chatStoreHandle(),
        taskId: 'task-1',
        eigentProjectId: 'proj-1',
        question: 'read the file',
        attaches: [{ fileName: 'a.png', filePath: '/tmp/a.png' }],
      })
    ).rejects.toThrow(/does not accept file attachments/);
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it('fails the turn when a file cannot be read, rather than running without it', async () => {
    const startAionTask = await freshStartAionTask('1.16.0');
    (globalThis as Record<string, any>).electronAPI.readFileAsDataUrl =
      async () => {
        throw new Error('ENOENT');
      };
    await expect(
      startAionTask({
        chatStore: chatStoreHandle(),
        taskId: 'task-1',
        eigentProjectId: 'proj-1',
        question: 'read the file',
        attaches: [{ fileName: 'gone.png', filePath: '/tmp/gone.png' }],
      })
    ).rejects.toThrow(/ENOENT/);
    expect(submitCommand).not.toHaveBeenCalled();
  });
});
