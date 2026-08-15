// The account provider and the onboarding path that produces its credential.
//
// Two orderings carry the weight here and neither is visible from a passing
// happy path: a pasted key is proven against whoami BEFORE it is stored, so a
// typo cannot strand the profile behind a panel that needs the key it broke;
// and a key that came from the environment is refused outright, because the
// file this app would write is shadowed on the next restart.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getIntegrationStatus,
  getAccount,
  listKeys,
  createKey,
  revokeKey,
  constructed,
} = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  getAccount: vi.fn(),
  listKeys: vi.fn(),
  createKey: vi.fn(),
  revokeKey: vi.fn(),
  constructed: [] as { baseUrl: string; apiKey: string }[],
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    constructor(options: { baseUrl: string; apiKey: string }) {
      constructed.push(options);
    }
    getIntegrationStatus = getIntegrationStatus;
    getAccount = getAccount;
    listKeys = listKeys;
    createKey = createKey;
    revokeKey = revokeKey;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

function remoteStatus(edgeApiVersion = '1.11.0') {
  return {
    edge_api_version: edgeApiVersion,
    event_schema_version: '1.0',
    minimum_desktop_version: '1.0.0',
  };
}

type HostAPI = Record<string, any>;

function setHost(api: HostAPI): void {
  (globalThis as Record<string, any>).electronAPI = api;
}

function setRemoteConfig(keySource: 'env' | 'file' = 'file'): void {
  setHost({
    getAionTransportConfig: async () => ({
      mode: 'remote',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
      apiKey: 'test-key',
      keySource,
    }),
  });
}

async function freshModule() {
  vi.resetModules();
  return import('@/store/aionAccountStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  constructed.length = 0;
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionAccountStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionAccountMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('reports a configured endpoint with no key as onboarding, not an error', async () => {
    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test/eigent/v1',
        needsKey: true,
      }),
    });
    const store = await freshModule();
    expect(await store.getAionAccountMode()).toEqual({
      kind: 'needs-key',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
    });
    // Nothing to negotiate against yet — an unauthenticated probe here would
    // only report what the backend can do, not whether this app may use it.
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the account floor rather than showing an empty identity', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.10.0'));
    const store = await freshModule();
    expect(await store.getAionAccountMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.10.0',
    });
    await expect(store.loadAionAccount()).rejects.toThrow(
      /does not serve account information/
    );
    expect(getAccount).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('2.11.0'));
    const store = await freshModule();
    expect(await store.getAionAccountMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '2.11.0',
    });
  });

  it('stays on the account surface when the version probe is refused', async () => {
    setRemoteConfig();
    // The edge verifies a credential presented to /status and refuses a
    // revoked one, so the probe fails exactly when the user most needs this
    // panel — it is the only place in the app that can clear the dead key.
    getIntegrationStatus.mockRejectedValue(
      new Error('401 invalid_credentials: Authentication failed')
    );
    getAccount.mockRejectedValue(
      new Error('401 invalid_credentials: Authentication failed')
    );
    const store = await freshModule();
    expect(await store.getAionAccountMode()).toEqual({
      kind: 'remote',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
      keySource: 'file',
    });
    // An unreadable version is not a version known to be too old, and the
    // refusal still reaches the user — through the read that follows.
    await expect(store.loadAionAccount()).rejects.toThrow(
      /invalid_credentials/
    );
  });

  it('surfaces a misconfigured remote mode as an error, never local', async () => {
    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        error: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
      }),
    });
    const store = await freshModule();
    expect(await store.getAionAccountMode()).toEqual({
      kind: 'error',
      message: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
    });
  });
});

describe('aionAccountStore identity and keys', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getAccount.mockResolvedValue(fixture('account_response.json'));
    listKeys.mockResolvedValue(fixture('key_list_response.json'));
  });

  it('keeps an empty scope list and an absent user distinct from zero values', async () => {
    const store = await freshModule();
    const account = await store.loadAionAccount();
    // Empty scopes mean UNRESTRICTED; the surface says so rather than
    // rendering "no permissions".
    expect(account.scopes).toEqual([]);
    expect(account.tenantId).toBe('tenant-eigent-local');
    expect(account.keyManagement).toBe(true);

    getAccount.mockResolvedValue({
      ...fixture('account_response.json'),
      user_id: undefined,
      key_management: undefined,
    });
    store.invalidateAionAccount();
    const tenantWide = await store.loadAionAccount();
    // A tenant-wide key names nobody. That is a different fact from a user
    // with no name, and it is why per-user resources are unavailable to it.
    expect(tenantWide.userId).toBeUndefined();
    // Absent means "this deployment does not serve /keys" — never assume it
    // does and render actions that 501.
    expect(tenantWide.keyManagement).toBe(false);
  });

  it('carries the never-used and unnamed rows through as absences', async () => {
    const store = await freshModule();
    const keys = await store.loadAionApiKeys();
    const byId = Object.fromEntries(keys.map((key) => [key.keyId, key]));

    expect(byId['9f2c41a7e0b34d58'].current).toBe(true);
    expect(byId['1b7d05c9a4e2f631'].current).toBe(false);
    // Never authenticated. This is what makes a key safe to revoke, so it must
    // not arrive as an epoch timestamp.
    expect(byId['c30e88b1d5476a29'].lastUsedAt).toBeUndefined();
    expect(byId['c30e88b1d5476a29'].label).toBeUndefined();
    expect(byId['44a9f7e3c1082b6d'].status).toBe('revoked');
  });

  it('shares one fetch between concurrent opens and retries after a failure', async () => {
    const store = await freshModule();
    const [first, second] = await Promise.all([
      store.loadAionApiKeys(),
      store.loadAionApiKeys(),
    ]);
    expect(first).toBe(second);
    expect(listKeys).toHaveBeenCalledTimes(1);

    store.invalidateAionAccount();
    listKeys
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(fixture('key_list_response.json'));
    await expect(store.loadAionApiKeys()).rejects.toThrow('edge unreachable');
    expect((await store.loadAionApiKeys()).length).toBe(4);
  });

  it('returns a minted secret to the caller and never caches it', async () => {
    createKey.mockResolvedValue(fixture('create_key_response.json'));
    const store = await freshModule();
    await store.loadAionApiKeys();

    const minted = await store.createAionApiKey('  this laptop  ');
    expect(createKey).toHaveBeenCalledWith({ label: 'this laptop' });
    expect(minted).toEqual({
      keyId: 'c30e88b1d5476a29',
      rawKey: '<raw-key-shown-once>',
      replayed: false,
    });
    // The new row is only in the list the server returns next.
    await store.loadAionApiKeys();
    expect(listKeys).toHaveBeenCalledTimes(2);
  });

  it('omits an all-whitespace label instead of sending a blank one', async () => {
    createKey.mockResolvedValue(fixture('create_key_response.json'));
    const store = await freshModule();
    await store.createAionApiKey('   ');
    expect(createKey).toHaveBeenCalledWith({});
  });

  it('treats a replay as a success with nothing to show', async () => {
    createKey.mockResolvedValue(fixture('create_key_replay_response.json'));
    const store = await freshModule();
    const minted = await store.createAionApiKey();
    // Not an empty key: the secret was handed over once and is unrecoverable.
    expect(minted.replayed).toBe(true);
    expect(minted.rawKey).toBeUndefined();
    expect(minted.keyId).toBe('c30e88b1d5476a29');
  });

  it('resolves revoke to the refreshed list', async () => {
    revokeKey.mockResolvedValue(undefined);
    const store = await freshModule();
    await store.loadAionApiKeys();

    listKeys.mockResolvedValue({
      keys: [
        {
          key_id: '1b7d05c9a4e2f631',
          status: 'revoked',
          scopes: [],
          created_at: '2026-07-19T16:40:00Z',
          current: false,
        },
      ],
    });
    const keys = await store.revokeAionApiKey('1b7d05c9a4e2f631');
    expect(revokeKey).toHaveBeenCalledWith('1b7d05c9a4e2f631');
    expect(keys).toEqual([
      expect.objectContaining({ keyId: '1b7d05c9a4e2f631', status: 'revoked' }),
    ]);
  });

  it('propagates a failed revoke instead of reporting the key gone', async () => {
    revokeKey.mockRejectedValue(new Error('key_not_found'));
    const store = await freshModule();
    await expect(store.revokeAionApiKey('missing')).rejects.toThrow(
      'key_not_found'
    );
  });
});

describe('verifyAndStoreAionApiKey', () => {
  const needsKeyHost = (
    setAionApiKey: HostAPI['setAionApiKey']
  ): HostAPI => ({
    getAionTransportConfig: async () => ({
      mode: 'remote',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
      needsKey: true,
    }),
    setAionApiKey,
  });

  it('verifies with the pasted key before storing it', async () => {
    const setAionApiKey = vi.fn(async () => ({ ok: true as const }));
    let stored = false;
    setHost({
      getAionTransportConfig: async () =>
        stored
          ? {
              mode: 'remote',
              edgeBaseUrl: 'http://edge.test/eigent/v1',
              apiKey: 'sk-pasted',
              keySource: 'file',
            }
          : {
              mode: 'remote',
              edgeBaseUrl: 'http://edge.test/eigent/v1',
              needsKey: true,
            },
      setAionApiKey: async (key: string) => {
        stored = true;
        return setAionApiKey(key);
      },
    });
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getAccount.mockResolvedValue(fixture('account_response.json'));

    const store = await freshModule();
    expect((await store.getAionAccountMode()).kind).toBe('needs-key');

    const account = await store.verifyAndStoreAionApiKey('  sk-pasted  ');
    expect(account.tenantId).toBe('tenant-eigent-local');
    // The probe used the candidate, not whatever the app was holding.
    expect(constructed).toEqual([
      { baseUrl: 'http://edge.test/eigent/v1', apiKey: 'sk-pasted' },
    ]);
    expect(setAionApiKey).toHaveBeenCalledWith('sk-pasted');

    // Onboarding is the one thing that legitimately changes the backend state
    // mid-lifetime, so it must invalidate what was negotiated against the old
    // one — otherwise the only way to reach the app is a restart.
    expect(await store.getAionAccountMode()).toEqual({
      kind: 'remote',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
      keySource: 'file',
    });
  });

  it('stores nothing when whoami refuses the key', async () => {
    const setAionApiKey = vi.fn(async () => ({ ok: true as const }));
    setHost(needsKeyHost(setAionApiKey));
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getAccount.mockRejectedValue(new Error('unauthorized'));

    const store = await freshModule();
    await expect(store.verifyAndStoreAionApiKey('sk-typo')).rejects.toThrow(
      'unauthorized'
    );
    // Storing first is the cheaper order and the wrong one: it would leave the
    // profile 401-ing everywhere, recoverable only through the panel this key
    // unlocks.
    expect(setAionApiKey).not.toHaveBeenCalled();
  });

  it('refuses a backend too old to verify against instead of storing blind', async () => {
    const setAionApiKey = vi.fn(async () => ({ ok: true as const }));
    setHost(needsKeyHost(setAionApiKey));
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.10.0'));

    const store = await freshModule();
    await expect(store.verifyAndStoreAionApiKey('sk-pasted')).rejects.toThrow(
      /EIGENT_REMOTE_BACKEND_API_KEY_FILE/
    );
    expect(getAccount).not.toHaveBeenCalled();
    expect(setAionApiKey).not.toHaveBeenCalled();
  });

  it('refuses an env-pinned key, which a written file cannot replace', async () => {
    setRemoteConfig('env');
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    const store = await freshModule();
    await expect(store.verifyAndStoreAionApiKey('sk-pasted')).rejects.toThrow(
      /set in the environment/
    );
    expect(getAccount).not.toHaveBeenCalled();
  });

  it('reports a refusal from the main process rather than claiming success', async () => {
    setHost(
      needsKeyHost(async () => ({ ok: false as const, error: 'EACCES' }))
    );
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getAccount.mockResolvedValue(fixture('account_response.json'));

    const store = await freshModule();
    await expect(store.verifyAndStoreAionApiKey('sk-pasted')).rejects.toThrow(
      'EACCES'
    );
  });

  it('refuses an empty paste without touching the network', async () => {
    setHost(needsKeyHost(vi.fn()));
    const store = await freshModule();
    await expect(store.verifyAndStoreAionApiKey('   ')).rejects.toThrow(
      /Paste an API key/
    );
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });
});

describe('clearStoredAionApiKey', () => {
  it('clears the credential and drops everything negotiated against it', async () => {
    const clearAionApiKey = vi.fn(async () => ({ ok: true as const }));
    let cleared = false;
    setHost({
      getAionTransportConfig: async () =>
        cleared
          ? {
              mode: 'remote',
              edgeBaseUrl: 'http://edge.test/eigent/v1',
              needsKey: true,
            }
          : {
              mode: 'remote',
              edgeBaseUrl: 'http://edge.test/eigent/v1',
              apiKey: 'test-key',
              keySource: 'file',
            },
      clearAionApiKey,
    });
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getAccount.mockResolvedValue(fixture('account_response.json'));

    const store = await freshModule();
    await store.loadAionAccount();
    await store.clearStoredAionApiKey();
    cleared = true;

    expect(clearAionApiKey).toHaveBeenCalledTimes(1);
    expect((await store.getAionAccountMode()).kind).toBe('needs-key');
  });

  it('propagates a refusal instead of leaving the app looking signed out', async () => {
    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test/eigent/v1',
        apiKey: 'test-key',
        keySource: 'file',
      }),
      clearAionApiKey: async () => ({ ok: false as const, error: 'EROFS' }),
    });
    const store = await freshModule();
    await expect(store.clearStoredAionApiKey()).rejects.toThrow('EROFS');
  });
});
