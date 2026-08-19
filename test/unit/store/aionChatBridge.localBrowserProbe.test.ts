// The support probe is promise-cached so one /status read serves the toggle's
// mount and every submit. That cache must hold only an ANSWER: the preload
// bridge and the remote config can both be unready when a composer first
// mounts, and caching "unsupported" there hides the toggle for the whole
// process — which is what made a follow-up submit lose local execution while
// the first submit in the same project kept it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getIntegrationStatus } = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
  },
}));

const SUPPORTED_STATUS = {
  edge_api_version: '1.22.0',
  event_schema_version: '1.0',
  minimum_desktop_version: '1.0.0',
};

function setHost(host: Record<string, unknown> | undefined) {
  (globalThis as Record<string, any>).electronAPI = host;
}

describe('probeLocalBrowserSupport caching', () => {
  beforeEach(() => {
    getIntegrationStatus.mockReset();
  });

  it('re-probes after the preload bridge was not yet attached', async () => {
    getIntegrationStatus.mockResolvedValue(SUPPORTED_STATUS);
    // First ask lands before the executor exists on the bridge.
    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test',
        apiKey: 'test-key',
      }),
    });
    vi.resetModules();
    const { probeLocalBrowserSupport } = await import(
      '@/store/aionChatBridge'
    );
    const { useAionLocalBrowserStore } = await import(
      '@/store/aionLocalBrowserStore'
    );

    expect(await probeLocalBrowserSupport()).toBe(false);
    // Not an answer, so nothing was recorded as an answer.
    expect(useAionLocalBrowserStore.getState().supported).toBeNull();
    expect(getIntegrationStatus).not.toHaveBeenCalled();

    // The bridge finishes attaching; the next composer mount must renegotiate.
    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test',
        apiKey: 'test-key',
      }),
      agentBrowserExecute: () => Promise.resolve({}),
    });
    expect(await probeLocalBrowserSupport()).toBe(true);
    expect(useAionLocalBrowserStore.getState().supported).toBe(true);
  });

  it('re-probes after onboarding replaces the credential', async () => {
    // The backend state is resolved once per renderer lifetime by design, and
    // onboarding is what legitimately changes it. Support is a fact about the
    // build/backend PAIRING, so it has to be renegotiated on that same seam —
    // otherwise onboarding into a delegating cell leaves the toggle hidden
    // until the next launch.
    getIntegrationStatus.mockResolvedValue(SUPPORTED_STATUS);
    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test',
        needsKey: true,
      }),
      agentBrowserExecute: () => Promise.resolve({}),
    });
    vi.resetModules();
    const { probeLocalBrowserSupport, resetAionBackendState } = await import(
      '@/store/aionChatBridge'
    );

    expect(await probeLocalBrowserSupport()).toBe(false);
    expect(getIntegrationStatus).not.toHaveBeenCalled();

    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test',
        apiKey: 'test-key',
      }),
      agentBrowserExecute: () => Promise.resolve({}),
    });
    resetAionBackendState();
    expect(await probeLocalBrowserSupport()).toBe(true);
  });

  it('caches an answer from the contract and reads /status once', async () => {
    // A downgraded edge IS an answer about this build/backend pairing, so it
    // must not re-dial on every mount the way a precondition does.
    getIntegrationStatus.mockResolvedValue({
      ...SUPPORTED_STATUS,
      edge_api_version: '1.18.0',
    });
    setHost({
      getAionTransportConfig: async () => ({
        mode: 'remote',
        edgeBaseUrl: 'http://edge.test',
        apiKey: 'test-key',
      }),
      agentBrowserExecute: () => Promise.resolve({}),
    });
    vi.resetModules();
    const { probeLocalBrowserSupport } = await import(
      '@/store/aionChatBridge'
    );
    const { useAionLocalBrowserStore } = await import(
      '@/store/aionLocalBrowserStore'
    );

    expect(await probeLocalBrowserSupport()).toBe(false);
    expect(await probeLocalBrowserSupport()).toBe(false);
    expect(useAionLocalBrowserStore.getState().supported).toBe(false);
    expect(getIntegrationStatus).toHaveBeenCalledTimes(1);
  });
});
