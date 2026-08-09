// Integration Lab (doc 10 §10 M4-H) component tests over a fake transport:
// mode gating, status/model rendering, project attach with live event
// reduction, command submit through the idempotent session path, approval
// responses, and the sanitized evidence export.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectEvent } from '../../../src/api/aion/v1/contracts';
import { EDGE_API_VERSION } from '../../../src/api/aion/v1/gen/meta';
import type {
  CommandReceipt,
  IntegrationStatus,
  ModelAliasCatalog,
  ProjectEventFrame,
  ProjectSnapshot,
} from '../../../src/api/aion/v1/transport';
import IntegrationLab, {
  type LabTransport,
} from '../../../src/pages/IntegrationLab';
import { buildLabEvidence } from '../../../src/pages/IntegrationLab/evidence';

const PROJECT_ID = 'prj_01JY0000000000000000000001';
const RUN_ID = 'run_01JY0000000000000000000001';

function event(
  sequence: string,
  kind: string,
  data: Record<string, unknown>
): ProjectEvent {
  return {
    event_id: `evt_${sequence.padStart(26, '0')}`,
    schema_version: '1.0',
    project_id: PROJECT_ID,
    run_id: RUN_ID,
    sequence,
    kind,
    visibility: 'user',
    occurred_at: '2026-08-09T00:00:00Z',
    data,
  };
}

const STATUS: IntegrationStatus = {
  edge_api_version: EDGE_API_VERSION,
  event_schema_version: '1.0',
  minimum_desktop_version: '1.0.2',
  harness_generation: 'aion-go/1',
  execution_mode: 'remote',
  inference_status: 'managed',
  server_time: '2026-08-09T00:00:00Z',
  auth_identity: { tenant_id: 'tenant-a', user_id: 'user-1' },
};

const MODELS: ModelAliasCatalog = {
  aliases: [
    { alias: 'aion-default', display_name: 'Default', is_default: true },
    { alias: 'aion-fast' },
  ],
};

interface FakeTransportOptions {
  frames?: ProjectEvent[];
  status?: IntegrationStatus;
}

/**
 * Fake transport: first subscribe yields the scripted frames then stays open
 * (pending until aborted), so the session sits in 'live' without spinning
 * through reconnects.
 */
function fakeTransport(options: FakeTransportOptions = {}) {
  const submitted: Array<{ projectId: string; commandId: string }> = [];
  const approvals: Array<{ approvalId: string; decision: string }> = [];
  const cancels: Array<{ runId: string; epoch: string }> = [];

  const transport: LabTransport = {
    createProject: vi.fn(async (request) => ({
      project_id: PROJECT_ID,
      title: request.title,
      model_alias: request.model_alias,
      status: 'active' as const,
      created_at: '2026-08-09T00:00:00Z',
      updated_at: '2026-08-09T00:00:00Z',
    })),
    getProject: vi.fn(async (): Promise<ProjectSnapshot> => {
      throw new Error('unexpected snapshot fetch');
    }),
    submitCommand: vi.fn(
      async (projectId, request): Promise<CommandReceipt> => {
        submitted.push({ projectId, commandId: request.command_id });
        return {
          command_id: request.command_id,
          run_id: RUN_ID,
          run_epoch: '1',
          accepted_sequence: '10',
        };
      }
    ),
    cancelRun: vi.fn(async (_projectId, runId, request) => {
      cancels.push({ runId, epoch: request.expected_run_epoch });
    }),
    respondToApproval: vi.fn(async (_projectId, approvalId, request) => {
      approvals.push({ approvalId, decision: request.decision });
    }),
    listModelAliases: vi.fn(async () => MODELS),
    getIntegrationStatus: vi.fn(async () => options.status ?? STATUS),
    getArtifact: vi.fn(async (_projectId, artifactId) => ({
      artifact: {
        artifact_id: artifactId,
        project_id: PROJECT_ID,
        name: 'report.md',
        media_type: 'text/markdown',
        size_bytes: '12',
        sha256: 'ab'.repeat(32),
        created_at: '2026-08-09T00:00:00Z',
      },
      download_url: 'https://cas.example/presigned',
      expires_at: '2026-08-09T01:00:00Z',
    })),
    subscribeProjectEvents: async function* (
      _projectId,
      subscribeOptions = {}
    ): AsyncGenerator<ProjectEventFrame, void, undefined> {
      for (const frame of options.frames ?? []) {
        yield { id: frame.sequence, event: frame };
      }
      // Stay open until the session aborts (stop/unmount).
      await new Promise<void>((resolve) => {
        const signal = subscribeOptions.signal;
        if (!signal) return; // no signal: hang forever (never in these tests)
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    },
  };
  return { transport, submitted, approvals, cancels };
}

function renderLab(
  transport: LabTransport,
  config:
    | { mode: 'local' }
    | { mode: 'remote'; edgeBaseUrl: string; apiKey: string }
    | { mode: 'remote'; error: string } = {
    mode: 'remote',
    edgeBaseUrl: 'http://127.0.0.1:8106/eigent/v1',
    apiKey: 'sk-secret-key',
  }
) {
  return render(
    <IntegrationLab
      getTransportConfig={async () => config}
      createTransport={() => transport}
    />
  );
}

describe('IntegrationLab gating', () => {
  it('renders the local-mode notice without touching the transport', async () => {
    const { transport } = fakeTransport();
    renderLab(transport, { mode: 'local' });
    await screen.findByTestId('lab-mode-local');
    expect(transport.getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('renders the invalid-config error', async () => {
    const { transport } = fakeTransport();
    renderLab(transport, { mode: 'remote', error: 'bad endpoint' });
    const node = await screen.findByTestId('lab-config-error');
    expect(node.textContent).toContain('bad endpoint');
  });
});

describe('IntegrationLab diagnostics', () => {
  it('renders the status handshake including the 1.3.0 fields', async () => {
    const { transport } = fakeTransport();
    renderLab(transport);
    await screen.findByTestId('lab-status-panel');
    expect((await screen.findByTestId('lab-health')).textContent).toBe(
      'health: ok'
    );
    expect(
      (await screen.findByTestId('lab-execution-mode')).textContent
    ).toContain('remote');
    expect(
      (await screen.findByTestId('lab-inference-status')).textContent
    ).toContain('managed');
    expect(
      (await screen.findByTestId('lab-auth-identity')).textContent
    ).toContain('tenant tenant-a, user user-1');
    await screen.findByTestId('lab-model-row-aion-default');
    await screen.findByTestId('lab-model-row-aion-fast');
  });

  it('reports contract drift when server and client versions differ', async () => {
    const { transport } = fakeTransport({
      status: { ...STATUS, edge_api_version: '9.9.9' },
    });
    renderLab(transport);
    const health = await screen.findByTestId('lab-health');
    await waitFor(() => expect(health.textContent).toContain('contract drift'));
  });
});

describe('IntegrationLab project session', () => {
  it('creates a project and reduces the live stream into the view', async () => {
    const { transport } = fakeTransport({
      frames: [
        event('1', 'run_accepted', { run_epoch: '1' }),
        event('2', 'text_delta', { text: 'hello ' }),
        event('3', 'text_delta', { text: 'world' }),
        event('4', 'approval_required', {
          approval_id: 'apr_1',
          tool_name: 'bash',
          reason: 'destructive',
        }),
      ],
    });
    const user = userEvent.setup();
    renderLab(transport);
    await user.click(await screen.findByTestId('lab-project-create'));

    expect((await screen.findByTestId('lab-project-id')).textContent).toContain(
      PROJECT_ID
    );
    const cursor = await screen.findByTestId('lab-cursor');
    await waitFor(() => expect(cursor.textContent).toBe('cursor: 4'));
    expect(
      (await screen.findByTestId('lab-session-status')).textContent
    ).toBe('session: live');
    await screen.findByTestId(`lab-run-${RUN_ID}`);
    const entries = screen.getAllByTestId('lab-timeline-entry');
    expect(entries.map((e) => e.textContent)).toEqual([
      '[1] run_boundary: run_accepted',
      '[3] text: hello world',
      '[4] approval',
    ]);

    // Approval buttons respond through the transport.
    await user.click(screen.getByTestId('lab-approval-allow-apr_1'));
    await waitFor(() =>
      expect(transport.respondToApproval).toHaveBeenCalledWith(
        PROJECT_ID,
        'apr_1',
        { decision: 'allow' }
      )
    );

    // Active run cancel uses the observed epoch.
    await user.click(screen.getByTestId('lab-cancel-run'));
    await waitFor(() =>
      expect(transport.cancelRun).toHaveBeenCalledWith(PROJECT_ID, RUN_ID, {
        expected_run_epoch: '1',
      })
    );
  });

  it('submits commands with a fresh cmd_ idempotency identity', async () => {
    const { transport, submitted } = fakeTransport({
      frames: [event('1', 'run_accepted', { run_epoch: '1' })],
    });
    const user = userEvent.setup();
    renderLab(transport);
    await user.click(await screen.findByTestId('lab-project-create'));
    await screen.findByTestId('lab-command-input');

    await user.type(screen.getByTestId('lab-command-input'), 'run the check');
    await user.click(screen.getByTestId('lab-command-submit'));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].projectId).toBe(PROJECT_ID);
    expect(submitted[0].commandId).toMatch(/^cmd_[0-9a-f]{32}$/);
    const receipts = await screen.findByTestId('lab-command-receipts');
    await waitFor(() =>
      expect(receipts.textContent).toContain(`run ${RUN_ID}`)
    );
  });

  it('fetches an artifact download grant on demand only', async () => {
    const { transport } = fakeTransport({
      frames: [
        event('1', 'run_accepted', { run_epoch: '1' }),
        event('2', 'artifact_created', {
          artifact: { artifact_id: 'art_1', name: 'report.md' },
        }),
      ],
    });
    const user = userEvent.setup();
    renderLab(transport);
    await user.click(await screen.findByTestId('lab-project-create'));
    await user.click(await screen.findByTestId('lab-artifact-url-art_1'));
    const link = await screen.findByTestId('lab-artifact-link-art_1');
    expect(link.getAttribute('href')).toBe('https://cas.example/presigned');
  });
});

describe('IntegrationLab evidence export', () => {
  it('renders sanitized evidence without the API key or download grants', async () => {
    const { transport } = fakeTransport({
      frames: [
        event('1', 'run_accepted', { run_epoch: '1' }),
        event('2', 'text_delta', { text: 'secret model output' }),
      ],
    });
    const user = userEvent.setup();
    renderLab(transport);
    await user.click(await screen.findByTestId('lab-project-create'));
    const cursor = await screen.findByTestId('lab-cursor');
    await waitFor(() => expect(cursor.textContent).toBe('cursor: 2'));

    await user.click(screen.getByTestId('lab-export'));
    const json = (await screen.findByTestId('lab-evidence-json')).textContent!;
    expect(json).toContain(PROJECT_ID);
    expect(json).toContain('"cursor": "2"');
    expect(json).not.toContain('sk-secret-key');
    expect(json).not.toContain('apiKey');
    // Timeline is exported as shape only — no model output text.
    expect(json).not.toContain('secret model output');
  });
});

describe('buildLabEvidence', () => {
  it('is a pure projection of non-secret fields', () => {
    const evidence = buildLabEvidence({
      capturedAt: '2026-08-09T00:00:00Z',
      edgeBaseUrl: 'http://127.0.0.1:8106/eigent/v1',
      clientEdgeApiVersion: EDGE_API_VERSION,
      integrationStatus: STATUS,
      statusError: null,
      models: MODELS,
      sessionStatus: 'live',
      projectState: null,
      commandReceipts: [],
    });
    expect(evidence).toMatchObject({
      captured_at: '2026-08-09T00:00:00Z',
      client_edge_api_version: EDGE_API_VERSION,
      model_aliases: ['aion-default', 'aion-fast'],
      session_status: 'live',
      project: null,
    });
  });
});
