// M6 train-1 preview (doc 10 §12): the product chat UI backed by the aion
// edge instead of the legacy local brain. One aion Project per Eigent project
// carries the whole conversation; each Eigent task (one chat turn) submits
// exactly one command and renders exactly its own Run — correlated by the
// CommandReceipt's run_id, never guessed. UI state is a pure projection of
// the reducer state the M4 goldens pin, written only through the chat
// store's public setters, so legacy mode stays byte-identical.

import type {
  ProjectUIState,
  TimelineEntry,
} from '@/api/aion/v1/reducer';
import {
  IncompatibleBackendError,
  negotiateCompatibility,
} from '@/api/aion/v1/compat';
import { ProjectSession, newCommandId } from '@/api/aion/v1/session';
import { EdgeTransport, type ModelAliasCatalog } from '@/api/aion/v1/transport';
import { useAionModelStore } from './aionModelStore';
import {
  AgentMessageStatus,
  AgentStatusValue,
  AgentStep,
  ChatTaskStatus,
  TaskStatus,
} from '@/types/constants';
import type { ChatStore } from './chatStore';

type ChatStoreHandle = { getState: () => ChatStore };

export type AionRemoteConfig =
  | { edgeBaseUrl: string; apiKey: string }
  | { error: string };

interface TurnBinding {
  taskId: string;
  runId: string;
  /** Receipt epoch; superseded by the run's live epoch after recovery. */
  runEpoch: string;
  question: string;
  chatStore: ChatStoreHandle;
  sawRun: boolean;
  settled: boolean;
}

interface ProjectBinding {
  transport: EdgeTransport;
  session: ProjectSession;
  aionProjectId: string;
  latest: ProjectUIState | null;
  turns: TurnBinding[];
}

// Mode is decided once per renderer lifetime, mirroring the main process
// (which resolves it once at startup and never falls back).
let configPromise: Promise<AionRemoteConfig | null> | null = null;

/**
 * null → local mode (legacy brain). {error} → remote mode misconfigured:
 * the task must fail visibly, never fall back to spawning the local brain.
 */
export function getAionRemoteConfig(): Promise<AionRemoteConfig | null> {
  configPromise ??= (async () => {
    const api = (globalThis as Record<string, any>).electronAPI;
    const resolved = await api?.getAionTransportConfig?.();
    if (!resolved || resolved.mode !== 'remote') {
      return null;
    }
    if (typeof resolved.error === 'string') {
      return { error: resolved.error };
    }
    return {
      edgeBaseUrl: resolved.edgeBaseUrl as string,
      apiKey: resolved.apiKey as string,
    };
  })();
  return configPromise;
}

// Alias catalog for the product model picker; promise-cached like the config
// (the catalog is static per stack profile). Resolves null in local mode; a
// fetch failure clears the cache so the next open retries.
let catalogPromise: Promise<ModelAliasCatalog | null> | null = null;

export function getAionModelCatalog(): Promise<ModelAliasCatalog | null> {
  catalogPromise ??= (async () => {
    const config = await getAionRemoteConfig();
    if (!config || 'error' in config) {
      return null;
    }
    const transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
    return transport.listModelAliases();
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

/**
 * The alias a new conversation would bind, given the catalog: project pin →
 * global selection → the experience-track fallback chain. Selections that
 * fell out of the catalog — or point at an internal fixture alias the picker
 * no longer offers — are ignored rather than failing the turn. The fallback
 * chain may still land on an internal alias (fixture-only CI stacks have no
 * user-facing rows), which keeps automated flows working keyless.
 */
export function resolveModelAlias(
  catalog: ModelAliasCatalog,
  eigentProjectId?: string
): string | null {
  const aliases = catalog.aliases ?? [];
  const selectable = new Set(
    aliases.filter((a) => !a.internal).map((a) => a.alias)
  );
  const { projectAlias, selectedAlias } = useAionModelStore.getState();
  const pinned = eigentProjectId ? projectAlias[eigentProjectId] : undefined;
  if (pinned && selectable.has(pinned)) return pinned;
  if (selectedAlias && selectable.has(selectedAlias)) return selectedAlias;
  const fallback =
    aliases.find((a) => a.alias === 'kimi-k3') ??
    aliases.find((a) => a.is_default) ??
    aliases[0];
  return fallback?.alias ?? null;
}

// One aion Project per Eigent project; promise-cached so concurrent turns
// share a single createProject.
const bindings = new Map<string, Promise<ProjectBinding>>();
const liveBindings: ProjectBinding[] = [];

function ensureBinding(
  config: { edgeBaseUrl: string; apiKey: string },
  eigentProjectId: string,
  firstQuestion: string
): Promise<ProjectBinding> {
  let pending = bindings.get(eigentProjectId);
  if (!pending) {
    pending = createBinding(config, eigentProjectId, firstQuestion).catch((error) => {
      // A failed create must not poison the project forever — the next turn
      // retries with a fresh createProject (its own idempotency key).
      bindings.delete(eigentProjectId);
      throw error;
    });
    bindings.set(eigentProjectId, pending);
  }
  return pending;
}

async function createBinding(
  config: { edgeBaseUrl: string; apiKey: string },
  eigentProjectId: string,
  firstQuestion: string
): Promise<ProjectBinding> {
  const transport = new EdgeTransport({
    baseUrl: config.edgeBaseUrl,
    apiKey: config.apiKey,
  });
  // Version negotiation precedes any project traffic: an incompatible
  // backend fails the turn visibly instead of degrading mid-stream.
  const verdict = negotiateCompatibility(
    await transport.getIntegrationStatus()
  );
  if (!verdict.compatible) {
    throw new IncompatibleBackendError(verdict.reason);
  }
  const alias = await pickModelAlias(transport, eigentProjectId);
  const title = firstQuestion.trim().slice(0, 120) || 'Eigent conversation';
  const project = await transport.createProject({
    title,
    model_alias: alias,
  });
  const binding: ProjectBinding = {
    transport,
    session: null as unknown as ProjectSession,
    aionProjectId: project.project_id,
    latest: null,
    turns: [],
  };
  binding.session = new ProjectSession({
    transport,
    projectId: project.project_id,
    onState: (state) => {
      binding.latest = state;
      for (const turn of binding.turns) {
        projectTurn(binding, turn, state);
      }
    },
    onStatus: (status) => {
      if (status === 'failed') {
        failLiveTurns(
          binding,
          'Lost the connection to the aion edge and exhausted reconnect attempts. The run may still be executing server-side; reopen the conversation to reattach.'
        );
      }
    },
  });
  void binding.session.start();
  liveBindings.push(binding);
  return binding;
}

async function pickModelAlias(
  transport: EdgeTransport,
  eigentProjectId: string
): Promise<string> {
  const catalog = await transport.listModelAliases();
  const alias = resolveModelAlias(catalog, eigentProjectId);
  if (!alias) {
    throw new Error('The aion edge reports no model aliases.');
  }
  return alias;
}

export interface StartAionTaskArgs {
  chatStore: ChatStoreHandle;
  taskId: string;
  eigentProjectId: string;
  question: string;
}

/**
 * Submits one command for this task and binds the receipt's Run to the task
 * pane. Resolves once the command is admitted; rendering then follows the
 * event stream. Throws on admission failure — the caller owns the error UX.
 */
export async function startAionTask(args: StartAionTaskArgs): Promise<void> {
  const question = args.question.trim();
  if (!question) {
    throw new Error('Cannot start an empty task.');
  }
  const config = await getAionRemoteConfig();
  if (!config || 'error' in config) {
    throw new Error(
      'error' in (config ?? {})
        ? (config as { error: string }).error
        : 'aion remote mode is not configured.'
    );
  }
  const binding = await ensureBinding(config, args.eigentProjectId, question);
  const receipt = await binding.session.submitCommand({
    command_id: newCommandId(),
    text: question,
  });
  const turn: TurnBinding = {
    taskId: args.taskId,
    runId: receipt.run_id,
    runEpoch: receipt.run_epoch,
    question,
    chatStore: args.chatStore,
    sawRun: false,
    settled: false,
  };
  binding.turns.push(turn);
  args.chatStore.getState().setSummaryTask(args.taskId, question);
  if (binding.latest) {
    projectTurn(binding, turn, binding.latest);
  }
}

/** Epoch-fenced cancel for the unsettled Run bound to this task, if any. */
export function stopAionTurn(taskId: string): void {
  for (const binding of liveBindings) {
    const turn = binding.turns.find((t) => t.taskId === taskId && !t.settled);
    if (!turn) continue;
    const epoch =
      binding.latest?.runs[turn.runId]?.runEpoch ?? turn.runEpoch;
    void binding.transport
      .cancelRun(binding.aionProjectId, turn.runId, {
        expected_run_epoch: epoch,
      })
      .catch(() => {
        // The run_cancelled / run_failed event is the truth the UI follows;
        // a lost cancel request changes nothing the stream won't correct.
      });
  }
}

function failLiveTurns(binding: ProjectBinding, message: string): void {
  for (const turn of binding.turns) {
    if (turn.settled) continue;
    turn.settled = true;
    const store = turn.chatStore.getState();
    if (!store.tasks[turn.taskId]) continue;
    store.addMessages(turn.taskId, {
      id: `aion:${turn.runId}:transport-failed`,
      role: 'agent',
      content: `❌ ${message}`,
    });
    store.setIsPending(turn.taskId, false);
    store.setStatus(turn.taskId, ChatTaskStatus.FINISHED);
  }
}

const RUN_TERMINAL: Record<string, true> = {
  succeeded: true,
  failed: true,
  cancelled: true,
};

// Presigned screenshot URLs resolve asynchronously against the edge; caching
// per artifact keeps the projection itself sync and idempotent. A resolved
// fetch re-projects so the image appears without waiting for the next event.
const artifactUrlCache = new Map<string, string>();
const artifactUrlPending = new Set<string>();

function resolveArtifactUrl(
  binding: ProjectBinding,
  turn: TurnBinding,
  artifactId: string
): string | undefined {
  const cached = artifactUrlCache.get(artifactId);
  if (cached !== undefined) return cached;
  if (!artifactUrlPending.has(artifactId)) {
    artifactUrlPending.add(artifactId);
    void binding.transport
      .getArtifact(binding.aionProjectId, artifactId)
      .then((access) => {
        artifactUrlCache.set(artifactId, access.download_url);
      })
      .catch(() => {
        // Not (yet) downloadable — the next state change retries.
      })
      .finally(() => {
        artifactUrlPending.delete(artifactId);
        if (binding.latest) projectTurn(binding, turn, binding.latest);
      });
  }
  return undefined;
}

/**
 * Projects one Run's slice of the reducer state into its task pane. Pure
 * function of (turn, state) applied idempotently — replay, reconnect, and
 * overlapping windows all land on the same UI, exactly like the reducer.
 */
function projectTurn(
  binding: ProjectBinding,
  turn: TurnBinding,
  state: ProjectUIState
): void {
  const store = turn.chatStore.getState();
  const task = store.tasks[turn.taskId];
  if (!task) return; // pane was closed
  const run = state.runs[turn.runId];
  const entries = state.timeline.filter((e) => e.runId === turn.runId);
  if (!turn.sawRun && (run || entries.length > 0)) {
    turn.sawRun = true;
    store.setIsPending(turn.taskId, false);
    store.setStatus(turn.taskId, ChatTaskStatus.RUNNING);
  }
  const settled = run !== undefined && RUN_TERMINAL[run.status] === true;

  // --- chat pane: streamed text, pending approvals, run outcome ---
  const wanted: Message[] = [];
  let textOrdinal = 0;
  let lastTextIndex = -1;
  for (const entry of entries) {
    if (entry.type === 'text') {
      lastTextIndex = wanted.length;
      wanted.push({
        id: `aion:${turn.runId}:text:${textOrdinal++}`,
        role: 'agent',
        content: entry.text,
      });
    } else if (entry.type === 'approval' && entry.decision === undefined) {
      wanted.push({
        id: `aion:${turn.runId}:approval:${entry.approvalId}`,
        role: 'agent',
        content: `⏸️ Approval required for \`${entry.toolName ?? 'a tool'}\`${
          entry.reason ? ` — ${entry.reason}` : ''
        }. Respond from the Integration Lab; in-chat approvals arrive with the M6 approvals train.`,
      });
    }
  }
  if (settled) {
    if (run.status === 'succeeded') {
      if (lastTextIndex >= 0) {
        wanted[lastTextIndex] = {
          ...wanted[lastTextIndex],
          step: AgentStep.END,
        };
      } else {
        wanted.push({
          id: `aion:${turn.runId}:outcome`,
          role: 'agent',
          content: run.outcomeDetail || 'Task completed.',
          step: AgentStep.END,
        });
      }
    } else {
      const label = run.status === 'cancelled' ? '⏹️ Run cancelled' : '❌ Run failed';
      const detail = run.outcomeDetail || run.outcomeReason;
      wanted.push({
        id: `aion:${turn.runId}:outcome`,
        role: 'agent',
        content: detail ? `${label}: ${detail}` : `${label}.`,
      });
    }
  }
  const wantedIds = new Set(wanted.map((m) => m.id));
  for (const message of task.messages) {
    // Approval prompts retract once resolved; everything else only grows.
    if (
      message.id.startsWith(`aion:${turn.runId}:approval:`) &&
      !wantedIds.has(message.id)
    ) {
      store.removeMessage(turn.taskId, message.id);
    }
  }
  for (const message of wanted) {
    const existing = task.messages.find((m) => m.id === message.id);
    if (!existing) {
      store.addMessages(turn.taskId, message);
    } else if (
      existing.content !== message.content ||
      existing.step !== message.step
    ) {
      store.updateMessage(turn.taskId, message.id, {
        ...existing,
        ...message,
      });
    }
  }

  // --- workspace: the single aion agent, its tool log, and the terminal ---
  const toolEntries = entries.filter(
    (e): e is Extract<TimelineEntry, { type: 'tool' }> => e.type === 'tool'
  );
  const toolkits = toolEntries.map((tool) => ({
    toolkitName: tool.toolName,
    toolkitMethods: '',
    message: previewToolArgs(tool.argumentsJson),
    toolkitStatus: tool.result
      ? tool.result.isError
        ? AgentStatusValue.FAILED
        : AgentStatusValue.COMPLETED
      : AgentStatusValue.RUNNING,
  }));
  const terminal = toolEntries
    .filter((tool) => tool.toolName === 'bash' && tool.result)
    .map((tool) => {
      const command = bashCommand(tool.argumentsJson);
      const output = tool.result?.content ?? '';
      return command ? `$ ${command}\n${output}` : output;
    });
  const taskInfo: TaskInfo = {
    id: turn.runId,
    content: turn.question,
    status: settled
      ? run.status === 'succeeded'
        ? TaskStatus.COMPLETED
        : TaskStatus.FAILED
      : TaskStatus.RUNNING,
    toolkits,
    terminal,
  };
  const agentLog: AgentMessage[] = toolEntries.map((tool) => ({
    step: AgentStep.ACTIVATE_TOOLKIT,
    data: {
      agent_name: 'single_agent',
      toolkit_name: tool.toolName,
      method_name: '',
      message: previewToolArgs(tool.argumentsJson),
      process_task_id: turn.runId,
    },
    status: tool.result
      ? AgentMessageStatus.COMPLETED
      : AgentMessageStatus.RUNNING,
  }));
  const agent: Agent = {
    agent_id: `${turn.taskId}-single-agent`,
    name: 'Aion Agent',
    type: 'single_agent',
    status: settled ? AgentStatusValue.COMPLETED : AgentStatusValue.RUNNING,
    tasks: [taskInfo],
    log: agentLog,
  };
  const agents: Agent[] = [agent];

  // --- browser mirror: aion browser_* tools drive a headless browser inside
  // the sandbox pod, so there is no local WebContentsView to attach. The
  // product surface is the run's own evidence — the current page URL from the
  // tool stream and the latest screenshot artifact as the view image —
  // projected as the browser_agent card the workspace already renders.
  const browserEntries = toolEntries.filter((tool) =>
    tool.toolName.startsWith('browser_')
  );
  if (browserEntries.length > 0) {
    let pageUrl = '';
    for (const tool of browserEntries) {
      const fromResult =
        tool.result && !tool.result.isError
          ? browserResultUrl(tool.result.content)
          : null;
      pageUrl = fromResult ?? browserArgUrl(tool.argumentsJson) ?? pageUrl;
    }
    const shots = entries.filter(
      (e): e is Extract<TimelineEntry, { type: 'artifact' }> =>
        e.type === 'artifact' &&
        typeof e.artifact.media_type === 'string' &&
        (e.artifact.media_type as string).startsWith('image/')
    );
    const lastShot = shots[shots.length - 1];
    const img =
      lastShot && typeof lastShot.artifact.artifact_id === 'string'
        ? (resolveArtifactUrl(
            binding,
            turn,
            lastShot.artifact.artifact_id as string
          ) ?? '')
        : '';
    const browsing = browserEntries.some((tool) => !tool.result);
    agents.push({
      agent_id: `${turn.taskId}-browser-agent`,
      name: 'Browser',
      type: 'browser_agent',
      status:
        browsing && !settled
          ? AgentStatusValue.RUNNING
          : AgentStatusValue.COMPLETED,
      tasks: [],
      // Browser tool activity already rides the single agent's log; the card
      // exists for the page mirror.
      log: [],
      activeWebviewIds: [
        {
          id: `aion:${turn.runId}:browser`,
          url: pageUrl,
          processTaskId: turn.runId,
          img,
        },
      ],
    });
  }
  store.setTaskAssigning(turn.taskId, agents);
  store.setTaskRunning(turn.taskId, [taskInfo]);

  if (settled && !turn.settled) {
    turn.settled = true;
    store.setProgressValue(turn.taskId, 100);
    store.setIsPending(turn.taskId, false);
    store.setStatus(turn.taskId, ChatTaskStatus.FINISHED);
  }
}

function previewToolArgs(argumentsJson: string): string {
  return argumentsJson.length > 400
    ? `${argumentsJson.slice(0, 400)}…`
    : argumentsJson;
}

function bashCommand(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    return typeof parsed?.command === 'string' ? parsed.command : null;
  } catch {
    return null;
  }
}

/** The `url: …` line every aion browser tool result carries. */
function browserResultUrl(content: string): string | null {
  for (const line of content.split('\n')) {
    if (line.startsWith('url: ')) {
      return line.slice(5).trim() || null;
    }
  }
  return null;
}

function browserArgUrl(argumentsJson: string): string | null {
  try {
    const parsed = JSON.parse(argumentsJson);
    return typeof parsed?.url === 'string' ? parsed.url : null;
  } catch {
    return null;
  }
}
