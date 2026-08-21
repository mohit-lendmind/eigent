// M6 train-1 preview (doc 10 §12): the product chat UI backed by the aion
// edge instead of the legacy local brain. One aion Project per Eternyl project
// carries the whole conversation; each Eternyl task (one chat turn) submits
// exactly one command and renders exactly its own Run — correlated by the
// CommandReceipt's run_id, never guessed. UI state is a pure projection of
// the reducer state the M4 goldens pin, written only through the chat
// store's public setters, so legacy mode stays byte-identical.

import type {
  BrowserFrame,
  ProjectUIState,
  RunConsumption,
  RunRecoveryState,
  RunState,
  RunUIStatus,
  TimelineEntry,
  WorkerState,
  WorkerUIStatus,
} from '@/api/aion/v1/reducer';
import {
  BROWSER_FRAME_ARTIFACT_PREFIX,
  workersForRun,
} from '@/api/aion/v1/reducer';
import {
  IncompatibleBackendError,
  negotiateCompatibility,
  supportsAttachments,
  supportsLocalBrowser,
} from '@/api/aion/v1/compat';
import { ProjectSession, newCommandId } from '@/api/aion/v1/session';
import { EdgeTransport, type ModelAliasCatalog } from '@/api/aion/v1/transport';
import { latestArtifactIdByName } from '@/components/Session/SidePanelSections/buildPlanRows';
import { useAionModelStore } from './aionModelStore';
import { noteAionArtifactsChanged } from './aionArtifactsStore';
import { noteAionCommentsChanged } from './aionCommentsStore';
import { fileProjectUnderBoundSpace } from './aionSpaceBinding';
import { browserDelegationExecutor } from './browserDelegationExecutor';
import {
  browserSubmitFields,
  useAionLocalBrowserStore,
} from './aionLocalBrowserStore';
import {
  AgentMessageStatus,
  AgentStatusValue,
  AgentStep,
  ChatTaskStatus,
  TaskStatus,
  type AgentStatusType,
} from '@/types/constants';
import type { ChatStore } from './chatStore';
import { useSpaceStore } from './spaceStore';

type ChatStoreHandle = { getState: () => ChatStore };

/**
 * The Space the renderer had open for this conversation. Falls back to the
 * active Space for a Project whose metadata has not landed yet, which is the
 * common case: the first turn creates the Project and its metadata together.
 */
function localSpaceIdForProject(eigentProjectId: string): string | null {
  const spaces = useSpaceStore.getState();
  return spaces.getProjectMeta(eigentProjectId)?.spaceId ?? spaces.activeSpaceId;
}

export type AionRemoteConfig =
  | { edgeBaseUrl: string; apiKey: string }
  | { error: string };

/** Where the API key in force came from, and so whether this app may change it. */
export type AionKeySource = 'env' | 'file';

/**
 * The backend's state for this renderer lifetime, with `needs-key` kept apart
 * from `error`: the endpoint is configured and simply has no credential yet,
 * which onboarding can fix, while an error is something the user cannot.
 */
export type AionBackendState =
  | { kind: 'local' }
  | {
      kind: 'ready';
      edgeBaseUrl: string;
      apiKey: string;
      keySource: AionKeySource;
    }
  | { kind: 'needs-key'; edgeBaseUrl: string }
  | { kind: 'error'; message: string };

interface TurnBinding {
  taskId: string;
  runId: string;
  /** Receipt epoch; superseded by the run's live epoch after recovery. */
  runEpoch: string;
  question: string;
  chatStore: ChatStoreHandle;
  sawRun: boolean;
  settled: boolean;
  /**
   * JSON digest of the last workspace projection written to the store. Most
   * events change only one turn's slice; skipping the byte-identical rewrites
   * keeps the other panes' subscribers quiet.
   */
  projectionDigest?: string;
  /**
   * JSON digest of the last plan projection (todos + evidence join). Its own
   * digest, outside `projectionDigest`, because the plan folds many events
   * into slow-moving state and shares no bytes with agents/taskInfo.
   */
  planDigest?: string;
}

interface ProjectBinding {
  transport: EdgeTransport;
  session: ProjectSession;
  aionProjectId: string;
  latest: ProjectUIState | null;
  turns: TurnBinding[];
  /**
   * How many non-frame artifacts the Project had last time its state moved.
   * A growth here is the signal the artifact panel re-reads its listing on —
   * the desktop already consumes artifact_created, so it learns a Project
   * published something without polling for it.
   */
  documentCount: number;
  /**
   * How many artifact_comment events the Project had applied last time its
   * state moved. A count change (creation, dismissal, settlement — every
   * comment mutation is one event) wakes the comment rail the same way
   * documentCount wakes the artifact panel.
   */
  commentEventCount: number;
}

// Mode is decided once per renderer lifetime, mirroring the main process
// (which resolves it once at startup and never falls back). Onboarding is the
// one thing that legitimately changes it mid-lifetime, and it says so by
// calling resetAionBackendState.
let statePromise: Promise<AionBackendState> | null = null;

function hostAPI(): Record<string, any> | undefined {
  return (globalThis as Record<string, any>).electronAPI;
}

/** The full backend state, including the not-yet-credentialed case. */
export function getAionBackendState(): Promise<AionBackendState> {
  statePromise ??= (async () => {
    const resolved = await hostAPI()?.getAionTransportConfig?.();
    if (!resolved || resolved.mode !== 'remote') {
      return { kind: 'local' } as const;
    }
    if (typeof resolved.error === 'string') {
      return { kind: 'error', message: resolved.error } as const;
    }
    if (resolved.needsKey === true) {
      return {
        kind: 'needs-key',
        edgeBaseUrl: resolved.edgeBaseUrl as string,
      } as const;
    }
    return {
      kind: 'ready',
      edgeBaseUrl: resolved.edgeBaseUrl as string,
      apiKey: resolved.apiKey as string,
      keySource: (resolved.keySource as AionKeySource) ?? 'env',
    } as const;
  })();
  return statePromise;
}

let configPromise: Promise<AionRemoteConfig | null> | null = null;

/**
 * null → local mode (legacy brain). {error} → remote mode without a usable
 * transport: the task must fail visibly, never fall back to spawning the local
 * brain. A backend still awaiting its API key is an error HERE by design —
 * there is nothing to call with — and onboarding reads getAionBackendState
 * instead, which is the only place the two are worth telling apart.
 */
export function getAionRemoteConfig(): Promise<AionRemoteConfig | null> {
  configPromise ??= (async () => {
    const state = await getAionBackendState();
    switch (state.kind) {
      case 'local':
        return null;
      case 'ready':
        return { edgeBaseUrl: state.edgeBaseUrl, apiKey: state.apiKey };
      case 'needs-key':
        return { error: 'No API key is configured for this backend yet.' };
      case 'error':
        return { error: state.message };
    }
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
 * Drops everything derived from the backend's credential so the next read
 * re-asks the main process. Onboarding calls this after storing or clearing a
 * key; without it the only way to pick up a new credential is a restart.
 */
export function resetAionBackendState(): void {
  statePromise = null;
  configPromise = null;
  catalogPromise = null;
  // The local-browser answer is about a build/backend PAIRING, so a new
  // credential can change it. Leaving it behind is how a user who onboarded
  // mid-lifetime kept a pre-key "unsupported" until the next launch.
  localBrowserProbe = null;
}

/**
 * The alias a new conversation would bind, given the catalog: project pin →
 * global selection → the operator's default → the first offered row.
 * Selections that fell out of the catalog — or point at an internal fixture
 * alias the picker no longer offers — are ignored rather than failing the turn.
 */
export function resolveModelAlias(
  catalog: ModelAliasCatalog,
  eigentProjectId?: string
): string | null {
  const aliases = catalog.aliases ?? [];
  const offered = aliases.filter((a) => !a.internal);
  const selectable = new Set(offered.map((a) => a.alias));
  const { projectAlias, selectedAlias } = useAionModelStore.getState();
  const pinned = eigentProjectId ? projectAlias[eigentProjectId] : undefined;
  if (pinned && selectable.has(pinned)) return pinned;
  if (selectedAlias && selectable.has(selectedAlias)) return selectedAlias;
  // The operator's own default outranks every other candidate: naming a vendor
  // alias here would let this build override the catalog it is reading. Beyond
  // that, catalog order decides, so a stack with no default resolves the same
  // way on every launch. Falling back only within the OFFERED rows keeps the
  // submitted alias one the picker would also show.
  const fallback =
    offered.find((a) => a.is_default) ??
    offered[0] ??
    // An internal-only catalog is a fixture/CI stack: it offers the picker
    // nothing, so an internal alias is the only way a keyless flow can run.
    aliases.find((a) => a.is_default) ??
    aliases[0];
  return fallback?.alias ?? null;
}

// One aion Project per Eternyl project; promise-cached so concurrent turns
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
  const title = firstQuestion.trim().slice(0, 120) || 'Eternyl conversation';
  const project = await transport.createProject({
    title,
    model_alias: alias,
  });
  // A Project is created unfiled — `CreateProjectRequest` carries only a title
  // and an alias — so the Space it belongs to is attached right after, from the
  // Space the user was actually in when they asked.
  fileProjectUnderBoundSpace(
    localSpaceIdForProject(eigentProjectId),
    project.project_id
  );
  const binding: ProjectBinding = {
    transport,
    session: null as unknown as ProjectSession,
    aionProjectId: project.project_id,
    latest: null,
    turns: [],
    documentCount: 0,
    commentEventCount: 0,
  };
  binding.session = new ProjectSession({
    transport,
    projectId: project.project_id,
    onState: (state) => {
      binding.latest = state;
      // Viewfinder frames are artifacts too, and a browsing run produces one
      // per action — counting them would wake the panel for pictures it does
      // not list.
      const documents =
        Object.keys(state.artifacts).length - state.browserFrames.length;
      if (documents > binding.documentCount) {
        binding.documentCount = documents;
        noteAionArtifactsChanged(binding.aionProjectId);
      }
      if (state.commentEvents !== binding.commentEventCount) {
        binding.commentEventCount = state.commentEvents;
        noteAionCommentsChanged(binding.aionProjectId);
      }
      // A settled turn's projection is final — its run can produce no further
      // events — so only live turns re-project. (Reopening a conversation
      // projects settled turns once, explicitly, from `binding.latest`.)
      for (const turn of binding.turns) {
        if (turn.settled) continue;
        projectTurn(binding, turn, state);
      }
      browserDelegationExecutor.notePending(
        binding.aionProjectId,
        binding.transport,
        state.pendingBrowserDelegations
      );
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

/**
 * The aion Project bound to an Eternyl project, or null when this renderer
 * has not opened one. Deliberately a lookup and never a create: a surface
 * that merely wants to list what a project produced must not mint a Project
 * as a side effect of being opened.
 */
export async function boundAionProjectId(
  eigentProjectId: string
): Promise<string | null> {
  const pending = bindings.get(eigentProjectId);
  if (!pending) return null;
  try {
    return (await pending).aionProjectId;
  } catch {
    return null;
  }
}

// Promise-cached: the answer is a fact about this build + backend pairing, so
// the toggle's mount and every submit share one /status read.
let localBrowserProbe: Promise<boolean> | null = null;

/**
 * Whether this desktop can execute a run's browser actions locally: the build
 * must carry the agent-browser executor AND the edge must serve the delegation
 * contract (1.22 floor). False hides the composer toggle and strips the
 * submit fields — the honest rendering of "this cell cannot park a run on
 * your machine" is the affordance not being offered.
 *
 * Only an answer from the contract is cached. Reaching no transport at all —
 * the preload not yet attached, or no usable remote config — resolves to null
 * and drops the cache like a failed handshake does, because caching that as
 * "unsupported" would pin the toggle off for the life of the process over a
 * millisecond of startup. The credential can also change mid-lifetime, which
 * is why resetAionBackendState drops this cache too.
 */
export function probeLocalBrowserSupport(): Promise<boolean> {
  if (!localBrowserProbe) {
    localBrowserProbe = (async (): Promise<boolean | null> => {
      if (typeof hostAPI()?.agentBrowserExecute !== 'function') return null;
      const config = await getAionRemoteConfig();
      if (!config || 'error' in config) return null;
      const transport = new EdgeTransport({
        baseUrl: config.edgeBaseUrl,
        apiKey: config.apiKey,
      });
      return supportsLocalBrowser(await transport.getIntegrationStatus());
    })().then(
      (supported) => {
        if (supported === null) {
          localBrowserProbe = null;
          return false;
        }
        useAionLocalBrowserStore.getState().noteSupport(supported);
        return supported;
      },
      () => {
        // A failed handshake is retryable — drop the cache so the next ask
        // renegotiates instead of pinning "unsupported" forever.
        localBrowserProbe = null;
        return false;
      }
    );
  }
  return localBrowserProbe;
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
  /** Files attached in the composer, as paths only the desktop can read. */
  attaches?: { fileName: string; filePath: string }[];
  /**
   * Artifact comments this turn is asked to address. The worker inlines each
   * one's anchor and body ahead of the text, and the settling run's republish
   * is what marks them addressed.
   */
  commentIds?: string[];
}

// The exact shape the read-file-dataurl IPC produces; anything else means the
// read failed rather than that the file has an exotic type.
function splitDataUrl(
  dataUrl: string
): { mediaType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return match ? { mediaType: match[1], base64: match[2] } : null;
}

/**
 * Publishes each attached file as a Project artifact and returns the ids in
 * composer order. Throws rather than silently dropping a file: the user
 * watched themselves attach it, so a turn that runs without it is a worse
 * outcome than one that fails saying why.
 */
async function uploadAttaches(
  transport: EdgeTransport,
  aionProjectId: string,
  attaches: { fileName: string; filePath: string }[]
): Promise<string[]> {
  const status = await transport.getIntegrationStatus();
  if (!supportsAttachments(status)) {
    throw new Error(
      `This backend (edge API ${status.edge_api_version}) does not accept file attachments. Remove the attached files to run this task.`
    );
  }
  const ids: string[] = [];
  for (const attach of attaches) {
    const dataUrl = await hostAPI()?.readFileAsDataUrl?.(attach.filePath);
    const parts = typeof dataUrl === 'string' ? splitDataUrl(dataUrl) : null;
    if (!parts) {
      throw new Error(`Could not read "${attach.fileName}" from disk.`);
    }
    const artifact = await transport.uploadAttachment(aionProjectId, {
      name: attach.fileName,
      media_type: parts.mediaType,
      data_base64: parts.base64,
    });
    ids.push(artifact.artifact_id);
  }
  return ids;
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
  const attaches = args.attaches ?? [];
  const attachmentIds =
    attaches.length > 0
      ? await uploadAttaches(binding.transport, binding.aionProjectId, attaches)
      : [];
  const commentIds = args.commentIds ?? [];
  // The choice binds to THIS run at admission (immutable after submit);
  // flipping the toggle mid-run affects only the next command.
  const localBrowserState = useAionLocalBrowserStore.getState();
  const browserFields = browserSubmitFields(
    localBrowserState.projectLocalBrowser[args.eigentProjectId],
    localBrowserState.projectSessionMode[args.eigentProjectId],
    await probeLocalBrowserSupport()
  );
  const receipt = await binding.session.submitCommand({
    command_id: newCommandId(),
    text: question,
    ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
    ...(commentIds.length > 0 ? { comment_ids: commentIds } : {}),
    ...browserFields,
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
  const store = args.chatStore.getState();
  store.setSummaryTask(args.taskId, question);
  // Start the elapsed clock at submission: the header timer derives from
  // `taskTime`, which only the legacy plan-confirm path used to set.
  store.setTaskTime(args.taskId, Date.now());
  if (binding.latest) {
    projectTurn(binding, turn, binding.latest);
  }
}

/**
 * Delivers a human verdict for a parked approval over the edge. The backend
 * records it exactly once; the UI never resolves optimistically — the
 * approval_resolved event streaming back is what flips the card.
 */
export async function respondToAionApproval(
  aionProjectId: string,
  approvalId: string,
  decision: 'allow' | 'deny'
): Promise<void> {
  // A card can outlive its binding (renderer restart renders it from
  // persisted history), so fall back to a config-built transport — the
  // approval is parked server-side and needs no live stream to resolve.
  let transport = liveBindings.find(
    (b) => b.aionProjectId === aionProjectId
  )?.transport;
  if (!transport) {
    const config = await getAionRemoteConfig();
    if (!config || 'error' in config) {
      throw new Error('aion remote mode is not configured.');
    }
    transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
  }
  await transport.respondToApproval(aionProjectId, approvalId, { decision });
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

/**
 * Failure reasons the UI states in its own words instead of echoing the wire
 * enum and the backend's message.
 *
 * A run stopped by its spending ceiling is the case that needs this: nothing
 * broke, and — alone among the failures here — trying again cannot help, so
 * the generic "Run failed: <error>" wording would send the user round a loop
 * that reaches the same point. Reason strings are an open set, so anything
 * unnamed keeps the generic wording rather than rendering nothing.
 */
const NAMED_RUN_FAILURES: Record<string, string> = {
  REASON_RUN_BUDGET_EXHAUSTED:
    '⏹️ Run stopped: budget exhausted. This run reached the spending limit set for it — raising that limit is what lets it continue; running it again will stop at the same point.',
};

/** The message shown when a run settles anything other than succeeded. */
export function runTerminalMessage(
  status: RunUIStatus,
  outcomeReason: string | undefined,
  outcomeDetail: string | undefined
): string {
  const named = outcomeReason ? NAMED_RUN_FAILURES[outcomeReason] : undefined;
  if (named) return named;
  const label = status === 'cancelled' ? '⏹️ Run cancelled' : '❌ Run failed';
  const detail = outcomeDetail || outcomeReason;
  return detail ? `${label}: ${detail}` : `${label}.`;
}

function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Micro-USD to a 4-decimal dollar string, in integers so a large figure
 * cannot lose its cents to a float. */
function dollars(microUSD: string): string {
  const tenThousandths = BigInt(microUSD) / 100n;
  const whole = tenThousandths / 10_000n;
  const frac = (tenThousandths % 10_000n).toString().padStart(4, '0');
  return `$${grouped(whole.toString())}.${frac}`;
}

/**
 * What the run consumed, in one line under the outcome. Absent figures are
 * left out rather than shown as zero: a run whose cost was never recorded and
 * a run that genuinely cost nothing are different facts, and only one of them
 * is safe to tell a user.
 *
 * `prompt_tokens` is cache-inclusive, so the breakdown reports the billable
 * input the server already computed alongside the cached read rather than a
 * prompt figure a reader would add to the cache figure and double-count.
 * Returns undefined when the terminal announced nothing at all.
 */
export function runConsumptionMessage(
  consumption: RunConsumption | undefined
): string | undefined {
  if (!consumption) return undefined;
  const parts: string[] = [];
  const { tokens, cost, turnCount } = consumption;
  if (tokens) {
    parts.push(
      `${grouped(tokens.totalTokens)} tokens (${grouped(tokens.billableInputTokens)} billable in · ` +
        `${grouped(tokens.completionTokens)} out · ${grouped(tokens.cacheReadTokens)} cached)`
    );
  }
  if (turnCount !== undefined) {
    parts.push(`${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}`);
  }
  if (cost) {
    // Calls without a price is the alias carrying no price list. Saying
    // "unpriced" keeps that apart from a run that really was free, which is
    // what a bare $0.0000 would claim.
    const calls = `${grouped(cost.providerCalls)} provider ${cost.providerCalls === '1' ? 'call' : 'calls'}`;
    parts.push(
      cost.costMicroUSD === '0'
        ? `${calls}, unpriced`
        : `${dollars(cost.costMicroUSD)} over ${calls}`
    );
  }
  if (parts.length === 0) return undefined;
  return `📊 ${parts.join(' · ')}`;
}

/**
 * The message shown while a run is parked on a recovery label. The blocking
 * distinction carries the whole value of showing it: on one side waiting is the
 * right advice, and on the other waiting is precisely what leaves a stuck run
 * stuck. Both say the composer is closed, because a parked run still holds the
 * Project's active-run slot and the next message would be refused.
 */
export function runRecoveryMessage(recovery: RunRecoveryState): string {
  const cause = recovery.detail ? ` — ${recovery.detail}` : '';
  if (recovery.blocking) {
    return `⚠️ Run stuck: ${recovery.label}${cause}. It will not continue on its own; an operator has to repair or retire the blocked step. Cancel the run to send a new message.`;
  }
  return `⏸️ Run paused: ${recovery.label}${cause}. It is expected to resume on its own — no action needed.`;
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

/**
 * How many of a run's viewfinder frames get a download URL. Every resolve
 * mints a presigned GET — a time-boxed grant against a default-deny bucket —
 * and a browsing run produces one frame per action, so resolving all of them
 * would spend a grant and start a clock for every frame nobody looks at. The
 * card reports the true total beside the window so the tail reads as older
 * frames rather than as frames that were never taken.
 */
const FRAME_WINDOW = 8;

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

/** Name → the artifact id of its newest published version in this run. */
function latestArtifactByName(entries: TimelineEntry[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== 'artifact') continue;
    const card = artifactCardOf(entry.artifact);
    if (card) latest.set(card.name, card.artifactId);
  }
  return latest;
}

/**
 * Narrows a published artifact into the card the chat announces, or `null`
 * when it is not something to announce. The artifact rides the timeline as an
 * untyped row (the reducer banks whatever the event carried), so every field
 * is checked rather than asserted: a row missing its id would render a card
 * whose only affordance opens nothing.
 */
function artifactCardOf(
  artifact: Record<string, unknown>
): NonNullable<Message['artifactCard']> | null {
  const artifactId = artifact.artifact_id;
  const name = artifact.name;
  if (typeof artifactId !== 'string' || typeof name !== 'string') return null;
  if (name.startsWith(BROWSER_FRAME_ARTIFACT_PREFIX)) return null;
  const mediaType =
    typeof artifact.media_type === 'string' ? artifact.media_type : '';
  if (mediaType.startsWith('image/')) return null;
  return {
    artifactId,
    name,
    mediaType,
    // `size_bytes` is a 64-bit count and arrives as a decimal string.
    sizeBytes: Number.parseInt(String(artifact.size_bytes ?? ''), 10) || 0,
    version: typeof artifact.version === 'number' ? artifact.version : 0,
  };
}

/**
 * The chat-pane messages one Run's timeline projects to: streamed text, tool
 * cards interleaved in call order (so say/do reads chronologically), pending
 * approvals, the parked-recovery notice, and the run outcome.
 *
 * Exported for unit tests.
 */
export function buildTurnMessages(
  aionProjectId: string,
  runId: string,
  entries: TimelineEntry[],
  run: RunState | undefined
): Message[] {
  const settled = run !== undefined && RUN_TERMINAL[run.status] === true;
  const latestArtifactIds = latestArtifactByName(entries);
  const wanted: Message[] = [];
  let textOrdinal = 0;
  let lastTextIndex = -1;
  for (const entry of entries) {
    if (entry.type === 'text') {
      lastTextIndex = wanted.length;
      wanted.push({
        id: `aion:${runId}:text:${textOrdinal++}`,
        role: 'agent',
        content: entry.text,
        ...(entry.reasoning ? { reasoning: entry.reasoning } : {}),
      });
    } else if (entry.type === 'tool') {
      // The card owns the whole message; content stays empty so nothing
      // double-renders the call as prose.
      wanted.push({
        id: `aion:${runId}:tool:${entry.toolCallId}`,
        role: 'agent',
        content: '',
        toolCard: {
          toolName: entry.toolName,
          argumentsJson: entry.argumentsJson,
          status: entry.result
            ? entry.result.isError
              ? 'error'
              : 'done'
            : 'running',
          ...(!entry.result && entry.liveOutput
            ? {
                liveOutput: previewLiveOutput(
                  entry.liveOutput,
                  entry.liveOutputTruncated
                ),
              }
            : {}),
          ...(entry.result
            ? { resultContent: previewToolResult(entry.result.content) }
            : {}),
        },
      });
    } else if (entry.type === 'artifact') {
      const card = artifactCardOf(entry.artifact);
      // One card per NAME, at the point its newest version landed. A run that
      // revises a document publishes a version per edit, and announcing each
      // would put a row of near-identical cards in the conversation whose
      // earlier members claim a version that no longer exists.
      if (card && card.artifactId === latestArtifactIds.get(card.name)) {
        wanted.push({
          id: `aion:${runId}:artifact:${card.name}`,
          role: 'agent',
          content: '',
          artifactCard: card,
        });
      }
    } else if (entry.type === 'approval') {
      // Pending renders the interactive card; a resolved entry keeps the
      // same message id with the verdict, so the card flips in place when
      // approval_resolved streams back (the content change triggers the
      // update below).
      wanted.push({
        id: `aion:${runId}:approval:${entry.approvalId}`,
        role: 'agent',
        content: entry.decision
          ? `Approval ${entry.decision} for ${entry.toolName ?? 'a tool'}.`
          : `Approval required for ${entry.toolName ?? 'a tool'}.`,
        approval: {
          projectId: aionProjectId,
          approvalId: entry.approvalId,
          toolName: entry.toolName,
          reason: entry.reason,
          argumentsJson: entry.argumentsJson,
          decision: entry.decision,
        },
      });
    }
  }
  // Parking and settling are mutually exclusive: the next event on the run
  // clears the recovery, and a terminal is such an event.
  if (run?.recovery) {
    wanted.push({
      id: `aion:${runId}:recovery`,
      role: 'agent',
      content: runRecoveryMessage(run.recovery),
    });
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
          id: `aion:${runId}:outcome`,
          role: 'agent',
          content: run.outcomeDetail || 'Task completed.',
          step: AgentStep.END,
        });
      }
    } else {
      wanted.push({
        id: `aion:${runId}:outcome`,
        role: 'agent',
        content: runTerminalMessage(
          run.status,
          run.outcomeReason,
          run.outcomeDetail
        ),
      });
    }
    // After the outcome, never instead of it: a cancelled or failed run
    // consumed what it consumed, and hiding the figure on the runs that end
    // badly hides it exactly where someone is most likely to ask.
    const consumed = runConsumptionMessage(run.consumption);
    if (consumed) {
      wanted.push({
        id: `aion:${runId}:consumption`,
        role: 'agent',
        content: consumed,
      });
    }
  }
  return wanted;
}

function toolCardChanged(
  a: Message['toolCard'],
  b: Message['toolCard']
): boolean {
  if (!a && !b) return false;
  if (!a || !b) return true;
  // toolName/argumentsJson are immutable for a given message id.
  return (
    a.status !== b.status ||
    a.liveOutput !== b.liveOutput ||
    a.resultContent !== b.resultContent
  );
}

/**
 * An artifact card is keyed by NAME, so a later version of the same document
 * arrives as a change to an existing message rather than a new one. Without
 * this the card would keep announcing whichever version happened to publish
 * first — its content, step and tool card never move.
 */
function artifactCardChanged(
  a: Message['artifactCard'],
  b: Message['artifactCard']
): boolean {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return (
    a.artifactId !== b.artifactId ||
    a.version !== b.version ||
    a.sizeBytes !== b.sizeBytes ||
    a.mediaType !== b.mediaType
  );
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

  // --- chat pane: streamed text, tool cards, approvals, run outcome ---
  const wanted = buildTurnMessages(
    binding.aionProjectId,
    turn.runId,
    entries,
    run
  );
  const wantedIds = new Set(wanted.map((m) => m.id));
  for (const message of task.messages) {
    // Approval prompts retract once resolved and the parked notice once the run
    // moves again; everything else only grows.
    const retractable =
      message.id.startsWith(`aion:${turn.runId}:approval:`) ||
      message.id === `aion:${turn.runId}:recovery`;
    if (retractable && !wantedIds.has(message.id)) {
      store.removeMessage(turn.taskId, message.id);
    }
  }
  for (const message of wanted) {
    const existing = task.messages.find((m) => m.id === message.id);
    if (!existing) {
      store.addMessages(turn.taskId, message);
    } else if (
      existing.content !== message.content ||
      existing.step !== message.step ||
      existing.reasoning !== message.reasoning ||
      toolCardChanged(existing.toolCard, message.toolCard) ||
      artifactCardChanged(existing.artifactCard, message.artifactCard)
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
  const agentLog = projectToolLog(turn.runId, toolEntries);
  const agent: Agent = {
    agent_id: `${turn.taskId}-single-agent`,
    name: 'Aion Agent',
    type: 'single_agent',
    status: settled ? AgentStatusValue.COMPLETED : AgentStatusValue.RUNNING,
    tasks: [taskInfo],
    log: agentLog,
  };
  const workers = workersForRun(state, turn.runId);
  const agents: Agent[] = [
    agent,
    ...projectWorkerLanes(turn.taskId, turn.runId, workers),
  ];

  // --- browser mirror: aion browser_* tools drive a headless browser inside
  // the sandbox pod — or, on a delegated run, a visible window on this
  // desktop. Either way the card's evidence is the run's own: the current
  // page URL from the tool stream and the published frames as the view
  // image, projected as the browser_agent card the workspace already
  // renders. Whether the run is delegated is read off the tool rows'
  // delegation markers — the only wire-grounded signal, and one that holds
  // across rehydrate on a device that never submitted the command.
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
    const delegated = browserEntries.filter((tool) => tool.delegation);
    const view = projectBrowserView(
      turn.runId,
      pageUrl,
      entries,
      state.browserFrames.filter((f) => f.runId === turn.runId),
      (artifactId) => resolveArtifactUrl(binding, turn, artifactId),
      delegated.length > 0,
      delegated[delegated.length - 1]?.delegation?.sessionMode ?? ''
    );
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
      activeWebviewIds: [view],
    });
  }
  // The run's dispatch stage (run_progress) feeds the pre-content indicator.
  // It lives outside the agents/taskInfo digest — a stage change alters no
  // timeline entry — and is never cleared here: the indicator's own gate
  // stops rendering it once the run has renderable output.
  const progress = run?.progress;
  if (
    progress?.stage !== task.runStage?.stage ||
    progress?.detail !== task.runStage?.detail
  ) {
    store.setRunStage(
      turn.taskId,
      progress ? { stage: progress.stage, detail: progress.detail } : undefined
    );
  }

  // The Project's plan (todo events) also lives outside the agents/taskInfo
  // digest — the runStage reasoning: a plan change alters no timeline entry.
  // Todos are project-scoped rather than filtered to this turn's run — the
  // plan is one plan, and a follow-up turn that touches no todo still shows
  // it. Absent until the first todo event, so the Plan section stays unmounted
  // on runs that never plan.
  const todos = Object.values(state.todos);
  if (todos.length > 0 || turn.planDigest !== undefined) {
    const artifactIdByName = latestArtifactIdByName(state.artifacts);
    const planDigest = JSON.stringify([todos, artifactIdByName]);
    if (planDigest !== turn.planDigest) {
      turn.planDigest = planDigest;
      store.setPlan(
        turn.taskId,
        todos.length > 0 ? { todos, artifactIdByName } : undefined
      );
    }
  }

  // Events that leave this turn's slice unchanged (another run's events,
  // internal-visibility records) must not wake every subscriber of the task.
  const digest = JSON.stringify([agents, taskInfo]);
  if (digest !== turn.projectionDigest) {
    turn.projectionDigest = digest;
    store.setTaskAssigning(turn.taskId, agents);
    store.setTaskRunning(turn.taskId, [taskInfo]);
  }

  if (settled && !turn.settled) {
    turn.settled = true;
    // Freeze the clock: fold the running window into `elapsed` so the
    // "worked for" label survives the RUNNING → FINISHED transition.
    if (task.taskTime !== 0) {
      store.setElapsed(
        turn.taskId,
        task.elapsed + (Date.now() - task.taskTime)
      );
      store.setTaskTime(turn.taskId, 0);
    }
    store.setProgressValue(turn.taskId, 100);
    store.setIsPending(turn.taskId, false);
    store.setStatus(turn.taskId, ChatTaskStatus.FINISHED);
  }
}

/**
 * The browser card's view: which picture of the page to show, and the recent
 * frames behind it.
 *
 * `resolveUrl` is the caller's presigned-GET resolver, which answers undefined
 * until a URL is minted — so a frame this returns is one that can actually be
 * rendered, and the count says how many exist regardless.
 *
 * Exported for unit tests.
 */
export function projectBrowserView(
  runId: string,
  pageUrl: string,
  entries: TimelineEntry[],
  frames: BrowserFrame[],
  resolveUrl: (artifactId: string) => string | undefined,
  local = false,
  sessionMode = ''
): ActiveWebView {
  const resolved = frames
    .slice(-FRAME_WINDOW)
    .map((f) => resolveUrl(f.artifactId))
    .filter((url): url is string => url !== undefined);
  let img = resolved[resolved.length - 1] ?? '';
  if (frames.length === 0) {
    // A pod running a browserctl from before frames existed publishes only the
    // screenshots the model asked for. Any image the agent wrote qualifies, so
    // this is the wrong picture as often as the right one — but a stale mirror
    // beats a blank card, and it costs nothing once that pod rolls forward.
    const shots = entries.filter(
      (e): e is Extract<TimelineEntry, { type: 'artifact' }> =>
        e.type === 'artifact' &&
        typeof e.artifact.media_type === 'string' &&
        (e.artifact.media_type as string).startsWith('image/')
    );
    const lastShot = shots[shots.length - 1];
    img =
      lastShot && typeof lastShot.artifact.artifact_id === 'string'
        ? (resolveUrl(lastShot.artifact.artifact_id as string) ?? '')
        : '';
  }
  return {
    id: `aion:${runId}:browser`,
    url: pageUrl,
    processTaskId: runId,
    img,
    // A pod run has nothing to hand over — a screenshot is no more
    // attachable than a frame. A delegated run does: the agent's own window
    // on this desktop, reached via the agent-browser bridge, so the card
    // gets the local marker instead.
    remote: !local,
    ...(local ? { local: true, sessionMode } : {}),
    frames: resolved,
    frameCount: frames.length,
  };
}

/**
 * `unknown` has no counterpart in the closed agent-status set. Both readers of
 * this field only ask whether a lane is still working, so it fails closed
 * rather than claiming a success nobody reported — what actually happened is
 * stated in the lane's own log line.
 */
const WORKER_CARD_STATUS: Record<WorkerUIStatus, AgentStatusType> = {
  running: AgentStatusValue.RUNNING,
  succeeded: AgentStatusValue.COMPLETED,
  failed: AgentStatusValue.FAILED,
  unknown: AgentStatusValue.FAILED,
};

/**
 * A run's fan-out as one workspace card per worker. Only the ORCHESTRATOR's
 * tool calls project onto a Project, so a lane honestly carries identity,
 * status and how it ended — never a tool log of its own.
 *
 * Exported for unit tests.
 */
export function projectWorkerLanes(
  taskId: string,
  runId: string,
  workers: WorkerState[]
): Agent[] {
  return workers.map((worker) => ({
    agent_id: `${taskId}-worker-${worker.workerKey}`,
    name: worker.name || worker.role || 'Worker',
    type: 'worker_agent',
    status: WORKER_CARD_STATUS[worker.status],
    tasks: [],
    log: workerLaneLog(worker, runId),
  }));
}

/**
 * The lane's timeline: it opens when the worker is first observed and closes
 * on the outcome. A worker seen only through its end says so rather than
 * pretending its start was witnessed.
 */
function workerLaneLog(worker: WorkerState, runId: string): AgentMessage[] {
  const log: AgentMessage[] = [
    {
      step: AgentStep.ACTIVATE_AGENT,
      data: {
        agent_name: 'worker_agent',
        message: worker.startedSequence
          ? worker.role
            ? `Joined the run as ${worker.role}.`
            : 'Joined the run.'
          : 'Only the end of this worker was delivered; its start never arrived.',
        process_task_id: runId,
      },
    },
  ];
  if (worker.status === 'running') return log;
  log.push({
    step: AgentStep.NOTICE,
    data: { notice: workerOutcomeLine(worker), process_task_id: runId },
  });
  log.push({
    step: AgentStep.DEACTIVATE_AGENT,
    data: { agent_name: 'worker_agent', process_task_id: runId },
  });
  return log;
}

function workerOutcomeLine(worker: WorkerState): string {
  if (worker.status === 'failed') {
    return `Failed: ${worker.error || 'no detail reported'}.`;
  }
  if (worker.status === 'succeeded') {
    return worker.reason ? `Finished: ${worker.reason}.` : 'Finished.';
  }
  // The run settled without this worker's end. An ephemeral spawn carries no
  // identity for an end to be matched against, which is a different statement
  // from an end that simply never arrived, so the two read differently.
  return worker.childSessionId
    ? 'The run ended before this worker reported an outcome.'
    : 'This worker was not persisted, so no outcome could be matched to it.';
}

/**
 * The single agent's work-log entries for a run's tool calls. Each call
 * activates a row; its result — success or error — closes the row and carries
 * the response the fold renders, so a row can never shimmer past its own
 * settlement.
 *
 * Exported for unit tests.
 */
export function projectToolLog(
  runId: string,
  toolEntries: Extract<TimelineEntry, { type: 'tool' }>[]
): AgentMessage[] {
  return toolEntries.flatMap((tool): AgentMessage[] => {
    const activate: AgentMessage = {
      step: AgentStep.ACTIVATE_TOOLKIT,
      data: {
        agent_name: 'single_agent',
        toolkit_name: tool.toolName,
        method_name: '',
        message: previewToolArgs(tool.argumentsJson),
        arguments_json: tool.argumentsJson,
        process_task_id: runId,
        ...(!tool.result && tool.liveOutput
          ? {
              live_output: previewLiveOutput(
                tool.liveOutput,
                tool.liveOutputTruncated
              ),
            }
          : {}),
      },
      status: tool.result
        ? AgentMessageStatus.COMPLETED
        : AgentMessageStatus.RUNNING,
    };
    if (!tool.result) return [activate];
    return [
      activate,
      {
        step: AgentStep.DEACTIVATE_TOOLKIT,
        data: {
          agent_name: 'single_agent',
          toolkit_name: tool.toolName,
          method_name: '',
          message: previewToolResult(tool.result.content),
          process_task_id: runId,
        },
        status: tool.result.isError
          ? AgentMessageStatus.FAILED
          : AgentMessageStatus.COMPLETED,
      },
    ];
  });
}

function previewToolArgs(argumentsJson: string): string {
  return argumentsJson.length > 400
    ? `${argumentsJson.slice(0, 400)}…`
    : argumentsJson;
}

// A tool result can be up to 256 KiB; the work-log fold only needs enough of
// it to read what happened.
const TOOL_RESULT_PREVIEW_MAX = 4000;

function previewToolResult(content: string): string {
  return content.length > TOOL_RESULT_PREVIEW_MAX
    ? `${content.slice(0, TOOL_RESULT_PREVIEW_MAX)}…`
    : content;
}

// Live output keeps the TAIL, not the head: while a tool is still running the
// newest bytes are the ones that say what it is doing now. `truncated` means
// the backend's own retention cap already dropped earlier bytes.
function previewLiveOutput(output: string, truncated?: boolean): string {
  const clipped = truncated || output.length > TOOL_RESULT_PREVIEW_MAX;
  const tail = output.slice(-TOOL_RESULT_PREVIEW_MAX);
  return clipped ? `…${tail}` : tail;
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
