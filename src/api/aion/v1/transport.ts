// The single desktop transport for the aion edge (doc 10 §10 WP2): every
// renderer interaction with the backend goes through this module — REST
// commands/queries plus the cursor-based SSE event subscription. It speaks
// only the public api/eigent/v1 contract: bearer API key in, RFC 9457
// problems out, never a provider credential, grant, or internal endpoint.
//
// This layer is deliberately policy-free: no retry, no reconnect, no state.
// Reconnect/rehydrate policy composes on top (doc 10 §10 WP2 reconnect), and
// UI state lives solely in the reducer.

import { parseProjectEventJSON, type ProjectEvent } from './contracts';
import {
  EdgeProblemError,
  PROBLEM_CONTENT_TYPE,
  decodeProblem,
  type EdgeProblem,
} from './problems';
import type { components } from './gen/edge-api';

type Schemas = components['schemas'];
export type Project = Schemas['Project'];
export type ProjectSnapshot = Schemas['ProjectSnapshot'];
export type ProjectList = Schemas['ProjectList'];
export type CreateProjectRequest = Schemas['CreateProjectRequest'];
export type SubmitCommandRequest = Schemas['SubmitCommandRequest'];
export type CommandReceipt = Schemas['CommandReceipt'];
export type CancelRunRequest = Schemas['CancelRunRequest'];
export type ApprovalResponse = Schemas['ApprovalResponse'];
export type ModelAliasCatalog = Schemas['ModelAliasCatalog'];
export type IntegrationStatus = Schemas['IntegrationStatus'];
export type Artifact = Schemas['Artifact'];
export type ArtifactList = Schemas['ArtifactList'];
export type ArtifactAccess = Schemas['ArtifactAccess'];
export type AttachmentUpload = Schemas['AttachmentUpload'];
export type UsageSummary = Schemas['UsageSummary'];
export type UsageTotals = Schemas['UsageTotals'];
export type RunSpend = Schemas['RunSpend'];
export type Skill = Schemas['Skill'];
export type SkillCatalog = Schemas['SkillCatalog'];
export type PutSkillRequest = Schemas['PutSkillRequest'];
export type PutSkillResult = Schemas['PutSkillResult'];
export type SetSkillStatusRequest = Schemas['SetSkillStatusRequest'];
export type Connector = Schemas['Connector'];
export type ConnectorCatalog = Schemas['ConnectorCatalog'];
export type ConnectorAuthorization = Schemas['ConnectorAuthorization'];
export type Schedule = Schemas['Schedule'];
export type ScheduleList = Schemas['ScheduleList'];
export type CreateScheduleRequest = Schemas['CreateScheduleRequest'];
export type UpdateScheduleRequest = Schemas['UpdateScheduleRequest'];
export type ScheduleEvent = Schemas['ScheduleEvent'];
export type ScheduleEventList = Schemas['ScheduleEventList'];
export type Account = Schemas['Account'];
export type APIKeyList = Schemas['APIKeyList'];
export type APIKeySummary = Schemas['APIKeySummary'];
export type CreateKeyRequest = Schemas['CreateKeyRequest'];
export type CreatedKey = Schemas['CreatedKey'];
export type MemoryCatalog = Schemas['MemoryCatalog'];
export type MemoryDoc = Schemas['MemoryDoc'];
export type MemoryUsage = Schemas['MemoryUsage'];
export type MemorySearchResult = Schemas['MemorySearchResult'];
export type MemorySearchHit = Schemas['MemorySearchHit'];
export type MemoryWriteRequest = Schemas['MemoryWriteRequest'];
export type MemoryWriteResult = Schemas['MemoryWriteResult'];
export type MemoryCleared = Schemas['MemoryCleared'];
export type Space = Schemas['Space'];
export type SpaceList = Schemas['SpaceList'];
export type CreateSpaceRequest = Schemas['CreateSpaceRequest'];
export type UpdateSpaceRequest = Schemas['UpdateSpaceRequest'];

export interface EdgeTransportConfig {
  /** Base URL of the mounted contract, e.g. `https://edge.example/eigent/v1`. */
  baseUrl: string;
  /** Registry API key; rides only the Authorization header. */
  apiKey: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface SubscribeOptions {
  /** Replay strictly after this cursor; omit for the full retained stream. */
  after?: string;
  signal?: AbortSignal;
}

/**
 * A contract-conforming Idempotency-Key (16..128 chars) for mutations without
 * a caller-owned identity. submitCommand is the exception: its key IS the
 * command_id, so session-level retries dedupe.
 */
export function newIdempotencyKey(): string {
  return `idk_${crypto.randomUUID().replaceAll('-', '')}`;
}

/**
 * `?scope=` when the caller named one, nothing when it did not. Omitting it is
 * how a client asks for the deployment's default scope; sending an empty string
 * would instead name a scope the deployment does not serve, and the memory
 * routes refuse that rather than falling back.
 */
function memoryScopeQuery(scope: string | undefined): string {
  return scope === undefined ? '' : `?scope=${encodeURIComponent(scope)}`;
}

/** One decoded SSE frame: the event plus its `id:` line (the cursor). */
export interface ProjectEventFrame {
  id: string;
  event: ProjectEvent;
}

export class EdgeTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EdgeTransportConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    // Bound explicitly: stored as a method, an unbound global fetch would be
    // invoked with the transport as `this` — an Illegal invocation in real
    // Chromium (jsdom does not enforce this).
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
  }

  createProject(request: CreateProjectRequest): Promise<Project> {
    // A fresh key per call: each createProject invocation is a distinct
    // attempt. Callers that retry a create must go through a higher-level
    // identity (there is none today — projects are created interactively).
    return this.json('POST', '/projects', {
      body: request,
      headers: { 'Idempotency-Key': newIdempotencyKey() },
    });
  }

  getProject(projectId: string): Promise<ProjectSnapshot> {
    return this.json('GET', `/projects/${encodeURIComponent(projectId)}`);
  }

  /**
   * One page of the tenant's Projects, newest first. Each entry is the same
   * snapshot getProject serves, so a list row renders — and resumes its run —
   * without a request per row. `pageToken` comes from a prior page's
   * `next_page_token`; an absent token means this was the last page.
   */
  listProjects(
    options: { pageSize?: number; pageToken?: string; spaceId?: string } = {}
  ): Promise<ProjectList> {
    const query = new URLSearchParams();
    if (options.pageSize !== undefined) {
      query.set('page_size', String(options.pageSize));
    }
    if (options.pageToken) query.set('page_token', options.pageToken);
    // A Space that names nothing narrows to an empty page rather than 404ing,
    // so a stale filter renders as "nothing here" and never as a broken list.
    if (options.spaceId) query.set('space_id', options.spaceId);
    const suffix = query.size > 0 ? `?${query}` : '';
    return this.json('GET', `/projects${suffix}`);
  }

  /**
   * What the tenant's settled runs cost. `totals` covers the whole window on
   * every page — only `runs` pages — so a caller that reads one page still
   * reads a true total. A run still in flight is absent from both: cost is
   * recorded at settlement.
   */
  getUsage(
    options: {
      projectId?: string;
      since?: string;
      until?: string;
      pageSize?: number;
      pageToken?: string;
    } = {}
  ): Promise<UsageSummary> {
    const query = new URLSearchParams();
    if (options.projectId) query.set('project_id', options.projectId);
    if (options.since) query.set('since', options.since);
    if (options.until) query.set('until', options.until);
    if (options.pageSize !== undefined) {
      query.set('page_size', String(options.pageSize));
    }
    if (options.pageToken) query.set('page_token', options.pageToken);
    const suffix = query.size > 0 ? `?${query}` : '';
    return this.json('GET', `/usage${suffix}`);
  }

  submitCommand(
    projectId: string,
    request: SubmitCommandRequest
  ): Promise<CommandReceipt> {
    // command_id doubles as the idempotency key: a retried submit with the
    // same id is the same command, admitted exactly once.
    return this.json(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/commands`,
      { body: request, headers: { 'Idempotency-Key': request.command_id } }
    );
  }

  cancelRun(
    projectId: string,
    runId: string,
    request: CancelRunRequest
  ): Promise<void> {
    // Cancel is naturally idempotent server-side (epoch-fenced); the key only
    // has to satisfy the contract, so each attempt gets a fresh one.
    return this.json(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/cancel`,
      { body: request, headers: { 'Idempotency-Key': newIdempotencyKey() } }
    );
  }

  respondToApproval(
    projectId: string,
    approvalId: string,
    request: ApprovalResponse
  ): Promise<void> {
    return this.json(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/approvals/${encodeURIComponent(approvalId)}/response`,
      { body: request, headers: { 'Idempotency-Key': newIdempotencyKey() } }
    );
  }

  listModelAliases(): Promise<ModelAliasCatalog> {
    return this.json('GET', '/models');
  }

  getIntegrationStatus(): Promise<IntegrationStatus> {
    return this.json('GET', '/status');
  }

  /**
   * One page of a Project's published artifacts, newest first. A row carries
   * no download URL — the URL is a time-boxed grant, so it is minted by
   * getArtifact when someone actually opens the row rather than N at a time
   * for a page nobody clicks. An artifact still being written is absent
   * rather than listed as a broken download.
   */
  listArtifacts(
    projectId: string,
    options: { name?: string; pageSize?: number; pageToken?: string } = {}
  ): Promise<ArtifactList> {
    const query = new URLSearchParams();
    if (options.name) query.set('name', options.name);
    if (options.pageSize !== undefined) {
      query.set('page_size', String(options.pageSize));
    }
    if (options.pageToken) query.set('page_token', options.pageToken);
    const suffix = query.size > 0 ? `?${query}` : '';
    return this.json(
      'GET',
      `/projects/${encodeURIComponent(projectId)}/artifacts${suffix}`
    );
  }

  /**
   * Artifact metadata and a download grant. With `inline` the edge also
   * returns the bytes of a small text artifact, which is how a viewer renders
   * a document at all: fetching the presigned URL from the renderer would be
   * a cross-origin request to the object store. Inline is all-or-nothing —
   * `content_truncated` means too large or not text, never a partial body.
   */
  getArtifact(
    projectId: string,
    artifactId: string,
    options: { inline?: boolean } = {}
  ): Promise<ArtifactAccess> {
    const suffix = options.inline ? '?inline=true' : '';
    return this.json(
      'GET',
      `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}${suffix}`
    );
  }

  /**
   * Publish a user-picked file as a Project artifact so a later submitCommand
   * can name its `artifact_id` in `attachment_ids`. No Idempotency-Key by
   * contract: a retried upload mints the next version and identical bytes
   * dedupe in storage, so the returned id is always safe to reference.
   */
  uploadAttachment(
    projectId: string,
    upload: AttachmentUpload
  ): Promise<Artifact> {
    return this.json(
      'POST',
      `/projects/${encodeURIComponent(projectId)}/attachments`,
      { body: upload }
    );
  }

  /**
   * The catalog. `includeUsage` opts into per-name usage counters (one extra
   * read for the whole catalog, not one per skill); rows with no recorded use
   * come back without a `usage` object either way.
   */
  listSkills(options: { includeUsage?: boolean } = {}): Promise<SkillCatalog> {
    return this.json(
      'GET',
      options.includeUsage ? '/skills?usage=true' : '/skills'
    );
  }

  getSkill(
    name: string,
    options: { version?: number; includeUsage?: boolean } = {}
  ): Promise<Skill> {
    const query = new URLSearchParams();
    if (options.version !== undefined) {
      query.set('version', String(options.version));
    }
    if (options.includeUsage) query.set('usage', 'true');
    const suffix = query.size > 0 ? `?${query}` : '';
    return this.json('GET', `/skills/${encodeURIComponent(name)}${suffix}`);
  }

  /**
   * Stores a skill document (append-only version rows; an identical re-put
   * dedupes as `changed: false`). PUT is naturally idempotent — no
   * Idempotency-Key; optimistic concurrency rides `If-Match: <version>`.
   */
  putSkill(
    name: string,
    request: PutSkillRequest,
    ifMatchVersion?: number
  ): Promise<PutSkillResult> {
    return this.json('PUT', `/skills/${encodeURIComponent(name)}`, {
      body: request,
      ...(ifMatchVersion !== undefined
        ? { headers: { 'If-Match': String(ifMatchVersion) } }
        : {}),
    });
  }

  deleteSkill(name: string): Promise<void> {
    // Idempotent server-side (a deleted skill 404s the second time; the store
    // row is a status version, not a hard delete) — no Idempotency-Key.
    return this.json('DELETE', `/skills/${encodeURIComponent(name)}`);
  }

  setSkillStatus(name: string, request: SetSkillStatusRequest): Promise<Skill> {
    return this.json(
      'POST',
      `/skills/${encodeURIComponent(name)}/status`,
      { body: request }
    );
  }

  /**
   * The tenant's connector catalog with the caller's own grant state on each
   * row. `connectable` and `connected` are separate answers: a server with no
   * connector vault serves the same catalog with every oauth row
   * `connectable: false`, which is a state to render rather than a Connect
   * action that cannot succeed.
   */
  listConnectors(): Promise<ConnectorCatalog> {
    return this.json('GET', '/connectors');
  }

  /**
   * Starts the brokered OAuth flow and returns the consent URL for the caller
   * to open. The URL is the whole result — the grant lands on the cell's own
   * callback listener, so a caller polls listConnectors for `connected: true`
   * rather than treating this response as the grant.
   */
  initiateConnectorAuth(connectorId: string): Promise<ConnectorAuthorization> {
    // Not idempotent by design: each attempt mints its own single-use flow
    // state, so a retry must be a new flow rather than a replayed receipt.
    return this.json(
      'POST',
      `/connectors/${encodeURIComponent(connectorId)}/auth`,
      { headers: { 'Idempotency-Key': newIdempotencyKey() } }
    );
  }

  disconnectConnector(connectorId: string): Promise<void> {
    // Soft revoke, idempotent server-side — no Idempotency-Key.
    return this.json(
      'DELETE',
      `/connectors/${encodeURIComponent(connectorId)}/grant`
    );
  }

  /**
   * The tenant's triggers. `projectId` narrows to one Project; the tenant fence
   * is the caller's identity either way, so an omitted narrowing is the whole
   * tenant rather than an unfenced read.
   */
  listSchedules(options: { projectId?: string } = {}): Promise<ScheduleList> {
    const suffix = options.projectId
      ? `?project_id=${encodeURIComponent(options.projectId)}`
      : '';
    return this.json('GET', `/schedules${suffix}`);
  }

  /**
   * Registers a trigger. The edge requires an Idempotency-Key here because a
   * retried create would otherwise register a second trigger firing the same
   * task on the same cadence — a duplicate no later read could tell apart.
   */
  createSchedule(request: CreateScheduleRequest): Promise<Schedule> {
    return this.json('POST', '/schedules', {
      body: request,
      headers: { 'Idempotency-Key': newIdempotencyKey() },
    });
  }

  getSchedule(scheduleId: string): Promise<Schedule> {
    return this.json('GET', `/schedules/${encodeURIComponent(scheduleId)}`);
  }

  /**
   * Replaces the editable fields whole — omitting `single_shot` sets it false.
   * PUT is naturally idempotent, so no Idempotency-Key.
   */
  updateSchedule(
    scheduleId: string,
    request: UpdateScheduleRequest
  ): Promise<Schedule> {
    return this.json('PUT', `/schedules/${encodeURIComponent(scheduleId)}`, {
      body: request,
    });
  }

  deleteSchedule(scheduleId: string): Promise<void> {
    return this.json('DELETE', `/schedules/${encodeURIComponent(scheduleId)}`);
  }

  /**
   * Stops the cadence. Not idempotent server-side: pausing an already-paused
   * trigger is the typed `schedule_wrong_status` conflict rather than a
   * silent success, so the caller learns the state it acted on had moved.
   */
  pauseSchedule(scheduleId: string): Promise<Schedule> {
    return this.json(
      'POST',
      `/schedules/${encodeURIComponent(scheduleId)}/pause`
    );
  }

  resumeSchedule(scheduleId: string): Promise<Schedule> {
    return this.json(
      'POST',
      `/schedules/${encodeURIComponent(scheduleId)}/resume`
    );
  }

  /** Returns a dead-lettered trigger to the cadence, clearing its attempts. */
  requeueSchedule(scheduleId: string): Promise<Schedule> {
    return this.json(
      'POST',
      `/schedules/${encodeURIComponent(scheduleId)}/requeue`
    );
  }

  /**
   * The newest window of the trigger's ledger, oldest entry of that window
   * first. This is the only place a forfeited tick (`skipped_busy`,
   * `skipped_generation`) is observable: neither changes the trigger row, so a
   * screen reading only the row cannot tell a healthy trigger from one that
   * has not actually run in weeks.
   */
  listScheduleEvents(
    scheduleId: string,
    options: { limit?: number } = {}
  ): Promise<ScheduleEventList> {
    const suffix =
      options.limit !== undefined ? `?limit=${String(options.limit)}` : '';
    return this.json(
      'GET',
      `/schedules/${encodeURIComponent(scheduleId)}/events${suffix}`
    );
  }

  /**
   * What the agent remembers between sessions, plus how full the scope is. The
   * rows carry NO `content` — a scope is bounded per document, so a listing
   * that returned every document would cost the whole scope to draw an index;
   * read one with getMemory or search for the ones that matter.
   *
   * `scope` is a served name, not a free-form one: the deployment publishes the
   * set it answers for on every catalog it returns, and one outside that set is
   * the typed `memory_scope_denied` refusal rather than an empty listing.
   */
  listMemory(options: { scope?: string } = {}): Promise<MemoryCatalog> {
    return this.json('GET', `/memory${memoryScopeQuery(options.scope)}`);
  }

  /**
   * Ranked documents for a query, most relevant first, each WITH its content —
   * a result the caller has to fetch again to read is a link to nowhere. The
   * server decides the ranking; render the order it returned rather than
   * re-sorting on `score`, which is not comparable across queries.
   */
  searchMemory(
    query: string,
    options: { scope?: string; k?: number } = {}
  ): Promise<MemorySearchResult> {
    const params = new URLSearchParams({ q: query });
    if (options.scope !== undefined) params.set('scope', options.scope);
    if (options.k !== undefined) params.set('k', String(options.k));
    return this.json('GET', `/memory/search?${params.toString()}`);
  }

  getMemory(key: string, options: { scope?: string } = {}): Promise<MemoryDoc> {
    return this.json(
      'GET',
      `/memory/${encodeURIComponent(key)}${memoryScopeQuery(options.scope)}`
    );
  }

  /**
   * Writes a document whole, creating or replacing it. PUT is naturally
   * idempotent, so no Idempotency-Key. The result carries usage when the server
   * reported it: the moment to tell someone a scope is nearly full is the
   * moment they just added to it. An ABSENT usage is a missing reading, never a
   * full scope.
   */
  putMemory(
    key: string,
    content: string,
    options: { scope?: string } = {}
  ): Promise<MemoryWriteResult> {
    return this.json(
      'PUT',
      `/memory/${encodeURIComponent(key)}${memoryScopeQuery(options.scope)}`,
      { body: { content } satisfies MemoryWriteRequest }
    );
  }

  deleteMemory(key: string, options: { scope?: string } = {}): Promise<void> {
    // Idempotent server-side: deleting what is already gone is the state the
    // caller asked for, so it answers 204 either way.
    return this.json(
      'DELETE',
      `/memory/${encodeURIComponent(key)}${memoryScopeQuery(options.scope)}`
    );
  }

  /** Forgets every document in the scope, reporting how many it removed. */
  clearMemory(options: { scope?: string } = {}): Promise<MemoryCleared> {
    return this.json(
      'POST',
      `/memory/clear${memoryScopeQuery(options.scope)}`,
      { headers: { 'Idempotency-Key': newIdempotencyKey() } }
    );
  }

  /**
   * Who this API key says the caller is. This is the one call that verifies a
   * pasted key: a bad key answers 401 before anything else in the app runs.
   * `key_management` says whether the key routes below will work here at all —
   * an operator-provisioned deployment answers this route and refuses the
   * rest, and a client must read the flag rather than discover it by clicking.
   */
  getAccount(): Promise<Account> {
    return this.json('GET', '/account');
  }

  /**
   * The tenant's API keys, metadata only — a raw secret is never listed. The
   * row with `current: true` is the one this request authenticated with, which
   * is the only thing a client holding a raw key cannot work out for itself.
   */
  listKeys(): Promise<APIKeyList> {
    return this.json('GET', '/keys');
  }

  /**
   * Mints a key for the caller's own grant and returns the raw secret ONCE.
   * A replay of the same Idempotency-Key answers 200 with `idempotent_replay`
   * and no `raw_key` — so a caller that retries must treat a missing secret as
   * "already minted, unrecoverable", never as an empty key.
   *
   * Tenant, user, scopes and environment are not settable: they come from the
   * credential making the call, and naming one here is refused by the edge.
   */
  createKey(request: CreateKeyRequest = {}): Promise<CreatedKey> {
    return this.json('POST', '/keys', {
      body: request,
      headers: { 'Idempotency-Key': newIdempotencyKey() },
    });
  }

  /**
   * Retires a key. 204 for an id this tenant does not own, so the response is
   * not an oracle for which keys exist. Revoking the `current` row is allowed
   * and signs this client out on its next request — nothing is cached, the
   * edge re-resolves every call.
   */
  revokeKey(keyId: string): Promise<void> {
    return this.json('DELETE', `/keys/${encodeURIComponent(keyId)}`);
  }

  /**
   * The tenant's Spaces, newest first, each carrying how many Projects it
   * holds — closed ones included, because a Space whose work is finished still
   * holds it.
   */
  listSpaces(
    options: { pageSize?: number; pageToken?: string } = {}
  ): Promise<SpaceList> {
    const query = new URLSearchParams();
    if (options.pageSize !== undefined) {
      query.set('page_size', String(options.pageSize));
    }
    if (options.pageToken) query.set('page_token', options.pageToken);
    const suffix = query.size > 0 ? `?${query}` : '';
    return this.json('GET', `/spaces${suffix}`);
  }

  /**
   * Creates a Space. The key is scoped to the tenant, so a retried create
   * replays the Space it already made rather than minting a second one under
   * the same name — a duplicate no later read could tell apart.
   */
  createSpace(request: CreateSpaceRequest): Promise<Space> {
    return this.json('POST', '/spaces', {
      body: request,
      headers: { 'Idempotency-Key': newIdempotencyKey() },
    });
  }

  getSpace(spaceId: string): Promise<Space> {
    return this.json('GET', `/spaces/${encodeURIComponent(spaceId)}`);
  }

  /**
   * Replaces name and description whole, and answers with the Space AND its
   * count, so the row the caller just edited renders without a second read.
   * Status is not editable here: a rename must never un-shelve a Space.
   */
  updateSpace(spaceId: string, request: UpdateSpaceRequest): Promise<Space> {
    return this.json('PUT', `/spaces/${encodeURIComponent(spaceId)}`, {
      body: request,
    });
  }

  /**
   * Removes an EMPTY Space. One that still holds Projects answers 409
   * `space_in_use` rather than taking its Projects with it.
   */
  deleteSpace(spaceId: string): Promise<void> {
    return this.json('DELETE', `/spaces/${encodeURIComponent(spaceId)}`);
  }

  /** Puts a Space away. What it holds stays filed under it and stays listable. */
  archiveSpace(spaceId: string): Promise<Space> {
    return this.json('POST', `/spaces/${encodeURIComponent(spaceId)}/archive`);
  }

  unarchiveSpace(spaceId: string): Promise<Space> {
    return this.json('POST', `/spaces/${encodeURIComponent(spaceId)}/unarchive`);
  }

  /**
   * Files a Project under a Space. Filing changes what a listing shows, never
   * what a run does. Unfiling is its own verb below rather than this one with
   * an empty id, so each request means exactly one thing.
   */
  setProjectSpace(projectId: string, spaceId: string): Promise<Project> {
    return this.json('PUT', `/projects/${encodeURIComponent(projectId)}/space`, {
      body: { space_id: spaceId },
    });
  }

  clearProjectSpace(projectId: string): Promise<Project> {
    return this.json(
      'DELETE',
      `/projects/${encodeURIComponent(projectId)}/space`
    );
  }

  /**
   * Subscribes to the Project event stream: replay strictly after the cursor,
   * then live tail. Yields each frame in order until the server ends the
   * stream, the signal aborts, or an error is thrown. A refused cursor
   * surfaces BEFORE any frame as an EdgeProblemError whose problem satisfies
   * isCursorExpiredProblem — recovery (snapshot rehydrate) belongs to the
   * caller.
   */
  async *subscribeProjectEvents(
    projectId: string,
    options: SubscribeOptions = {}
  ): AsyncGenerator<ProjectEventFrame, void, undefined> {
    const query = options.after
      ? `?after=${encodeURIComponent(options.after)}`
      : '';
    const response = await this.fetchImpl(
      `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/events${query}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'text/event-stream',
          ...(options.after ? { 'Last-Event-ID': options.after } : {}),
        },
        signal: options.signal,
      }
    );
    if (!response.ok) {
      throw await this.problemFrom(response);
    }
    if (!response.body) {
      throw new Error('event stream response has no body');
    }
    yield* parseEventStream(response.body);
  }

  private async json<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    if (!response.ok) {
      throw await this.problemFrom(response);
    }
    // Accepted mutations answer with headers only (202/204 and no body) —
    // parsing '' as JSON would turn a recorded decision into a client error.
    const text = await response.text();
    return (text === '' ? undefined : JSON.parse(text)) as T;
  }

  private async problemFrom(response: Response): Promise<Error> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.startsWith(PROBLEM_CONTENT_TYPE)) {
      let problem: EdgeProblem;
      try {
        problem = decodeProblem(await response.json());
      } catch {
        return new Error(`edge returned ${response.status} with a malformed problem document`);
      }
      return new EdgeProblemError(problem);
    }
    return new Error(`edge returned ${response.status} without a problem document`);
  }
}

/**
 * Minimal SSE parser for the edge stream (fetch-based because EventSource
 * cannot carry an Authorization header). Understands `id:`, `event:`, and
 * `data:` lines; frames are delimited by a blank line per the SSE spec.
 */
export async function* parseEventStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<ProjectEventFrame, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let id = '';
  let data: string[] = [];

  const flush = (): ProjectEventFrame | null => {
    if (data.length === 0) {
      id = '';
      return null;
    }
    const frame: ProjectEventFrame = {
      id,
      event: parseProjectEventJSON(data.join('\n')),
    };
    id = '';
    data = [];
    return frame;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line === '') {
          const frame = flush();
          if (frame) {
            yield frame;
          }
        } else if (line.startsWith('id:')) {
          id = line.slice(3).trimStart();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).trimStart());
        }
        // `event:` names and comment lines carry no payload the desktop
        // depends on; kind lives inside the JSON body.
      }
    }
    const frame = flush();
    if (frame) {
      yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}
