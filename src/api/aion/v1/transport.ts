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
export type CreateProjectRequest = Schemas['CreateProjectRequest'];
export type SubmitCommandRequest = Schemas['SubmitCommandRequest'];
export type CommandReceipt = Schemas['CommandReceipt'];
export type CancelRunRequest = Schemas['CancelRunRequest'];
export type ApprovalResponse = Schemas['ApprovalResponse'];
export type ModelAliasCatalog = Schemas['ModelAliasCatalog'];
export type IntegrationStatus = Schemas['IntegrationStatus'];
export type ArtifactAccess = Schemas['ArtifactAccess'];

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

  getArtifact(projectId: string, artifactId: string): Promise<ArtifactAccess> {
    return this.json(
      'GET',
      `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}`
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
    method: 'GET' | 'POST',
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
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
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
