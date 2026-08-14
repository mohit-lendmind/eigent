// The remote projects provider: mode negotiation gates on the 1.6 project-list
// floor, contract snapshots project onto the UI row type, and the page walk
// caches only the first page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getIntegrationStatus, listProjects } = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listProjects = listProjects;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

function remoteStatus(edgeApiVersion = '1.6.0') {
  return {
    edge_api_version: edgeApiVersion,
    event_schema_version: '1.0',
    minimum_desktop_version: '1.0.0',
  };
}

function setRemoteConfig() {
  (globalThis as Record<string, any>).electronAPI = {
    getAionTransportConfig: async () => ({
      mode: 'remote',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
      apiKey: 'test-key',
    }),
  };
}

async function freshModule() {
  vi.resetModules();
  return import('@/store/aionProjectsStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionProjectsStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionProjectsMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the project-list floor rather than serving an empty list', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.5.0'));
    const store = await freshModule();
    expect(await store.getAionProjectsMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.5.0',
    });
    // Refusing here is the point: a below-floor edge 404s the route, and an
    // empty list would read as "you have no projects".
    await expect(store.listAionProjects()).rejects.toThrow(
      /does not serve the project list/
    );
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue({
      edge_api_version: '2.9.0',
      event_schema_version: '1.0',
      minimum_desktop_version: '1.0.0',
    });
    const store = await freshModule();
    expect(await store.getAionProjectsMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '2.9.0',
    });
  });

  it('surfaces a misconfigured remote mode as an error, never local', async () => {
    (globalThis as Record<string, any>).electronAPI = {
      getAionTransportConfig: async () => ({
        mode: 'remote',
        error: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
      }),
    };
    const store = await freshModule();
    expect(await store.getAionProjectsMode()).toEqual({
      kind: 'error',
      message: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
    });
  });

  it('retries the handshake after a failed status fetch', async () => {
    setRemoteConfig();
    getIntegrationStatus
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(remoteStatus());
    const store = await freshModule();
    expect(await store.getAionProjectsMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionProjectsMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionProjectsStore page walk', () => {
  it('projects contract snapshots onto the UI row type', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listProjects.mockResolvedValue(fixture('project_list_response.json'));
    const store = await freshModule();

    const page = await store.listAionProjects();
    expect(page.nextPageToken).toBe(
      'MTc4NjE3NzgwMDAwMDAwMDAwMCBwcmpfMDFKWTAwMDAwMDAwMDAwMDAwMDAwMDAwMDI'
    );
    expect(page.projects).toHaveLength(2);
    const [running, idle] = page.projects;
    expect(running).toEqual({
      projectId: 'prj_01JY0000000000000000000001',
      title: 'Investigate the build failure',
      modelAlias: 'coding_balanced',
      status: 'active',
      createdAt: Date.parse('2026-08-08T09:00:00Z'),
      updatedAt: Date.parse('2026-08-08T09:12:31Z'),
      activeRun: {
        runId: 'run_01JY0000000000000000000003',
        runEpoch: '3',
        status: 'running',
      },
      lastSequence: '42',
    });
    // Absent stays absent: "no run in flight" and "a run whose status this
    // build cannot name" must not collapse into the same shape.
    expect(idle).not.toHaveProperty('activeRun');
    expect(idle.status).toBe('closed');
    expect(idle.lastSequence).toBe('17');
  });

  it('serves an empty page without a token', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listProjects.mockResolvedValue({ projects: [] });
    const store = await freshModule();

    const page = await store.listAionProjects();
    expect(page.projects).toEqual([]);
    expect(page).not.toHaveProperty('nextPageToken');
  });

  it('caches only the first page and refetches after invalidation', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listProjects.mockResolvedValue(fixture('project_list_response.json'));
    const store = await freshModule();

    await Promise.all([store.listAionProjects(), store.listAionProjects()]);
    expect(listProjects).toHaveBeenCalledTimes(1);
    expect(listProjects).toHaveBeenCalledWith({
      pageToken: undefined,
      pageSize: undefined,
    });

    // A token means the user asked for more: never served from the cache.
    await store.listAionProjects({ pageToken: 'page-2' });
    await store.listAionProjects({ pageToken: 'page-2' });
    expect(listProjects).toHaveBeenCalledTimes(3);
    expect(listProjects).toHaveBeenLastCalledWith({
      pageToken: 'page-2',
      pageSize: undefined,
    });

    store.invalidateAionProjects();
    await store.listAionProjects();
    expect(listProjects).toHaveBeenCalledTimes(4);
  });

  it('does not pin a failed first page in the cache', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listProjects
      .mockRejectedValueOnce(new Error('edge returned 503'))
      .mockResolvedValueOnce(fixture('project_list_response.json'));
    const store = await freshModule();

    await expect(store.listAionProjects()).rejects.toThrow('edge returned 503');
    const page = await store.listAionProjects();
    expect(page.projects).toHaveLength(2);
  });
});
