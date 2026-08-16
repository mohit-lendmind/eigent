// What the agent remembers, read from the edge. Two projections carry the whole
// point of this store and both are absence rules: a listing row has no
// `content` because the route does not return it (never because the document is
// empty), and every 64-bit counter arrives as a decimal string that has to be
// parsed exactly once. The mode gate is the third: below the memory floor the
// agent still remembers and this desktop simply cannot see it, so an empty list
// would be the one wrong answer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getIntegrationStatus,
  listMemory,
  searchMemory,
  getMemory,
  putMemory,
  deleteMemory,
  clearMemory,
} = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  listMemory: vi.fn(),
  searchMemory: vi.fn(),
  getMemory: vi.fn(),
  putMemory: vi.fn(),
  deleteMemory: vi.fn(),
  clearMemory: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listMemory = listMemory;
    searchMemory = searchMemory;
    getMemory = getMemory;
    putMemory = putMemory;
    deleteMemory = deleteMemory;
    clearMemory = clearMemory;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

function remoteStatus(edgeApiVersion = '1.12.0') {
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
  return import('@/store/aionMemoryStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionMemoryStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionMemoryMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the memory floor rather than reporting an empty memory', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.11.0'));
    const store = await freshModule();
    expect(await store.getAionMemoryMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.11.0',
    });
    // The cell has served these RPCs all along: an empty list here would claim
    // the agent remembers nothing about you.
    await expect(store.loadAionMemory()).rejects.toThrow(/does not serve/);
    expect(listMemory).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('2.12.0'));
    const store = await freshModule();
    expect(await store.getAionMemoryMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '2.12.0',
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
    expect(await store.getAionMemoryMode()).toEqual({
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
    expect(await store.getAionMemoryMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionMemoryMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionMemoryStore catalog', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listMemory.mockResolvedValue(fixture('memory_catalog_response.json'));
  });

  it('parses every 64-bit counter out of its decimal string exactly once', async () => {
    const store = await freshModule();
    const catalog = await store.loadAionMemory();
    expect(catalog.usage).toEqual({
      docCount: 3,
      totalBytes: 7273,
      capDocBytes: 262144,
      capDocsPerScope: 256,
      capScopeBytes: 8388608,
    });
    expect(catalog.docs.map((doc) => doc.bytes)).toEqual([1841, 312, 5120]);
  });

  it('keeps a listing row content-less rather than empty-stringed', async () => {
    const store = await freshModule();
    const catalog = await store.loadAionMemory();
    for (const doc of catalog.docs) {
      // '' would read as a stored empty document, which cannot exist.
      expect(doc.content).toBeUndefined();
    }
  });

  it('leaves a never-rewritten document without an updated stamp', async () => {
    const store = await freshModule();
    const byKey = Object.fromEntries(
      (await store.loadAionMemory()).docs.map((doc) => [doc.key, doc])
    );
    expect(byKey['deploy-runbook'].updatedAt).toBe('2026-08-12T16:02:44.918Z');
    // Written once and never since — the wire omits `updated_at` rather than
    // repeating `created_at`, and this side must not invent one.
    expect(byKey['user-preferences'].updatedAt).toBeUndefined();
    expect(byKey['user-preferences'].createdAt).toBe('2026-08-11T11:47:30.004Z');
    // Nothing wrote this one from a session, so there is no session to name.
    expect(byKey['seeded-glossary'].updatedBySession).toBeUndefined();
  });

  it('carries the served scope set so a client never invents a name', async () => {
    const store = await freshModule();
    const catalog = await store.loadAionMemory();
    expect(catalog.scope).toBe('profile:eigent-managed');
    expect(catalog.scopes).toEqual([
      'profile:eigent-managed',
      'profile:eigent-worker',
    ]);
  });

  it('asks for the default by omitting the scope, not by sending an empty one', async () => {
    const store = await freshModule();
    await store.loadAionMemory();
    // An empty string names a scope no deployment serves, and the route
    // refuses an unserved scope rather than falling back.
    expect(listMemory).toHaveBeenCalledWith({ scope: undefined });
  });

  it('reports an unparseable counter as zero rather than NaN', async () => {
    listMemory.mockResolvedValue({
      scope: 'profile:eigent-managed',
      scopes: ['profile:eigent-managed'],
      docs: [{ scope: 'profile:eigent-managed', key: 'odd', bytes: 'huge' }],
      usage: {
        doc_count: '1',
        total_bytes: 'huge',
        cap_doc_bytes: '0',
        cap_docs_per_scope: '0',
        cap_scope_bytes: '0',
      },
    });
    const store = await freshModule();
    const catalog = await store.loadAionMemory();
    expect(catalog.docs[0].bytes).toBe(0);
    expect(catalog.usage.totalBytes).toBe(0);
    // A zero cap is the store's "uncapped", and has to survive as a real zero.
    expect(catalog.usage.capScopeBytes).toBe(0);
  });

  it('serves an empty scope as an empty listing', async () => {
    listMemory.mockResolvedValue({
      scope: 'profile:eigent-managed',
      scopes: ['profile:eigent-managed'],
      docs: [],
      usage: {
        doc_count: '0',
        total_bytes: '0',
        cap_doc_bytes: '262144',
        cap_docs_per_scope: '256',
        cap_scope_bytes: '8388608',
      },
    });
    const store = await freshModule();
    const catalog = await store.loadAionMemory();
    expect(catalog.docs).toEqual([]);
    expect(catalog.usage.docCount).toBe(0);
  });

  it('caches per scope and shares one fetch between concurrent opens', async () => {
    const store = await freshModule();
    const [first, second] = await Promise.all([
      store.loadAionMemory(),
      store.loadAionMemory(),
    ]);
    expect(first).toBe(second);
    expect(listMemory).toHaveBeenCalledTimes(1);

    await store.loadAionMemory('profile:eigent-worker');
    expect(listMemory).toHaveBeenCalledTimes(2);
    expect(listMemory).toHaveBeenLastCalledWith({
      scope: 'profile:eigent-worker',
    });
  });

  it('drops the cache after a failed read so the next open retries', async () => {
    listMemory
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(fixture('memory_catalog_response.json'));
    const store = await freshModule();
    await expect(store.loadAionMemory()).rejects.toThrow('edge unreachable');
    expect((await store.loadAionMemory()).docs.length).toBe(3);
  });
});

describe('aionMemoryStore reads', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listMemory.mockResolvedValue(fixture('memory_catalog_response.json'));
  });

  it('returns one document with its text', async () => {
    getMemory.mockResolvedValue(fixture('memory_doc_response.json'));
    const store = await freshModule();
    const doc = await store.readAionMemory('deploy-runbook');
    expect(doc.key).toBe('deploy-runbook');
    expect(doc.content).toContain('digest-only gate');
    expect(doc.bytes).toBe(1841);
    expect(getMemory).toHaveBeenCalledWith('deploy-runbook', {
      scope: undefined,
    });
  });

  it('keeps the server ranking and every hit its content', async () => {
    searchMemory.mockResolvedValue(fixture('memory_search_response.json'));
    const store = await freshModule();
    const hits = await store.searchAionMemory('cutover');
    expect(hits.map((hit) => hit.doc.key)).toEqual([
      'deploy-runbook',
      'seeded-glossary',
    ]);
    expect(hits.map((hit) => hit.score)).toEqual([8.4213, 2.0075]);
    expect(hits.every((hit) => typeof hit.doc.content === 'string')).toBe(true);
    expect(searchMemory).toHaveBeenCalledWith('cutover', {});
  });

  it('never caches a search, because it is a question about right now', async () => {
    searchMemory.mockResolvedValue(fixture('memory_search_response.json'));
    const store = await freshModule();
    await store.searchAionMemory('cutover');
    await store.searchAionMemory('cutover');
    expect(searchMemory).toHaveBeenCalledTimes(2);
  });

  it('reads a hitless search as no matches, not as a failure', async () => {
    searchMemory.mockResolvedValue({ scope: 'profile:eigent-managed' });
    const store = await freshModule();
    expect(await store.searchAionMemory('nothing')).toEqual([]);
  });
});

describe('aionMemoryStore mutations', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listMemory.mockResolvedValue(fixture('memory_catalog_response.json'));
    putMemory.mockResolvedValue(fixture('put_memory_response.json'));
    deleteMemory.mockResolvedValue(undefined);
    clearMemory.mockResolvedValue(fixture('clear_memory_response.json'));
  });

  it('re-reads after a write, because usage is why you look', async () => {
    const store = await freshModule();
    await store.loadAionMemory();
    expect(listMemory).toHaveBeenCalledTimes(1);

    const catalog = await store.writeAionMemory('user-preferences', 'text');
    expect(putMemory).toHaveBeenCalledWith('user-preferences', 'text', {
      scope: undefined,
    });
    expect(catalog.usage.docCount).toBe(3);
    expect(listMemory).toHaveBeenCalledTimes(2);
  });

  it('invalidates the default scope addressed under either of its two names', async () => {
    const store = await freshModule();
    const named = 'profile:eigent-managed';
    await store.loadAionMemory();
    await store.loadAionMemory(named);
    expect(listMemory).toHaveBeenCalledTimes(2);

    // The write went to the default by omission; the same scope is also cached
    // under its name, and serving that stale copy back would show a listing
    // that predates the write.
    await store.writeAionMemory('user-preferences', 'text');
    await store.loadAionMemory(named);
    expect(listMemory).toHaveBeenCalledTimes(4);
  });

  it('forgets one document and refreshes what is left', async () => {
    const store = await freshModule();
    await store.loadAionMemory();
    await store.forgetAionMemory('user-preferences');
    expect(deleteMemory).toHaveBeenCalledWith('user-preferences', {
      scope: undefined,
    });
    expect(listMemory).toHaveBeenCalledTimes(2);
  });

  it('reports the server count for a scope-wide forget rather than deriving one', async () => {
    listMemory
      .mockResolvedValueOnce(fixture('memory_catalog_response.json'))
      .mockResolvedValueOnce({
        scope: 'profile:eigent-managed',
        scopes: ['profile:eigent-managed'],
        docs: [],
        usage: {
          doc_count: '0',
          total_bytes: '0',
          cap_doc_bytes: '262144',
          cap_docs_per_scope: '256',
          cap_scope_bytes: '8388608',
        },
      });
    const store = await freshModule();
    await store.loadAionMemory();
    const cleared = await store.clearAionMemory();
    expect(cleared.deleted).toBe(3);
    expect(cleared.catalog.docs).toEqual([]);
    expect(cleared.catalog.usage.docCount).toBe(0);
  });

  it('surfaces a refused scope instead of falling back to the default', async () => {
    listMemory.mockRejectedValue(
      new Error('This deployment does not serve memory scope "profile:nope".')
    );
    const store = await freshModule();
    await expect(store.loadAionMemory('profile:nope')).rejects.toThrow(
      /does not serve memory scope/
    );
  });

  it('does not swallow a failed write', async () => {
    putMemory.mockRejectedValue(new Error('memory quota exceeded'));
    const store = await freshModule();
    await expect(store.writeAionMemory('k', 'v')).rejects.toThrow(
      'memory quota exceeded'
    );
  });
});
