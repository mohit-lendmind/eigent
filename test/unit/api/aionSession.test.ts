import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { decodeProjectEvent, type ProjectEvent } from '@/api/aion/v1/contracts';
import { EdgeProblemError, decodeProblem } from '@/api/aion/v1/problems';
import {
  initialProjectState,
  reduceProjectEvents,
} from '@/api/aion/v1/reducer';
import {
  ProjectSession,
  newCommandId,
  type SessionStatus,
  type SessionTransport,
} from '@/api/aion/v1/session';
import type { ProjectEventFrame } from '@/api/aion/v1/transport';

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

const manifest = fixture('manifest.json') as { events: string[] };

function goldenStream(): ProjectEvent[] {
  return manifest.events.map((name, index) =>
    decodeProjectEvent({
      ...(fixture(name) as Record<string, unknown>),
      sequence: String(index + 1),
      event_id: `evt-golden-${String(index + 1).padStart(4, '0')}`,
    })
  );
}

const frameOf = (event: ProjectEvent): ProjectEventFrame => ({
  id: event.sequence,
  event,
});

async function* frames(
  events: readonly ProjectEvent[]
): AsyncGenerator<ProjectEventFrame, void, undefined> {
  for (const event of events) {
    yield frameOf(event);
  }
}

async function* failWith(error: Error): AsyncGenerator<ProjectEventFrame> {
  throw error;
}

/**
 * Scripted transport: each subscribe call consumes the next script entry —
 * an event array (streamed then clean EOF) or an Error (thrown). The session
 * under test never notices it is talking to a script.
 */
function scriptedTransport(options: {
  script: Array<ProjectEvent[] | Error>;
  snapshot?: unknown;
  submitResults?: Array<Error | unknown>;
}): {
  transport: SessionTransport;
  subscribeCursors: string[];
  snapshotFetches: number[];
  submitCalls: Array<{ projectId: string; commandId: string }>;
} {
  const subscribeCursors: string[] = [];
  const snapshotFetches: number[] = [];
  const submitCalls: Array<{ projectId: string; commandId: string }> = [];
  let scriptIndex = 0;
  let submitIndex = 0;
  const transport: SessionTransport = {
    subscribeProjectEvents(_projectId, opts = {}) {
      subscribeCursors.push(opts.after ?? '');
      const step = options.script[scriptIndex++] ?? [];
      if (step instanceof Error) {
        return failWith(step);
      }
      return frames(step);
    },
    async getProject() {
      snapshotFetches.push(scriptIndex);
      if (options.snapshot === undefined) {
        throw new Error('no snapshot scripted');
      }
      return options.snapshot as Awaited<
        ReturnType<SessionTransport['getProject']>
      >;
    },
    async submitCommand(projectId, request) {
      submitCalls.push({ projectId, commandId: request.command_id });
      const result = options.submitResults?.[submitIndex++];
      if (result instanceof Error) {
        throw result;
      }
      if (result === undefined) {
        throw new Error('no submit result scripted');
      }
      return result as Awaited<ReturnType<SessionTransport['submitCommand']>>;
    },
  };
  return { transport, subscribeCursors, snapshotFetches, submitCalls };
}

function makeSession(
  transport: SessionTransport,
  overrides: Partial<ConstructorParameters<typeof ProjectSession>[0]> = {}
) {
  const statuses: SessionStatus[] = [];
  const sleeps: number[] = [];
  const session = new ProjectSession({
    transport,
    projectId: 'prj_01JY0000000000000000000001',
    onStatus: (status) => statuses.push(status),
    // Records the requested delay but still yields a real macrotask, so an
    // exhausted script (endless clean EOFs) cannot starve the test's timers.
    sleep: async (ms) => {
      sleeps.push(ms);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    maxReconnectAttempts: 3,
    initialBackoffMs: 100,
    maxBackoffMs: 1000,
    ...overrides,
  });
  return { session, statuses, sleeps };
}

describe('ProjectSession reconnect', () => {
  it('reduces a live stream and resumes from the acknowledged cursor after a drop', async () => {
    const events = goldenStream();
    const boom = new Error('connection reset');
    const { transport, subscribeCursors } = scriptedTransport({
      // 6 events, drop, then the rest replayed from the cursor with overlap.
      script: [events.slice(0, 6), boom, events.slice(3)],
    });
    const { session, statuses } = makeSession(transport);
    const uninterrupted = reduceProjectEvents(
      initialProjectState('prj_01JY0000000000000000000001'),
      events
    );
    const done = session.start();
    await waitUntil(() => session.state.lastSequence === '10');
    session.stop();
    await done;

    expect(subscribeCursors[0]).toBe('0');
    expect(subscribeCursors[1]).toBe('6'); // resume from the clean-EOF ack
    expect(subscribeCursors[2]).toBe('6'); // retry resumes from the same ack
    // The interrupted-and-overlapping session equals one uninterrupted fold.
    expect(session.state).toEqual(uninterrupted);
    expect(JSON.stringify(session.state)).toBe(JSON.stringify(uninterrupted));
    expect(statuses).toContain('live');
    expect(statuses).toContain('reconnecting');
    expect(session.status).toBe('stopped');
  });

  it('gives up after the bounded reconnect budget', async () => {
    const boom = () => new Error('edge unreachable');
    const { transport, subscribeCursors } = scriptedTransport({
      script: [boom(), boom(), boom(), boom(), boom()],
    });
    const { session, statuses, sleeps } = makeSession(transport);
    await session.start();

    expect(session.status).toBe('failed');
    expect(subscribeCursors).toHaveLength(3); // maxReconnectAttempts
    expect(sleeps).toEqual([100, 200]); // exponential, no sleep after the last
    expect(statuses.at(-1)).toBe('failed');
  });

  it('an applied frame resets the reconnect budget', async () => {
    const events = goldenStream();
    const boom = () => new Error('flaky network');
    const { transport } = scriptedTransport({
      script: [
        boom(),
        boom(),
        events.slice(0, 2), // progress: budget resets
        boom(),
        boom(),
        events.slice(2, 4),
      ],
    });
    const { session } = makeSession(transport);
    const done = session.start();
    await waitUntil(() => session.state.lastSequence === '4');
    session.stop();
    await done;
    expect(session.status).toBe('stopped'); // never reached 'failed'
    expect(session.state.lastSequence).toBe('4');
  });

  it('rehydrates from the snapshot on cursor expiry and resumes after its sequence', async () => {
    const expired = new EdgeProblemError(
      decodeProblem(fixture('problem_cursor_expired.json'))
    );
    const liveAfterSnapshot = decodeProjectEvent({
      ...(fixture('event_text_delta.json') as Record<string, unknown>),
      sequence: '1731',
    });
    const { transport, subscribeCursors, snapshotFetches } = scriptedTransport({
      script: [expired, [liveAfterSnapshot]],
      snapshot: {
        project: fixture('create_project_response.json'),
        active_run: {
          run_id: 'run_01JY0000000000000000000001',
          run_epoch: '1',
          status: 'running',
        },
        last_sequence: '1730',
        events_pruned_below: '1042',
      },
    });
    const { session, statuses } = makeSession(transport);
    const done = session.start();
    await waitUntil(() => session.state.lastSequence === '1731');
    session.stop();
    await done;

    expect(snapshotFetches).toHaveLength(1);
    expect(subscribeCursors[0]).toBe('0');
    expect(subscribeCursors[1]).toBe('1730'); // snapshot sequence, not a guess
    expect(statuses).toContain('rehydrating');
    expect(session.state.rehydratedFrom).toBe('1730');
    expect(session.state.timeline).toHaveLength(1);
    expect(session.state.gapCount).toBe(0);
  });

  it('reports connection status without touching Project state', async () => {
    const { transport } = scriptedTransport({
      script: [new Error('down'), new Error('down'), new Error('down')],
    });
    const { session } = makeSession(transport);
    const before = session.state;
    await session.start();
    expect(session.status).toBe('failed');
    expect(session.state).toBe(before); // connection state is not backend truth
  });
});

describe('ProjectSession command retry', () => {
  const receipt = fixture('submit_command_response.json');
  const request = fixture('submit_command_request.json') as Parameters<
    SessionTransport['submitCommand']
  >[1];

  it('retries a network failure with the same command_id', async () => {
    const { transport, submitCalls } = scriptedTransport({
      script: [],
      submitResults: [new TypeError('fetch failed'), receipt],
    });
    const { session, sleeps } = makeSession(transport);
    const result = await session.submitCommand(request);
    expect(result).toEqual(receipt);
    expect(submitCalls).toHaveLength(2);
    expect(submitCalls[0].commandId).toBe(request.command_id);
    expect(submitCalls[1].commandId).toBe(request.command_id); // idempotent
    expect(sleeps).toEqual([100]);
  });

  it('does not retry a non-retryable policy refusal', async () => {
    const denied = new EdgeProblemError(
      decodeProblem(fixture('problem_model_alias_denied.json'))
    );
    const { transport, submitCalls } = scriptedTransport({
      script: [],
      submitResults: [denied, receipt],
    });
    const { session } = makeSession(transport);
    await expect(session.submitCommand(request)).rejects.toBe(denied);
    expect(submitCalls).toHaveLength(1);
  });

  it('gives up after the bounded attempt budget', async () => {
    const flaky = () => new TypeError('fetch failed');
    const { transport, submitCalls } = scriptedTransport({
      script: [],
      submitResults: [flaky(), flaky(), flaky(), receipt],
    });
    const { session } = makeSession(transport);
    await expect(session.submitCommand(request)).rejects.toThrow('fetch failed');
    expect(submitCalls).toHaveLength(3); // commandAttempts
  });
});

describe('newCommandId', () => {
  it('mints contract-legal unique identifiers', () => {
    const a = newCommandId();
    const b = newCommandId();
    expect(a).toMatch(/^cmd_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

async function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
