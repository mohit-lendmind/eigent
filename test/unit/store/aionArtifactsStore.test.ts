// What a Project produced, read from the edge. Three rules carry this store and
// all three are about what a listing deliberately withholds: a row has no
// download URL (the grant is minted when someone opens it, not N at a time for
// a page nobody clicks), `size_bytes` is a 64-bit decimal string that has to be
// parsed exactly once, and below the listing floor an empty list would claim the
// Project produced nothing when this desktop simply cannot enumerate.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getIntegrationStatus, listArtifacts, getArtifact } = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  listArtifacts: vi.fn(),
  getArtifact: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listArtifacts = listArtifacts;
    getArtifact = getArtifact;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

const PROJECT = 'prj_01JY0000000000000000000001';

function remoteStatus(edgeApiVersion = '1.13.0') {
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
  return import('@/store/aionArtifactsStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionArtifactsStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionArtifactsMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the listing floor rather than reporting an empty Project', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.12.0'));
    const store = await freshModule();
    expect(await store.getAionArtifactsMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.12.0',
    });
    await expect(store.loadAionArtifacts(PROJECT)).rejects.toThrow(
      /does not serve/
    );
    expect(listArtifacts).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('2.13.0'));
    const store = await freshModule();
    expect(await store.getAionArtifactsMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '2.13.0',
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
    expect(await store.getAionArtifactsMode()).toEqual({
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
    expect(await store.getAionArtifactsMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionArtifactsMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionArtifactsStore listing', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listArtifacts.mockResolvedValue(fixture('artifact_list_response.json'));
  });

  it('parses the 64-bit size out of its decimal string exactly once', async () => {
    const store = await freshModule();
    const page = await store.loadAionArtifacts(PROJECT);
    expect(page.artifacts.map((a) => a.sizeBytes)).toEqual([2048, 18344, 128]);
  });

  it('distinguishes two writes of one name by version, not by row order', async () => {
    const store = await freshModule();
    const page = await store.loadAionArtifacts(PROJECT);
    const repeated = page.artifacts.filter(
      (a) => a.name === 'test-report.json'
    );
    expect(repeated).toHaveLength(2);
    expect(repeated.map((a) => a.version)).toEqual([2, 1]);
    // Same name, distinct artifacts: keying a UI on name alone would collapse
    // these two into one row and hide whichever it drew second.
    expect(repeated[0].artifactId).not.toBe(repeated[1].artifactId);
  });

  it('serves the page newest-published first', async () => {
    const store = await freshModule();
    const stamps = (await store.loadAionArtifacts(PROJECT)).artifacts.map((a) =>
      Date.parse(a.publishedAt ?? '')
    );
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });

  it('carries no download URL on a listed row', async () => {
    const store = await freshModule();
    const page = await store.loadAionArtifacts(PROJECT);
    // A grant is time-boxed against a default-deny bucket: minting one per
    // listed row would start N clocks for artifacts nobody opened.
    for (const artifact of page.artifacts) {
      expect(artifact).not.toHaveProperty('downloadUrl');
    }
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('reports an unparseable size as zero rather than NaN', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        {
          artifact_id: 'art_odd',
          project_id: PROJECT,
          name: 'odd.bin',
          version: 1,
          media_type: 'application/octet-stream',
          size_bytes: 'huge',
          sha256: 'a'.repeat(64),
          created_at: '2026-08-08T09:00:06Z',
          published_at: '2026-08-08T09:00:06Z',
        },
      ],
    });
    const store = await freshModule();
    const page = await store.loadAionArtifacts(PROJECT);
    expect(page.artifacts[0].sizeBytes).toBe(0);
  });

  it('reads an artifact-less Project as an empty page, not as a failure', async () => {
    listArtifacts.mockResolvedValue({ artifacts: [] });
    const store = await freshModule();
    const page = await store.loadAionArtifacts(PROJECT);
    expect(page.artifacts).toEqual([]);
    expect(page.nextPageToken).toBeUndefined();
  });

  it('leaves an unpublished stamp absent rather than dating it to the epoch', async () => {
    listArtifacts.mockResolvedValue({
      artifacts: [
        {
          artifact_id: 'art_nostamp',
          project_id: PROJECT,
          name: 'r.json',
          version: 1,
          media_type: 'application/json',
          size_bytes: '12',
          sha256: 'b'.repeat(64),
          created_at: '2026-08-08T09:00:06Z',
        },
      ],
    });
    const store = await freshModule();
    const page = await store.loadAionArtifacts(PROJECT);
    expect(page.artifacts[0].publishedAt).toBeUndefined();
  });

  it('caches the head per Project and shares one fetch between concurrent opens', async () => {
    const store = await freshModule();
    const [first, second] = await Promise.all([
      store.loadAionArtifacts(PROJECT),
      store.loadAionArtifacts(PROJECT),
    ]);
    expect(first).toBe(second);
    expect(listArtifacts).toHaveBeenCalledTimes(1);
    expect(listArtifacts).toHaveBeenCalledWith(PROJECT, {
      pageToken: undefined,
    });

    await store.loadAionArtifacts('prj_other');
    expect(listArtifacts).toHaveBeenCalledTimes(2);
  });

  it('never caches a page addressed by a token', async () => {
    const store = await freshModule();
    const token = 'page-2';
    await store.loadAionArtifacts(PROJECT, token);
    await store.loadAionArtifacts(PROJECT, token);
    // Caching a continuation would have to be invalidated as a chain, while the
    // reason to re-read at all is that the head moved.
    expect(listArtifacts).toHaveBeenCalledTimes(2);
    expect(listArtifacts).toHaveBeenLastCalledWith(PROJECT, {
      pageToken: token,
    });
  });

  it('drops the cache after a failed read so the next open retries', async () => {
    listArtifacts
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(fixture('artifact_list_response.json'));
    const store = await freshModule();
    await expect(store.loadAionArtifacts(PROJECT)).rejects.toThrow(
      'edge unreachable'
    );
    expect((await store.loadAionArtifacts(PROJECT)).artifacts).toHaveLength(3);
  });

  it('invalidates one Project without dropping another', async () => {
    const store = await freshModule();
    await store.loadAionArtifacts(PROJECT);
    await store.loadAionArtifacts('prj_other');
    expect(listArtifacts).toHaveBeenCalledTimes(2);

    store.invalidateAionArtifacts(PROJECT);
    await store.loadAionArtifacts('prj_other');
    expect(listArtifacts).toHaveBeenCalledTimes(2);
    await store.loadAionArtifacts(PROJECT);
    expect(listArtifacts).toHaveBeenCalledTimes(3);
  });
});

describe('aionArtifactsStore grants', () => {
  const access = {
    artifact: fixture('artifact_list_response.json').artifacts[0],
    download_url: 'https://cas.test/art_01JY0000000000000000000003?sig=abc',
    expires_at: '2026-08-08T09:29:05Z',
  };

  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listArtifacts.mockResolvedValue(fixture('artifact_list_response.json'));
    getArtifact.mockResolvedValue(access);
  });

  it('mints the grant on demand, carrying its own expiry', async () => {
    const store = await freshModule();
    const grant = await store.grantAionArtifact(
      PROJECT,
      'art_01JY0000000000000000000003'
    );
    expect(grant.downloadUrl).toBe(access.download_url);
    expect(grant.expiresAt).toBe(access.expires_at);
    expect(grant.artifact.name).toBe('test-report.json');
    expect(getArtifact).toHaveBeenCalledWith(
      PROJECT,
      'art_01JY0000000000000000000003'
    );
  });

  it('re-mints rather than reusing a grant whose clock may have run out', async () => {
    const store = await freshModule();
    const id = 'art_01JY0000000000000000000003';
    await store.grantAionArtifact(PROJECT, id);
    await store.grantAionArtifact(PROJECT, id);
    // A cached URL would fail at the moment of download instead of at the
    // moment of asking, which is the only point where it can be reported.
    expect(getArtifact).toHaveBeenCalledTimes(2);
  });

  it('does not swallow a refused grant', async () => {
    getArtifact.mockRejectedValue(new Error('artifact is not downloadable'));
    const store = await freshModule();
    await expect(store.grantAionArtifact(PROJECT, 'art_x')).rejects.toThrow(
      'artifact is not downloadable'
    );
  });
});
