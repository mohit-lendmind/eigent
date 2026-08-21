// The remote usage provider: mode negotiation gates on the 1.7 usage floor,
// the contract summary projects onto the UI row type WITHOUT collapsing the
// three cost states, and the page walk caches only the unfiltered first page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getIntegrationStatus, getUsage } = vi.hoisted(() => ({
  getIntegrationStatus: vi.fn(),
  getUsage: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    getUsage = getUsage;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

function remoteStatus(edgeApiVersion = '1.7.0') {
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
  return import('@/store/aionUsageStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionUsageStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionUsageMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the usage floor rather than reporting a bill of zero', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.6.0'));
    const store = await freshModule();
    expect(await store.getAionUsageMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.6.0',
    });
    // Refusing here is the point: a below-floor edge 404s the route, and zero
    // totals would read as "you spent nothing".
    await expect(store.loadAionUsage()).rejects.toThrow(/does not report usage/);
    expect(getUsage).not.toHaveBeenCalled();
  });

  it('refuses a major-mismatched edge that clears the minor floor numerically', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue({
      edge_api_version: '2.9.0',
      event_schema_version: '1.0',
      minimum_desktop_version: '1.0.0',
    });
    const store = await freshModule();
    expect(await store.getAionUsageMode()).toEqual({
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
    expect(await store.getAionUsageMode()).toEqual({
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
    expect(await store.getAionUsageMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionUsageMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionUsageStore projection', () => {
  it('keeps priced, unpriced and unrecorded runs apart', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getUsage.mockResolvedValue(fixture('usage_response.json'));
    const store = await freshModule();

    const page = await store.loadAionUsage();
    expect(page.totals).toEqual({
      costMicroUsd: 12000n,
      providerCalls: 5n,
      runsSettled: 3n,
      runsUnrecorded: 1n,
      // Cost and tokens are recorded by different planes, so a window has two
      // independent floors. The fixture has one run missing each, and they are
      // not the same run.
      runsWithoutTokens: 1n,
      tokens: {
        promptTokens: 437190n,
        completionTokens: 11028n,
        reasoningTokens: 1204n,
        cacheReadTokens: 389120n,
        cacheCreationTokens: 18432n,
        billableInputTokens: 29638n,
        totalTokens: 448218n,
      },
    });
    expect(page.nextPageToken).toBe('Y3JlYXRlZC1hdC1jdXJzb3I');

    const [priced, unpriced, unrecorded] = page.runs;
    expect(priced.spend).toEqual({ costMicroUsd: 12000n, providerCalls: 3n });
    expect(store.runCost(priced)).toEqual({ kind: 'amount', microUsd: 12000n });

    // A recorded zero beside real calls is a missing price list, not a free run.
    expect(unpriced.spend).toEqual({ costMicroUsd: 0n, providerCalls: 2n });
    expect(store.runCost(unpriced)).toEqual({
      kind: 'unpriced',
      providerCalls: 2n,
    });

    // Absent stays absent: the run settled with no figure recorded at all.
    expect(unrecorded).not.toHaveProperty('spend');
    expect(store.runCost(unrecorded)).toEqual({ kind: 'pending' });
    expect(unrecorded.endedAt).toBe(Date.parse('2026-08-14T09:58:33Z'));

    // The two axes cross: the priced run carries tokens, the unpriced one does
    // not, and the run with no cost at all still reports what it consumed.
    expect(priced.tokens?.totalTokens).toBe(422022n);
    expect(unpriced).not.toHaveProperty('tokens');
    expect(unrecorded.tokens?.totalTokens).toBe(26196n);
  });

  it('treats half a cost pair as pending rather than inventing the other half', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getUsage.mockResolvedValue({
      totals: {
        cost_micro_usd: '0',
        provider_calls: '0',
        runs_settled: '1',
        runs_unrecorded: '1',
      },
      runs: [
        {
          run_id: 'run_1',
          project_id: 'prj_1',
          status: 'succeeded',
          cost_micro_usd: '900',
        },
      ],
    });
    const store = await freshModule();

    const [run] = (await store.loadAionUsage()).runs;
    expect(run).not.toHaveProperty('spend');
    expect(store.runCost(run)).toEqual({ kind: 'pending' });
  });

  // A partial block would still render as a complete one and quietly
  // understate the run, so the whole block is dropped.
  it('drops a token block missing a dimension rather than reading it partly', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getUsage.mockResolvedValue({
      totals: {
        cost_micro_usd: '0',
        provider_calls: '0',
        runs_settled: '1',
        runs_unrecorded: '1',
        runs_without_tokens: '0',
      },
      runs: [
        {
          run_id: 'run_1',
          project_id: 'prj_1',
          status: 'succeeded',
          tokens: { prompt_tokens: '10', completion_tokens: '4' },
        },
      ],
    });
    const store = await freshModule();

    const page = await store.loadAionUsage();
    expect(page.totals).not.toHaveProperty('tokens');
    expect(page.runs[0]).not.toHaveProperty('tokens');
  });

  it('serves an empty bill as zeros without a token', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getUsage.mockResolvedValue({
      totals: {
        cost_micro_usd: '0',
        provider_calls: '0',
        runs_settled: '0',
        runs_unrecorded: '0',
      },
      runs: [],
    });
    const store = await freshModule();

    const page = await store.loadAionUsage();
    expect(page.runs).toEqual([]);
    expect(page.totals.runsSettled).toBe(0n);
    expect(page).not.toHaveProperty('nextPageToken');
  });

  it('parses totals past the safe-integer range without rounding', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getUsage.mockResolvedValue({
      totals: {
        cost_micro_usd: '9007199254740993',
        provider_calls: '1',
        runs_settled: '1',
        runs_unrecorded: '0',
      },
      runs: [],
    });
    const store = await freshModule();

    const page = await store.loadAionUsage();
    expect(page.totals.costMicroUsd).toBe(9007199254740993n);
  });
});

describe('aionUsageStore page walk', () => {
  it('caches only the unfiltered first page', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getUsage.mockResolvedValue(fixture('usage_response.json'));
    const store = await freshModule();

    await Promise.all([store.loadAionUsage(), store.loadAionUsage()]);
    expect(getUsage).toHaveBeenCalledTimes(1);

    // A token means the user asked for more, and a window means a different
    // question: neither is ever served from the first-page cache.
    await store.loadAionUsage({ pageToken: 'page-2' });
    await store.loadAionUsage({ since: '2026-08-01T00:00:00Z' });
    await store.loadAionUsage({ projectId: 'prj_1' });
    expect(getUsage).toHaveBeenCalledTimes(4);

    store.invalidateAionUsage();
    await store.loadAionUsage();
    expect(getUsage).toHaveBeenCalledTimes(5);
  });

  it('does not pin a failed first page in the cache', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    getUsage
      .mockRejectedValueOnce(new Error('edge returned 503'))
      .mockResolvedValueOnce(fixture('usage_response.json'));
    const store = await freshModule();

    await expect(store.loadAionUsage()).rejects.toThrow('edge returned 503');
    expect((await store.loadAionUsage()).runs).toHaveLength(3);
  });
});

describe('runCost', () => {
  const run = (spend?: { costMicroUsd: bigint; providerCalls: bigint }) => ({
    runId: 'run_1',
    projectId: 'prj_1',
    status: 'succeeded',
    endedAt: 0,
    ...(spend ? { spend } : {}),
  });

  it('calls a settled run with no provider calls a genuine zero', async () => {
    const store = await freshModule();
    expect(
      store.runCost(run({ costMicroUsd: 0n, providerCalls: 0n }))
    ).toEqual({ kind: 'amount', microUsd: 0n });
  });

  it('never reports pending as an amount', async () => {
    const store = await freshModule();
    expect(store.runCost(run())).toEqual({ kind: 'pending' });
  });
});

describe('formatMicroUsd', () => {
  it('keeps four decimals under a dollar and two above it', async () => {
    const { formatMicroUsd } = await freshModule();
    expect(formatMicroUsd(12000n)).toBe('$0.0120');
    expect(formatMicroUsd(999_949n)).toBe('$0.9999');
    expect(formatMicroUsd(1_000_000n)).toBe('$1.00');
    expect(formatMicroUsd(12_345_678n)).toBe('$12.35');
    expect(formatMicroUsd(1_234_567_890n)).toBe('$1,234.57');
  });

  it('shows a bound rather than a zero for a charge that rounds away', async () => {
    const { formatMicroUsd } = await freshModule();
    expect(formatMicroUsd(0n)).toBe('$0.0000');
    expect(formatMicroUsd(1n)).toBe('<$0.0001');
  });
});
