// Reconnect/rehydrate/retry policy for one Project (doc 10 §10 WP2), composed
// over the policy-free transport and the pure reducer:
//
// - Bounded reconnect: exponential backoff from the last ACKNOWLEDGED cursor
//   (state.lastSequence); attempts are capped and reset by any applied frame.
// - Cursor expiry: a typed cursor_expired refusal triggers a full snapshot
//   rehydrate, then resume strictly after the snapshot sequence. The cursor
//   is never guessed.
// - Idempotent command retry: a retried submit reuses the SAME command_id, so
//   the edge admits the command exactly once no matter how many transports
//   attempts it took.
// - Connection state is reported separately from Project state and never
//   mutates it: backend truth comes only from events and snapshots, never
//   from the socket's mood.

import {
  EdgeProblemError,
  isCursorExpiredProblem,
} from './problems';
import {
  initialProjectState,
  reduceProjectEvent,
  stateFromSnapshot,
  type ProjectUIState,
} from './reducer';
import type {
  CommandReceipt,
  EdgeTransport,
  SubmitCommandRequest,
} from './transport';

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'rehydrating'
  | 'stopped'
  | 'failed';

export interface ProjectSessionConfig {
  transport: SessionTransport;
  projectId: string;
  onState?: (state: ProjectUIState) => void;
  onStatus?: (status: SessionStatus) => void;
  /** Consecutive failed connection attempts before giving up. */
  maxReconnectAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Attempts per submitCommand call (1 = no retry). */
  commandAttempts?: number;
  /** Injectable timer for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** The slice of EdgeTransport the session depends on (narrow for tests). */
export type SessionTransport = Pick<
  EdgeTransport,
  'subscribeProjectEvents' | 'getProject' | 'submitCommand'
>;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class ProjectSession {
  private readonly transport: SessionTransport;
  private readonly projectId: string;
  private readonly onState?: (state: ProjectUIState) => void;
  private readonly onStatus?: (status: SessionStatus) => void;
  private readonly maxReconnectAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly commandAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private stateValue: ProjectUIState;
  private statusValue: SessionStatus = 'idle';
  private abort: AbortController | null = null;
  private stopped = false;
  private running: Promise<void> | null = null;

  constructor(config: ProjectSessionConfig) {
    this.transport = config.transport;
    this.projectId = config.projectId;
    this.onState = config.onState;
    this.onStatus = config.onStatus;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 5;
    this.initialBackoffMs = config.initialBackoffMs ?? 500;
    this.maxBackoffMs = config.maxBackoffMs ?? 15_000;
    this.commandAttempts = config.commandAttempts ?? 3;
    this.sleep = config.sleep ?? defaultSleep;
    this.stateValue = initialProjectState(config.projectId);
  }

  get state(): ProjectUIState {
    return this.stateValue;
  }

  get status(): SessionStatus {
    return this.statusValue;
  }

  /** Starts the subscribe/reduce loop. Resolves when the session ends. */
  start(): Promise<void> {
    if (this.running) {
      return this.running;
    }
    this.stopped = false;
    this.running = this.run();
    return this.running;
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    this.setStatus('stopped');
  }

  /**
   * Submits a command, retrying transient failures with the SAME command_id
   * (the Idempotency-Key), so a retry can never double-admit. Non-retryable
   * problems (4xx policy refusals) surface immediately.
   */
  async submitCommand(request: SubmitCommandRequest): Promise<CommandReceipt> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.commandAttempts; attempt++) {
      try {
        return await this.transport.submitCommand(this.projectId, request);
      } catch (error) {
        lastError = error;
        if (!isRetryableCommandError(error) || attempt === this.commandAttempts) {
          throw error;
        }
        await this.sleep(
          backoffDelay(attempt, this.initialBackoffMs, this.maxBackoffMs)
        );
      }
    }
    throw lastError;
  }

  private async run(): Promise<void> {
    let failures = 0;
    this.setStatus('connecting');
    while (!this.stopped) {
      this.abort = new AbortController();
      try {
        const stream = this.transport.subscribeProjectEvents(this.projectId, {
          after: this.stateValue.lastSequence,
          signal: this.abort.signal,
        });
        for await (const frame of stream) {
          const next = reduceProjectEvent(this.stateValue, frame.event);
          if (next !== this.stateValue) {
            this.stateValue = next;
            this.onState?.(next);
          }
          // Progress is the reconnect-budget reset — an applied frame proves
          // the cursor is live again.
          failures = 0;
          this.setStatus('live');
        }
        if (this.stopped) {
          return;
        }
        // Server ended the stream without error (idle expiry, deploy, …):
        // resume from the acknowledged cursor. Rate-bounded but not counted
        // against the failure budget — a quiet project is not a failing one.
        this.setStatus('reconnecting');
        await this.sleep(this.initialBackoffMs);
      } catch (error) {
        if (this.stopped) {
          return;
        }
        if (
          error instanceof EdgeProblemError &&
          isCursorExpiredProblem(error.problem)
        ) {
          // Retention outran our cursor. Full rehydrate from one consistent
          // snapshot, resume strictly after its sequence — never a guess.
          this.setStatus('rehydrating');
          try {
            const snapshot = await this.transport.getProject(this.projectId);
            this.stateValue = stateFromSnapshot(snapshot);
            this.onState?.(this.stateValue);
            failures = 0;
            this.setStatus('reconnecting');
            continue;
          } catch (rehydrateError) {
            void rehydrateError;
            // Snapshot fetch failed — falls through to the bounded budget.
          }
        }
        failures += 1;
        if (failures >= this.maxReconnectAttempts) {
          this.setStatus('failed');
          return;
        }
        this.setStatus('reconnecting');
        await this.sleep(
          backoffDelay(failures, this.initialBackoffMs, this.maxBackoffMs)
        );
      }
    }
  }

  private setStatus(status: SessionStatus): void {
    if (this.statusValue !== status) {
      this.statusValue = status;
      this.onStatus?.(status);
    }
  }
}

/** Fresh idempotency identity for a NEW command; retries must reuse it. */
export function newCommandId(): string {
  return `cmd_${crypto.randomUUID().replaceAll('-', '')}`;
}

function backoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(initialMs * 2 ** (attempt - 1), maxMs);
}

function isRetryableCommandError(error: unknown): boolean {
  if (error instanceof EdgeProblemError) {
    // The contract marks retryability explicitly; a 5xx without the flag is
    // still worth one more identical, idempotent attempt.
    return error.problem.retryable === true || error.problem.status >= 500;
  }
  // fetch-level network failures surface as TypeError and never reached the
  // edge; the idempotency key makes an identical retry safe. Anything else
  // (including an abort) is a caller decision, never retried.
  return error instanceof TypeError;
}
