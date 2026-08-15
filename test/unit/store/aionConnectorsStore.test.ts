// The remote connector provider: mode negotiation gates on the 1.9 connectors
// floor, and the catalog projection keeps `connected` and `connectable` apart —
// collapsing them would offer a Connect action on a server that has no vault to
// hold the grant, and would read "the operator has not enabled connectors" as
// "you have not connected yet".
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getIntegrationStatus, listConnectors, initiateConnectorAuth, disconnectConnector } =
  vi.hoisted(() => ({
    getIntegrationStatus: vi.fn(),
    listConnectors: vi.fn(),
    initiateConnectorAuth: vi.fn(),
    disconnectConnector: vi.fn(),
  }));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listConnectors = listConnectors;
    initiateConnectorAuth = initiateConnectorAuth;
    disconnectConnector = disconnectConnector;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

function remoteStatus(edgeApiVersion = '1.9.0') {
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
  return import('@/store/aionConnectorsStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionConnectorsStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionConnectorsMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the connectors floor rather than reporting an empty catalog', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.8.0'));
    const store = await freshModule();
    expect(await store.getAionConnectorsMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.8.0',
    });
    // An empty list here would claim this tenant has no integrations.
    await expect(store.loadAionConnectors()).rejects.toThrow(
      /does not serve connectors/
    );
    expect(listConnectors).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('2.9.0'));
    const store = await freshModule();
    expect(await store.getAionConnectorsMode()).toEqual({
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
    expect(await store.getAionConnectorsMode()).toEqual({
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
    expect(await store.getAionConnectorsMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionConnectorsMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionConnectorsStore catalog states', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listConnectors.mockResolvedValue(fixture('connector_catalog_response.json'));
  });

  it('keeps connected, connectable and unavailable apart', async () => {
    const store = await freshModule();
    const rows = await store.loadAionConnectors();
    const byId = Object.fromEntries(rows.map((row) => [row.connectorId, row]));

    expect(store.connectorState(byId.github)).toEqual({ kind: 'connected' });
    expect(store.connectorState(byId.linear)).toEqual({ kind: 'disconnected' });
    // Same `connected: false` as linear — only `connectable` tells the user
    // this one is the operator's problem, not theirs.
    expect(byId.notion.connected).toBe(false);
    expect(store.connectorState(byId.notion)).toEqual({ kind: 'unavailable' });
  });

  it('treats the kinds that need no grant as provisioned, not connected', async () => {
    const store = await freshModule();
    const rows = await store.loadAionConnectors();
    const byId = Object.fromEntries(rows.map((row) => [row.connectorId, row]));

    // Both report `connected: true` on the wire, but neither has a grant to
    // revoke — offering Disconnect would call a route that cannot succeed.
    expect(store.connectorState(byId['internal-search'])).toEqual({
      kind: 'provisioned',
    });
    expect(store.connectorState(byId['sandbox-echo'])).toEqual({
      kind: 'provisioned',
    });
  });

  it('defaults a row missing both flags to unavailable rather than connected', async () => {
    listConnectors.mockResolvedValue({
      connectors: [
        {
          connector_id: 'partial',
          display_name: 'Partial',
          auth_kind: 'oauth',
          status: 'active',
        },
      ],
    });
    const store = await freshModule();
    const [row] = await store.loadAionConnectors();
    expect(row.connected).toBe(false);
    expect(row.connectable).toBe(false);
    expect(store.connectorState(row)).toEqual({ kind: 'unavailable' });
  });

  it('serves an empty catalog as an empty list', async () => {
    listConnectors.mockResolvedValue({ connectors: [] });
    const store = await freshModule();
    expect(await store.loadAionConnectors()).toEqual([]);
  });

  it('caches the catalog and shares one fetch between concurrent opens', async () => {
    const store = await freshModule();
    const [first, second] = await Promise.all([
      store.loadAionConnectors(),
      store.loadAionConnectors(),
    ]);
    expect(first).toBe(second);
    expect(listConnectors).toHaveBeenCalledTimes(1);
  });

  it('drops the cache after a failed read so the next open retries', async () => {
    listConnectors
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(fixture('connector_catalog_response.json'));
    const store = await freshModule();
    await expect(store.loadAionConnectors()).rejects.toThrow('edge unreachable');
    expect((await store.loadAionConnectors()).length).toBe(5);
  });
});

describe('aionConnectorsStore actions', () => {
  beforeEach(() => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listConnectors.mockResolvedValue(fixture('connector_catalog_response.json'));
  });

  it('returns the consent URL and invalidates the catalog it must not answer from', async () => {
    initiateConnectorAuth.mockResolvedValue(
      fixture('connector_auth_response.json')
    );
    const store = await freshModule();
    await store.loadAionConnectors();

    const url = await store.connectAionConnector('linear');
    expect(url).toContain('https://linear.app/oauth/authorize');
    expect(initiateConnectorAuth).toHaveBeenCalledWith('linear');

    // The grant lands on the cell's callback, so the poll that follows must not
    // be served the snapshot taken before the flow started.
    await store.loadAionConnectors();
    expect(listConnectors).toHaveBeenCalledTimes(2);
  });

  it('resolves disconnect to the refreshed catalog, keeping the row', async () => {
    disconnectConnector.mockResolvedValue(undefined);
    const store = await freshModule();
    await store.loadAionConnectors();

    listConnectors.mockResolvedValue({
      connectors: [
        {
          connector_id: 'github',
          display_name: 'GitHub',
          auth_kind: 'oauth',
          status: 'active',
          connected: false,
          connectable: true,
        },
      ],
    });
    const rows = await store.disconnectAionConnector('github');
    expect(disconnectConnector).toHaveBeenCalledWith('github');
    // Soft revoke: still in the catalog, connectable again.
    expect(rows).toHaveLength(1);
    expect(store.connectorState(rows[0])).toEqual({ kind: 'disconnected' });
  });

  it('propagates a failed auth request instead of reporting a connection', async () => {
    initiateConnectorAuth.mockRejectedValue(new Error('connector_not_ready'));
    const store = await freshModule();
    await expect(store.connectAionConnector('notion')).rejects.toThrow(
      'connector_not_ready'
    );
  });
});
