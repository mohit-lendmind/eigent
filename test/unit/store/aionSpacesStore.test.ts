// The tenant's Spaces, read from the edge. Three rules carry this store: a
// count is server-measured and arrives with the write that changed it, a status
// this build does not recognize stays unrecognized instead of degrading to
// active, and every mutation drops the cached head rather than patching a row —
// filing a Project moves the counts of two Spaces, only one of which the caller
// named.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getIntegrationStatus,
  listSpaces,
  createSpace,
  updateSpace,
  deleteSpace,
  archiveSpace,
  unarchiveSpace,
  setProjectSpace,
  clearProjectSpace,
} = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  listSpaces: vi.fn(),
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
  deleteSpace: vi.fn(),
  archiveSpace: vi.fn(),
  unarchiveSpace: vi.fn(),
  setProjectSpace: vi.fn(),
  clearProjectSpace: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listSpaces = listSpaces;
    createSpace = createSpace;
    updateSpace = updateSpace;
    deleteSpace = deleteSpace;
    archiveSpace = archiveSpace;
    unarchiveSpace = unarchiveSpace;
    setProjectSpace = setProjectSpace;
    clearProjectSpace = clearProjectSpace;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

const SPACE = 'spc_01JY0000000000000000000001';
const PROJECT = 'prj_01JY0000000000000000000001';

function remoteStatus(edgeApiVersion = '1.14.0') {
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
  return import('@/store/aionSpacesStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionSpacesStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionSpacesMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the spaces floor rather than reporting an unorganized tenant', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.13.0'));
    const store = await freshModule();
    expect(await store.getAionSpacesMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.13.0',
    });
    await expect(store.loadAionSpaces()).rejects.toThrow(/does not serve/);
    expect(listSpaces).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('2.14.0'));
    const store = await freshModule();
    expect(await store.getAionSpacesMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '2.14.0',
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
    expect(await store.getAionSpacesMode()).toEqual({
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
    expect(await store.getAionSpacesMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionSpacesMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionSpacesStore listing', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSpaces.mockResolvedValue(fixture('space_list_response.json'));
  });

  it('projects the contract snapshot onto the UI row type', async () => {
    const store = await freshModule();
    const page = await store.loadAionSpaces();
    expect(page.spaces).toHaveLength(3);
    expect(page.spaces[0]).toEqual({
      spaceId: SPACE,
      name: 'Platform reliability',
      description:
        'Build failures, incident reviews and the follow-ups they produce.',
      status: 'active',
      projectCount: 12,
      userId: 'usr_ops_lead',
      createdAt: '2026-08-01T09:14:22.113Z',
      updatedAt: '2026-08-14T06:30:04.882Z',
    });
    expect(page.nextPageToken).toBe(
      'MTc4NjE3NzgwMDAwMDAwMDAwMCBzcGNfMDFKWTAwMDAwMDAwMDAwMDAwMDAwMDAwMDM'
    );
  });

  it('reads the count as the number it is on the wire', async () => {
    const store = await freshModule();
    const counts = (await store.loadAionSpaces()).spaces.map(
      (space) => space.projectCount
    );
    // `project_count` is a uint32 and rides as a JSON number, unlike the 64-bit
    // fields on this contract that arrive as decimal strings — running it
    // through a string parser would render every count as a zero.
    expect(counts).toEqual([12, 0, 31]);
    for (const count of counts) expect(typeof count).toBe('number');
  });

  it('keeps an empty Space distinguishable from one it has no facts about', async () => {
    const store = await freshModule();
    const [, empty] = (await store.loadAionSpaces()).spaces;
    expect(empty.projectCount).toBe(0);
    // Absent stays absent: a Space nobody described has no description, which a
    // surface renders differently from one described as "".
    expect(empty.description).toBeUndefined();
    expect(empty.userId).toBeUndefined();
  });

  it('lists an archived Space rather than hiding it', async () => {
    const store = await freshModule();
    const archived = (await store.loadAionSpaces()).spaces.find(
      (space) => space.status === 'archived'
    );
    // Archiving puts a Space away; it does not unfile the 31 Projects still
    // under it, and a list that dropped the row would strand them.
    expect(archived?.projectCount).toBe(31);
  });

  it('renders a status this build predates as unrecognized, not as active', async () => {
    listSpaces.mockResolvedValue({
      spaces: [
        {
          space_id: 'spc_future',
          name: 'Shelved by policy',
          status: 'quarantined',
          project_count: 4,
          created_at: '2026-08-01T09:14:22Z',
          updated_at: '2026-08-01T09:14:22Z',
        },
      ],
    });
    const store = await freshModule();
    const [space] = (await store.loadAionSpaces()).spaces;
    // Degrading an unknown status to `active` would draw a Space that the
    // server has taken out of service as though it were in service.
    expect(space.status).toBe('unknown');
  });

  it('reads a Space-less tenant as an empty page, not as a failure', async () => {
    listSpaces.mockResolvedValue({ spaces: [] });
    const store = await freshModule();
    const page = await store.loadAionSpaces();
    expect(page.spaces).toEqual([]);
    expect(page.nextPageToken).toBeUndefined();
  });

  it('caches the head and shares one fetch between concurrent opens', async () => {
    const store = await freshModule();
    const [first, second] = await Promise.all([
      store.loadAionSpaces(),
      store.loadAionSpaces(),
    ]);
    expect(first).toBe(second);
    expect(listSpaces).toHaveBeenCalledTimes(1);
    expect(listSpaces).toHaveBeenCalledWith({ pageToken: undefined });
  });

  it('never caches a page addressed by a token', async () => {
    const store = await freshModule();
    await store.loadAionSpaces('page-2');
    await store.loadAionSpaces('page-2');
    expect(listSpaces).toHaveBeenCalledTimes(2);
    expect(listSpaces).toHaveBeenLastCalledWith({ pageToken: 'page-2' });
  });

  it('drops the cache after a failed read so the next open retries', async () => {
    listSpaces
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(fixture('space_list_response.json'));
    const store = await freshModule();
    await expect(store.loadAionSpaces()).rejects.toThrow('edge unreachable');
    expect((await store.loadAionSpaces()).spaces).toHaveLength(3);
  });

  it('re-reads the head after an explicit invalidation', async () => {
    const store = await freshModule();
    await store.loadAionSpaces();
    await store.loadAionSpaces();
    expect(listSpaces).toHaveBeenCalledTimes(1);
    store.invalidateAionSpaces();
    await store.loadAionSpaces();
    expect(listSpaces).toHaveBeenCalledTimes(2);
  });
});

describe('aionSpacesStore mutations', () => {
  const space = fixture('space_response.json');

  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSpaces.mockResolvedValue(fixture('space_list_response.json'));
    createSpace.mockResolvedValue({ ...space, project_count: 0 });
    updateSpace.mockResolvedValue({ ...space, name: 'Reliability' });
    archiveSpace.mockResolvedValue({ ...space, status: 'archived' });
    unarchiveSpace.mockResolvedValue(space);
    deleteSpace.mockResolvedValue(undefined);
  });

  it('answers a create with the row the server made', async () => {
    const store = await freshModule();
    const created = await store.createAionSpace('Platform reliability', 'why');
    expect(createSpace).toHaveBeenCalledWith({
      name: 'Platform reliability',
      description: 'why',
    });
    expect(created.spaceId).toBe(SPACE);
    expect(created.projectCount).toBe(0);
  });

  it('answers a rename with the edited row and its count, sparing a second read', async () => {
    const store = await freshModule();
    const renamed = await store.renameAionSpace(SPACE, 'Reliability');
    expect(updateSpace).toHaveBeenCalledWith(SPACE, {
      name: 'Reliability',
      description: undefined,
    });
    expect(renamed.name).toBe('Reliability');
    expect(renamed.projectCount).toBe(12);
  });

  it('carries the new status back off archive and unarchive', async () => {
    const store = await freshModule();
    expect((await store.archiveAionSpace(SPACE)).status).toBe('archived');
    expect((await store.unarchiveAionSpace(SPACE)).status).toBe('active');
  });

  it.each([
    ['create', (s: any) => s.createAionSpace('New')],
    ['rename', (s: any) => s.renameAionSpace(SPACE, 'New')],
    ['archive', (s: any) => s.archiveAionSpace(SPACE)],
    ['unarchive', (s: any) => s.unarchiveAionSpace(SPACE)],
    ['delete', (s: any) => s.deleteAionSpace(SPACE)],
    ['file', (s: any) => s.fileProjectInAionSpace(PROJECT, SPACE)],
  ])('drops the cached head after a %s', async (_name, mutate) => {
    setProjectSpace.mockResolvedValue({ space_id: SPACE });
    const store = await freshModule();
    await store.loadAionSpaces();
    expect(listSpaces).toHaveBeenCalledTimes(1);

    await mutate(store);
    await store.loadAionSpaces();
    // Every one of these moves a count the response did not carry for every
    // affected row, so the head is re-read rather than patched in place.
    expect(listSpaces).toHaveBeenCalledTimes(2);
  });

  it('reports a refused delete instead of pre-checking the count it holds', async () => {
    deleteSpace.mockRejectedValue(new Error('space_in_use'));
    const store = await freshModule();
    // The count this side holds was true when it was read; only the server's
    // refusal is true when the delete lands.
    await expect(store.deleteAionSpace(SPACE)).rejects.toThrow('space_in_use');
    expect(deleteSpace).toHaveBeenCalledWith(SPACE);
  });

  it('files a Project and answers with the Space it now carries', async () => {
    setProjectSpace.mockResolvedValue({ project_id: PROJECT, space_id: SPACE });
    const store = await freshModule();
    expect(await store.fileProjectInAionSpace(PROJECT, SPACE)).toBe(SPACE);
    expect(setProjectSpace).toHaveBeenCalledWith(PROJECT, SPACE);
    expect(clearProjectSpace).not.toHaveBeenCalled();
  });

  it('unfiles through its own verb and answers with no Space at all', async () => {
    clearProjectSpace.mockResolvedValue({ project_id: PROJECT });
    const store = await freshModule();
    // Filed nowhere is an absent id rather than an empty string, so a caller
    // can tell it from a Space whose name happens to be blank.
    expect(await store.fileProjectInAionSpace(PROJECT)).toBeUndefined();
    expect(clearProjectSpace).toHaveBeenCalledWith(PROJECT);
    expect(setProjectSpace).not.toHaveBeenCalled();
  });
});
