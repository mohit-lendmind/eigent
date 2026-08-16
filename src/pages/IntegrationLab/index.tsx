// Integration Lab (doc 10 §10 M4-H): the desktop diagnostics view over the
// aion boundary. Renders ONLY authorized projections — the transport config
// the main process resolved, the /status handshake, the model-alias catalog,
// and one Project's reducer state via ProjectSession. It never touches the
// legacy local brain, never renders the API key, and exports evidence through
// the sanitized builder in ./evidence.
//
// The route mounts OUTSIDE ProtectedRoute: the legacy auto-login guard talks
// to the local Python backend, which does not exist in remote-backend mode.
// The page gates itself on the resolved transport mode instead.

import {
  initialProjectState,
  type ProjectUIState,
} from '@/api/aion/v1/reducer';
import {
  newCommandId,
  ProjectSession,
  type SessionStatus,
} from '@/api/aion/v1/session';
import {
  EdgeTransport,
  type CommandReceipt,
  type IntegrationStatus,
  type ModelAliasCatalog,
} from '@/api/aion/v1/transport';
import { EDGE_API_VERSION } from '@/api/aion/v1/gen/meta';
import { supportsRunRecovery } from '@/api/aion/v1/compat';
import { useHost } from '@/host';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildLabEvidence } from './evidence';

type TransportConfig =
  | { mode: 'local' }
  | { mode: 'remote'; edgeBaseUrl: string; apiKey: string }
  | { mode: 'remote'; edgeBaseUrl: string; needsKey: true }
  | { mode: 'remote'; error: string };

/** The full transport surface the Lab exercises (narrow for tests). */
export type LabTransport = Pick<
  EdgeTransport,
  | 'createProject'
  | 'getProject'
  | 'submitCommand'
  | 'cancelRun'
  | 'respondToApproval'
  | 'listModelAliases'
  | 'getIntegrationStatus'
  | 'getArtifact'
  | 'subscribeProjectEvents'
>;

export interface IntegrationLabProps {
  /** Injectable config source; defaults to the Host Electron bridge. */
  getTransportConfig?: () => Promise<TransportConfig | null>;
  /** Injectable transport factory; defaults to the real EdgeTransport. */
  createTransport?: (config: {
    edgeBaseUrl: string;
    apiKey: string;
  }) => LabTransport;
}

const defaultCreateTransport = (config: {
  edgeBaseUrl: string;
  apiKey: string;
}): LabTransport =>
  new EdgeTransport({ baseUrl: config.edgeBaseUrl, apiKey: config.apiKey });

type ConfigState =
  | { phase: 'loading' }
  | { phase: 'local' }
  | { phase: 'invalid'; error: string }
  // A configured endpoint with no credential yet. Kept apart from 'invalid'
  // because nothing here is wrong — and apart from 'remote' because a lab
  // built to diagnose the edge must not present a working-looking panel to
  // someone whose every request will come back 401.
  | { phase: 'needs-key'; edgeBaseUrl: string }
  | { phase: 'remote'; edgeBaseUrl: string; transport: LabTransport };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function IntegrationLab({
  getTransportConfig,
  createTransport = defaultCreateTransport,
}: IntegrationLabProps) {
  const host = useHost();
  const [config, setConfig] = useState<ConfigState>({ phase: 'loading' });

  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelAliasCatalog | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectState, setProjectState] = useState<ProjectUIState | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const sessionRef = useRef<ProjectSession | null>(null);

  const [title, setTitle] = useState('Integration Lab check');
  const [alias, setAlias] = useState('');
  const [attachId, setAttachId] = useState('');
  const [commandText, setCommandText] = useState('');
  const [receipts, setReceipts] = useState<CommandReceipt[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [artifactUrls, setArtifactUrls] = useState<Record<string, string>>({});
  const [evidenceJson, setEvidenceJson] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const resolveConfig =
      getTransportConfig ??
      (async (): Promise<TransportConfig | null> =>
        (await host?.electronAPI?.getAionTransportConfig?.()) ?? null);
    resolveConfig()
      .then((resolved) => {
        if (cancelled) return;
        if (!resolved || resolved.mode === 'local') {
          setConfig({ phase: 'local' });
        } else if ('error' in resolved) {
          setConfig({ phase: 'invalid', error: resolved.error });
        } else if ('needsKey' in resolved) {
          setConfig({ phase: 'needs-key', edgeBaseUrl: resolved.edgeBaseUrl });
        } else {
          setConfig({
            phase: 'remote',
            edgeBaseUrl: resolved.edgeBaseUrl,
            transport: createTransport(resolved),
          });
        }
      })
      .catch((error) => {
        if (!cancelled) setConfig({ phase: 'invalid', error: errorText(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [getTransportConfig, createTransport, host]);

  const transport = config.phase === 'remote' ? config.transport : null;

  useEffect(() => {
    if (!transport) return;
    transport.getIntegrationStatus().then(
      (s) => setStatus(s),
      (error) => setStatusError(errorText(error))
    );
    transport.listModelAliases().then(
      (catalog) => {
        setModels(catalog);
        const preferred =
          catalog.aliases.find((a) => a.is_default) ?? catalog.aliases[0];
        if (preferred) {
          setAlias((current) => current || preferred.alias);
        }
      },
      (error) => setModelsError(errorText(error))
    );
  }, [transport]);

  useEffect(
    () => () => {
      sessionRef.current?.stop();
    },
    []
  );

  const attach = useCallback(
    (id: string) => {
      if (!transport) return;
      sessionRef.current?.stop();
      const session = new ProjectSession({
        transport,
        projectId: id,
        onState: setProjectState,
        onStatus: setSessionStatus,
      });
      sessionRef.current = session;
      setProjectId(id);
      setProjectState(initialProjectState(id));
      setReceipts([]);
      setArtifactUrls({});
      setActionError(null);
      void session.start();
    },
    [transport]
  );

  const detach = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setProjectId(null);
    setProjectState(null);
    setSessionStatus(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!transport) return;
    setActionError(null);
    try {
      const project = await transport.createProject({
        title,
        model_alias: alias,
      });
      attach(project.project_id);
    } catch (error) {
      setActionError(errorText(error));
    }
  }, [transport, title, alias, attach]);

  const handleSubmitCommand = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || commandText === '') return;
    setActionError(null);
    try {
      const receipt = await session.submitCommand({
        command_id: newCommandId(),
        text: commandText,
      });
      setReceipts((current) => [...current, receipt]);
      setCommandText('');
    } catch (error) {
      setActionError(errorText(error));
    }
  }, [commandText]);

  const activeRun =
    projectState?.activeRunId != null
      ? projectState.runs[projectState.activeRunId]
      : null;

  const handleCancelRun = useCallback(async () => {
    if (!transport || !projectId || !activeRun?.runEpoch) return;
    setActionError(null);
    try {
      await transport.cancelRun(projectId, activeRun.runId, {
        expected_run_epoch: activeRun.runEpoch,
      });
    } catch (error) {
      setActionError(errorText(error));
    }
  }, [transport, projectId, activeRun]);

  const handleApproval = useCallback(
    async (approvalId: string, decision: 'allow' | 'deny') => {
      if (!transport || !projectId) return;
      setActionError(null);
      try {
        await transport.respondToApproval(projectId, approvalId, { decision });
      } catch (error) {
        setActionError(errorText(error));
      }
    },
    [transport, projectId]
  );

  const handleArtifactUrl = useCallback(
    async (artifactId: string) => {
      if (!transport || !projectId) return;
      setActionError(null);
      try {
        const access = await transport.getArtifact(projectId, artifactId);
        setArtifactUrls((current) => ({
          ...current,
          [artifactId]: access.download_url,
        }));
      } catch (error) {
        setActionError(errorText(error));
      }
    },
    [transport, projectId]
  );

  const handleExport = useCallback(() => {
    if (config.phase !== 'remote') return;
    const evidence = buildLabEvidence({
      capturedAt: new Date().toISOString(),
      edgeBaseUrl: config.edgeBaseUrl,
      clientEdgeApiVersion: EDGE_API_VERSION,
      integrationStatus: status,
      statusError,
      models,
      sessionStatus,
      projectState,
      commandReceipts: receipts,
    });
    const json = JSON.stringify(evidence, null, 2);
    setEvidenceJson(json);
    try {
      const url = URL.createObjectURL(
        new Blob([json], { type: 'application/json' })
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `aion-integration-lab-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      // No object-URL support (tests): the inline rendering below is the export.
    }
  }, [config, status, statusError, models, sessionStatus, projectState, receipts]);

  if (config.phase === 'loading') {
    return (
      <div className="p-6" data-testid="lab-loading">
        Resolving transport configuration…
      </div>
    );
  }
  if (config.phase === 'local') {
    return (
      <div className="p-6" data-testid="lab-mode-local">
        Integration Lab requires remote-backend mode. Set
        EIGENT_REMOTE_BACKEND_URL (and an API key) and restart the app.
      </div>
    );
  }
  if (config.phase === 'invalid') {
    return (
      <div className="p-6" data-testid="lab-config-error">
        Remote backend configuration is invalid: {config.error}
      </div>
    );
  }
  if (config.phase === 'needs-key') {
    return (
      <div className="p-6" data-testid="lab-needs-key">
        No API key yet for {config.edgeBaseUrl}. Add one from onboarding, then
        reopen this lab.
      </div>
    );
  }

  const authIdentity = status?.auth_identity;
  const health = statusError
    ? `error: ${statusError}`
    : status === null
      ? 'checking'
      : status.edge_api_version === EDGE_API_VERSION
        ? 'ok'
        : `contract drift: server ${status.edge_api_version}, client ${EDGE_API_VERSION}`;

  return (
    <div className="p-6 space-y-6 text-sm" data-testid="lab-root">
      <h1 className="text-lg font-bold">aion Integration Lab</h1>

      <section data-testid="lab-status-panel" className="space-y-1">
        <h2 className="font-semibold">Edge status</h2>
        <div data-testid="lab-health">health: {health}</div>
        <div data-testid="lab-edge-base-url">edge: {config.edgeBaseUrl}</div>
        <div data-testid="lab-client-version">
          client edge_api: {EDGE_API_VERSION}
        </div>
        {status && (
          <>
            <div data-testid="lab-edge-version">
              server edge_api: {status.edge_api_version}
            </div>
            <div data-testid="lab-event-schema-version">
              event schema: {status.event_schema_version}
            </div>
            <div data-testid="lab-min-desktop-version">
              minimum desktop: {status.minimum_desktop_version}
            </div>
            <div data-testid="lab-harness-generation">
              harness: {status.harness_generation ?? 'unknown'}
            </div>
            <div data-testid="lab-execution-mode">
              execution mode: {status.execution_mode ?? 'undeclared'}
            </div>
            <div data-testid="lab-inference-status">
              inference: {status.inference_status ?? 'undeclared'}
            </div>
            <div data-testid="lab-server-time">
              server time: {status.server_time ?? 'unknown'}
            </div>
            {/* Whether a stream that stopped can explain itself. Below the
                floor a parked run emits nothing, so "still thinking" and
                "stuck behind a quarantined record" are the same silence from
                here — an operator debugging a hung run needs to know which
                pairing they are looking at before they read anything into it. */}
            <div data-testid="lab-run-recovery-reporting">
              parked runs:{' '}
              {supportsRunRecovery(status)
                ? 'reported'
                : 'not reported by this backend'}
            </div>
            <div data-testid="lab-auth-identity">
              identity:{' '}
              {authIdentity
                ? `tenant ${authIdentity.tenant_id}${
                    authIdentity.user_id ? `, user ${authIdentity.user_id}` : ''
                  }`
                : 'anonymous (credential not verified by /status)'}
            </div>
          </>
        )}
      </section>

      <section data-testid="lab-models" className="space-y-1">
        <h2 className="font-semibold">Model aliases</h2>
        {modelsError && <div>catalog error: {modelsError}</div>}
        <ul>
          {models?.aliases.map((option) => (
            <li key={option.alias} data-testid={`lab-model-row-${option.alias}`}>
              {option.alias}
              {option.is_default ? ' (default)' : ''}
              {option.display_name ? ` — ${option.display_name}` : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Project</h2>
        {projectId === null ? (
          <div className="space-y-2">
            <div>
              <input
                data-testid="lab-project-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="title"
              />
              <select
                data-testid="lab-project-alias"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              >
                {models?.aliases.map((option) => (
                  <option key={option.alias} value={option.alias}>
                    {option.alias}
                  </option>
                ))}
              </select>
              <button data-testid="lab-project-create" onClick={handleCreate}>
                Create project
              </button>
            </div>
            <div>
              <input
                data-testid="lab-project-attach-input"
                value={attachId}
                onChange={(e) => setAttachId(e.target.value)}
                placeholder="prj_…"
              />
              <button
                data-testid="lab-project-attach"
                onClick={() => attachId && attach(attachId)}
              >
                Attach
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div data-testid="lab-project-id">project: {projectId}</div>
            <div data-testid="lab-session-status">
              session: {sessionStatus ?? 'idle'}
            </div>
            <div data-testid="lab-cursor">
              cursor: {projectState?.lastSequence ?? '0'}
            </div>
            <div data-testid="lab-rehydrated-from">
              rehydrated from: {projectState?.rehydratedFrom ?? '0'}
            </div>
            <div data-testid="lab-gap-count">
              gaps: {projectState?.gapCount ?? 0}
            </div>
            <div data-testid="lab-suppressed-count">
              suppressed: {projectState?.suppressedEventCount ?? 0}
            </div>
            <button data-testid="lab-detach" onClick={detach}>
              Detach
            </button>

            <div data-testid="lab-runs">
              <h3 className="font-semibold">Runs</h3>
              <ul>
                {Object.values(projectState?.runs ?? {}).map((run) => (
                  <li key={run.runId} data-testid={`lab-run-${run.runId}`}>
                    {run.runId}: {run.status}
                    {run.runEpoch ? ` (epoch ${run.runEpoch})` : ''}
                    {run.outcomeReason ? ` — ${run.outcomeReason}` : ''}
                    {run.outcomeDetail ? ` — ${run.outcomeDetail}` : ''}
                  </li>
                ))}
              </ul>
              {activeRun?.runEpoch && (
                <button data-testid="lab-cancel-run" onClick={handleCancelRun}>
                  Cancel active run
                </button>
              )}
            </div>

            <div>
              <input
                data-testid="lab-command-input"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                placeholder="command text"
              />
              <button
                data-testid="lab-command-submit"
                onClick={handleSubmitCommand}
              >
                Submit command
              </button>
              <ul data-testid="lab-command-receipts">
                {receipts.map((receipt) => (
                  <li key={receipt.command_id}>
                    {receipt.command_id} → run {receipt.run_id} (seq{' '}
                    {receipt.accepted_sequence})
                  </li>
                ))}
              </ul>
            </div>

            <div data-testid="lab-approvals">
              <h3 className="font-semibold">Pending approvals</h3>
              <ul>
                {Object.values(projectState?.pendingApprovals ?? {}).map(
                  (approval) => (
                    <li key={approval.approvalId}>
                      {approval.approvalId}
                      {approval.toolName ? ` (${approval.toolName})` : ''}
                      {approval.reason ? `: ${approval.reason}` : ''}
                      <button
                        data-testid={`lab-approval-allow-${approval.approvalId}`}
                        onClick={() =>
                          handleApproval(approval.approvalId, 'allow')
                        }
                      >
                        Allow
                      </button>
                      <button
                        data-testid={`lab-approval-deny-${approval.approvalId}`}
                        onClick={() =>
                          handleApproval(approval.approvalId, 'deny')
                        }
                      >
                        Deny
                      </button>
                    </li>
                  )
                )}
              </ul>
            </div>

            <div data-testid="lab-artifacts">
              <h3 className="font-semibold">Artifacts</h3>
              <ul>
                {Object.keys(projectState?.artifacts ?? {}).map((artifactId) => (
                  <li key={artifactId}>
                    {artifactId}
                    <button
                      data-testid={`lab-artifact-url-${artifactId}`}
                      onClick={() => handleArtifactUrl(artifactId)}
                    >
                      Get URL
                    </button>
                    {artifactUrls[artifactId] && (
                      <a
                        data-testid={`lab-artifact-link-${artifactId}`}
                        href={artifactUrls[artifactId]}
                      >
                        download
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div data-testid="lab-timeline">
              <h3 className="font-semibold">Timeline</h3>
              <ol>
                {projectState?.timeline.map((entry) => (
                  <li
                    key={`${entry.sequence}-${entry.type}`}
                    data-testid="lab-timeline-entry"
                  >
                    [{entry.sequence}] {entry.type}
                    {entry.type === 'text' ? `: ${entry.text}` : ''}
                    {entry.type === 'tool'
                      ? `: ${entry.toolName}${entry.result ? (entry.result.isError ? ' (error)' : ' (done)') : ' (running)'}`
                      : ''}
                    {entry.type === 'run_boundary'
                      ? `: ${entry.kind}${entry.detail ? ` — ${entry.detail}` : ''}`
                      : ''}
                    {entry.type === 'opaque' ? `: ${entry.kind}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
        {actionError && (
          <div data-testid="lab-action-error">error: {actionError}</div>
        )}
      </section>

      <section className="space-y-1">
        <h2 className="font-semibold">Evidence</h2>
        <button data-testid="lab-export" onClick={handleExport}>
          Export sanitized evidence
        </button>
        {evidenceJson && (
          <pre data-testid="lab-evidence-json" className="overflow-x-auto">
            {evidenceJson}
          </pre>
        )}
      </section>
    </div>
  );
}
