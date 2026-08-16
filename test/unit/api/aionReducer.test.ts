import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { decodeProjectEvent, type ProjectEvent } from '@/api/aion/v1/contracts';
import {
  initialProjectState,
  reduceProjectEvent,
  reduceProjectEvents,
  stateFromSnapshot,
  workersForRun,
  type ProjectUIState,
} from '@/api/aion/v1/reducer';

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

const manifest = fixture('manifest.json') as { events: string[] };

// The manifest fixtures each pin one event kind, so their sequences overlap.
// Re-sequencing 1..N (a pure, order-preserving transform) turns them into one
// legal golden stream while every payload byte stays fixture-authored.
function goldenStream(): ProjectEvent[] {
  return manifest.events.map((name, index) =>
    decodeProjectEvent({
      ...(fixture(name) as Record<string, unknown>),
      sequence: String(index + 1),
      event_id: `evt-golden-${String(index + 1).padStart(4, '0')}`,
    })
  );
}

describe('aion Project reducer (golden fixtures)', () => {
  it('reduces the full golden stream to the pinned final state', () => {
    const state = reduceProjectEvents(initialProjectState(), goldenStream());

    expect(state.projectId).toBe('prj_01JY0000000000000000000001');
    expect(state.lastSequence).toBe('13');
    expect(state.gapCount).toBe(0);
    expect(state.suppressedEventCount).toBe(0);
    expect(state.activeRunId).toBeNull();
    expect(state.pendingApprovals).toEqual({});

    // Every run in the stream reached its pinned terminal status. Run 1 parked
    // partway through and moved again, so it carries no recovery at the end —
    // a banner outliving the condition it describes is the failure this state
    // exists to prevent.
    expect(state.runs['run_01JY0000000000000000000001']).toMatchObject({
      status: 'succeeded',
      runEpoch: '1',
      outcomeDetail: 'The failing target and minimal fix were identified.',
    });
    expect(state.runs['run_01JY0000000000000000000001'].recovery).toBeUndefined();
    expect(state.runs['run_01JY0000000000000000000002']).toMatchObject({
      status: 'failed',
      outcomeReason: 'context_limit',
      outcomeDetail: 'The run exceeded the context budget before converging.',
    });
    expect(state.runs['run_01JY0000000000000000000003']).toMatchObject({
      status: 'cancelled',
      outcomeReason: 'user_requested',
    });

    // Timeline shape: boundary, text, tool(with result), recovery(the run
    // parked and later moved again — the entry stays because a run that
    // stalled did not have the same history as one that never did),
    // worker(started then ended — ONE lane, not two entries),
    // approval(resolved), artifact, then three terminal boundaries.
    expect(state.timeline.map((entry) => entry.type)).toEqual([
      'run_boundary',
      'text',
      'tool',
      'recovery',
      'worker',
      'approval',
      'artifact',
      'run_boundary',
      'run_boundary',
      'run_boundary',
    ]);

    expect(state.timeline[3]).toMatchObject({
      type: 'recovery',
      runId: 'run_01JY0000000000000000000001',
      label: 'blocked_poison_event',
      blocking: true,
    });

    const tool = state.timeline[2];
    expect(tool).toMatchObject({
      type: 'tool',
      toolCallId: 'toolu_01JY0000000000000000001',
      toolName: 'bash',
      argumentsJson: '{"command":"bazel test //pkg:target"}',
      result: { content: '1 test failed', isError: true },
    });

    const worker = state.timeline[4];
    expect(worker).toMatchObject({ type: 'worker', runId: 'run_01JY0000000000000000000001' });
    expect(workersForRun(state, 'run_01JY0000000000000000000001')).toEqual([
      {
        workerKey: 'run_01JY0000000000000000000001#ses_01JY0000000000000000000042',
        runId: 'run_01JY0000000000000000000001',
        childSessionId: 'ses_01JY0000000000000000000042',
        role: 'search',
        name: 'dependency-audit',
        status: 'succeeded',
        reason: 'completed',
        error: undefined,
        startedSequence: '6',
        endedSequence: '7',
      },
    ]);

    const approval = state.timeline[5];
    expect(approval).toMatchObject({
      type: 'approval',
      approvalId: 'apr_01JY0000000000000000000001',
      toolName: 'edit_file',
      reason: 'workspace_write',
      decision: 'allow',
      resolvedBy: 'user',
    });

    const artifact = state.timeline[6];
    expect(artifact).toMatchObject({
      type: 'artifact',
      artifact: { artifact_id: 'art_01JY0000000000000000000001', name: 'test-report.json' },
    });
    expect(state.artifacts['art_01JY0000000000000000000001']).toMatchObject({
      media_type: 'application/json',
      sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    });
  });

  it('live one-by-one and batch replay reduce to identical state', () => {
    const events = goldenStream();
    let live = initialProjectState();
    for (const event of events) {
      live = reduceProjectEvent(live, event);
    }
    const replayed = reduceProjectEvents(initialProjectState(), events);
    expect(replayed).toEqual(live);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));
  });

  it('overlapping replay after reconnect is invisible', () => {
    const events = goldenStream();
    const uninterrupted = reduceProjectEvents(initialProjectState(), events);

    // Disconnect after event 6, reconnect replaying from cursor 3 (overlap
    // 4..6 must be dropped without any state change).
    let resumed = reduceProjectEvents(initialProjectState(), events.slice(0, 6));
    const beforeOverlap = resumed;
    for (const event of events.slice(3, 6)) {
      resumed = reduceProjectEvent(resumed, event);
      expect(resumed).toBe(beforeOverlap);
    }
    resumed = reduceProjectEvents(resumed, events.slice(6));
    expect(resumed).toEqual(uninterrupted);
    expect(JSON.stringify(resumed)).toBe(JSON.stringify(uninterrupted));
  });

  it('reduces every event fixture without loss (per-kind golden coverage)', () => {
    for (const name of manifest.events) {
      const event = decodeProjectEvent(fixture(name));
      const seeded: ProjectUIState = {
        ...initialProjectState(event.project_id),
        lastSequence: String(BigInt(event.sequence) - 1n),
      };
      const state = reduceProjectEvent(seeded, event);
      expect(state.lastSequence).toBe(event.sequence);
      expect(state).not.toBe(seeded);
    }
  });

  it('retains an unknown additive event kind as an opaque timeline entry', () => {
    const unknown = decodeProjectEvent({
      ...(fixture('event_text_delta.json') as Record<string, unknown>),
      sequence: '1',
      kind: 'aion_variant_from_the_future',
      data: { shape: 'cube', payload: { nested: true } },
    });
    const state = reduceProjectEvent(initialProjectState(), unknown);
    expect(state.timeline).toHaveLength(1);
    const entry = state.timeline[0];
    expect(entry).toMatchObject({
      type: 'opaque',
      kind: 'aion_variant_from_the_future',
    });
    if (entry.type === 'opaque') {
      expect(entry.event.data).toEqual({ shape: 'cube', payload: { nested: true } });
    }
  });

  it('suppresses internal, audit, and unknown visibilities but advances the cursor', () => {
    const base = fixture('event_text_delta.json') as Record<string, unknown>;
    let state = initialProjectState();
    for (const [index, visibility] of ['internal', 'audit', 'debug_v2'].entries()) {
      state = reduceProjectEvent(
        state,
        decodeProjectEvent({ ...base, sequence: String(index + 1), visibility })
      );
    }
    expect(state.timeline).toEqual([]);
    expect(state.suppressedEventCount).toBe(3);
    expect(state.lastSequence).toBe('3');
    expect(state.gapCount).toBe(0);
  });

  it('records a sequence gap without repairing it', () => {
    const base = fixture('event_text_delta.json') as Record<string, unknown>;
    let state = reduceProjectEvent(
      initialProjectState(),
      decodeProjectEvent({ ...base, sequence: '1' })
    );
    state = reduceProjectEvent(
      state,
      decodeProjectEvent({ ...base, sequence: '5' })
    );
    expect(state.gapCount).toBe(1);
    expect(state.lastSequence).toBe('5');
  });

  it('keeps an unmatched tool_result opaque instead of inventing a call', () => {
    const result = decodeProjectEvent({
      ...(fixture('event_tool_result.json') as Record<string, unknown>),
      sequence: '1',
    });
    const state = reduceProjectEvent(initialProjectState(), result);
    expect(state.timeline[0]).toMatchObject({ type: 'opaque', kind: 'tool_result' });
  });

  it('rehydrates from a snapshot and resumes strictly after its sequence', () => {
    const snapshot = {
      project: fixture('create_project_response.json') as Record<string, unknown>,
      active_run: { run_id: 'run_01JY0000000000000000000001', run_epoch: '1', status: 'running' },
      last_sequence: '1042',
      events_pruned_below: '1000',
    };
    const state = stateFromSnapshot(
      snapshot as Parameters<typeof stateFromSnapshot>[0]
    );
    expect(state.projectId).toBe('prj_01JY0000000000000000000001');
    expect(state.lastSequence).toBe('1042');
    expect(state.rehydratedFrom).toBe('1042');
    expect(state.activeRunId).toBe('run_01JY0000000000000000000001');
    expect(state.runs['run_01JY0000000000000000000001'].status).toBe('running');

    // A stale event below the snapshot floor is a no-op; the next live event
    // (floor+1) applies gapless.
    const stale = decodeProjectEvent({
      ...(fixture('event_text_delta.json') as Record<string, unknown>),
      sequence: '900',
    });
    expect(reduceProjectEvent(state, stale)).toBe(state);
    const next = reduceProjectEvent(
      state,
      decodeProjectEvent({
        ...(fixture('event_text_delta.json') as Record<string, unknown>),
        sequence: '1043',
      })
    );
    expect(next.lastSequence).toBe('1043');
    expect(next.gapCount).toBe(0);
    expect(next.timeline).toHaveLength(1);
  });

  it('treats an unknown snapshot run status as busy, never terminal', () => {
    const state = stateFromSnapshot({
      project: fixture('create_project_response.json') as Record<string, unknown>,
      active_run: {
        run_id: 'run_x',
        run_epoch: '2',
        status: 'quantum_pending',
      },
      last_sequence: '7',
    } as Parameters<typeof stateFromSnapshot>[0]);
    expect(state.runs['run_x'].status).toBe('running');
  });

  // The three ways a fan-out arrives incomplete. Both lifecycle deltas are
  // forwarded non-blocking upstream, so either half can be dropped; and an
  // ephemeral spawn carries no child session id to pair on at all.
  describe('workforce degradations', () => {
    const started = (over: Record<string, unknown>): ProjectEvent =>
      decodeProjectEvent({
        ...(fixture('event_subagent_started.json') as Record<string, unknown>),
        ...over,
      });
    const ended = (over: Record<string, unknown>): ProjectEvent =>
      decodeProjectEvent({
        ...(fixture('event_subagent_ended.json') as Record<string, unknown>),
        ...over,
      });
    const runId = 'run_01JY0000000000000000000001';

    it('reports a start whose end never arrived as unknown once the run settles', () => {
      let state = reduceProjectEvent(initialProjectState(), started({ sequence: '1' }));
      expect(workersForRun(state, runId)[0].status).toBe('running');

      state = reduceProjectEvent(
        state,
        decodeProjectEvent({
          ...(fixture('event_run_completed.json') as Record<string, unknown>),
          sequence: '2',
          run_id: runId,
        })
      );
      const worker = workersForRun(state, runId)[0];
      expect(worker.status).toBe('unknown');
      expect(worker.endedSequence).toBeUndefined();
    });

    it('opens a lane for an end whose start was dropped', () => {
      const state = reduceProjectEvent(initialProjectState(), ended({ sequence: '1' }));
      expect(state.timeline).toHaveLength(1);
      expect(workersForRun(state, runId)[0]).toMatchObject({
        status: 'succeeded',
        reason: 'completed',
        endedSequence: '1',
      });
      expect(workersForRun(state, runId)[0].startedSequence).toBeUndefined();
    });

    it('keeps an unidentified ephemeral worker unpairable rather than borrowing an end', () => {
      let state = reduceProjectEvent(
        initialProjectState(),
        started({ sequence: '1', data: { child_session_id: '', role: 'search', name: 'scout' } })
      );
      state = reduceProjectEvent(
        state,
        ended({
          sequence: '2',
          data: { child_session_id: '', role: 'search', reason: 'completed', error: '' },
        })
      );
      const workers = workersForRun(state, runId);
      expect(workers).toHaveLength(2);
      expect(workers[0]).toMatchObject({ childSessionId: '', status: 'running', name: 'scout' });
      expect(workers[1]).toMatchObject({ childSessionId: '', status: 'succeeded' });
    });

    it('names a worker that ended in error as failed and keeps the message', () => {
      const state = reduceProjectEvent(
        initialProjectState(),
        ended({
          sequence: '1',
          data: {
            child_session_id: 'ses_x',
            role: 'search',
            reason: 'provider_error',
            error: 'upstream refused the request',
          },
        })
      );
      expect(workersForRun(state, runId)[0]).toMatchObject({
        status: 'failed',
        reason: 'provider_error',
        error: 'upstream refused the request',
      });
    });

    it('leaves a single-agent run with no workers at all', () => {
      const state = reduceProjectEvents(initialProjectState(), [
        decodeProjectEvent({
          ...(fixture('event_run_accepted.json') as Record<string, unknown>),
          sequence: '1',
        }),
        decodeProjectEvent({
          ...(fixture('event_text_delta.json') as Record<string, unknown>),
          sequence: '2',
        }),
        decodeProjectEvent({
          ...(fixture('event_run_completed.json') as Record<string, unknown>),
          sequence: '3',
        }),
      ]);
      expect(state.workers).toEqual({});
      expect(workersForRun(state, runId)).toEqual([]);
    });
  });

  // A parked run is the one state that used to be invisible: the stream simply
  // stopped, exactly as it does while a run is thinking. What the reducer owes
  // the surface is the distinction between waiting and stuck, and — because
  // leaving a label writes only the run row and emits nothing — a banner that
  // lifts on its own when the run produces again.
  describe('a run parked on a recovery label', () => {
    const runId = 'run_01JY0000000000000000000001';
    const parked = (over: Record<string, unknown>): ProjectEvent =>
      decodeProjectEvent({
        ...(fixture('event_run_recovery.json') as Record<string, unknown>),
        ...over,
      });
    const other = (name: string, sequence: string): ProjectEvent =>
      decodeProjectEvent({
        ...(fixture(name) as Record<string, unknown>),
        sequence,
        run_id: runId,
      });

    it('keeps the run non-terminal and names the block', () => {
      const state = reduceProjectEvent(initialProjectState(), parked({ sequence: '1' }));
      expect(state.runs[runId]).toMatchObject({
        status: 'running',
        recovery: {
          label: 'blocked_poison_event',
          detail: 'poison outbox record 7: rpc error: code = InvalidArgument',
          blocking: true,
          sequence: '1',
        },
      });
      // Non-terminal: the run still owns the Project's active-run slot, so a
      // surface must not offer to send the next message.
      expect(state.runs[runId].outcomeReason).toBeUndefined();
    });

    it('distinguishes a wait from a block, because only one needs an operator', () => {
      const state = reduceProjectEvent(
        initialProjectState(),
        parked({
          sequence: '1',
          data: {
            label: 'uncertain_provider_dispatch',
            detail: 'dispatch outcome unknown',
            blocking: false,
          },
        })
      );
      expect(state.runs[runId].recovery).toMatchObject({
        label: 'uncertain_provider_dispatch',
        blocking: false,
      });
    });

    it('relabels in place rather than stacking banners', () => {
      let state = reduceProjectEvent(initialProjectState(), parked({ sequence: '1' }));
      state = reduceProjectEvent(
        state,
        parked({
          sequence: '2',
          data: { label: 'pending_usage_reconciliation', detail: 'usage not settled', blocking: false },
        })
      );
      expect(state.runs[runId].recovery).toMatchObject({
        label: 'pending_usage_reconciliation',
        blocking: false,
        sequence: '2',
      });
      expect(state.timeline.filter((entry) => entry.type === 'recovery')).toHaveLength(2);
    });

    it.each([
      ['text_delta', 'event_text_delta.json'],
      ['tool_call', 'event_tool_call.json'],
      ['run_completed', 'event_run_completed.json'],
    ])('clears the park when the run produces %s again', (_kind, name) => {
      let state = reduceProjectEvent(initialProjectState(), parked({ sequence: '1' }));
      expect(state.runs[runId].recovery).toBeDefined();
      state = reduceProjectEvent(state, other(name, '2'));
      expect(state.runs[runId].recovery).toBeUndefined();
      // The history is not rewritten: the run did stall, and the entry says so.
      expect(state.timeline.filter((entry) => entry.type === 'recovery')).toHaveLength(1);
    });

    it('clears the park on a kind this build has never heard of', () => {
      let state = reduceProjectEvent(initialProjectState(), parked({ sequence: '1' }));
      state = reduceProjectEvent(
        state,
        decodeProjectEvent({
          ...(fixture('event_text_delta.json') as Record<string, unknown>),
          sequence: '2',
          run_id: runId,
          kind: 'aion_variant_from_the_future',
          data: {},
        })
      );
      expect(state.runs[runId].recovery).toBeUndefined();
    });

    it('leaves another run alone', () => {
      let state = reduceProjectEvent(initialProjectState(), parked({ sequence: '1' }));
      state = reduceProjectEvent(
        state,
        decodeProjectEvent({
          ...(fixture('event_text_delta.json') as Record<string, unknown>),
          sequence: '2',
          run_id: 'run_01JY0000000000000000000002',
        })
      );
      expect(state.runs[runId].recovery).toBeDefined();
    });
  });

  it('merges consecutive text deltas for the same run', () => {
    const base = fixture('event_text_delta.json') as Record<string, unknown>;
    let state = initialProjectState();
    state = reduceProjectEvent(
      state,
      decodeProjectEvent({ ...base, sequence: '1', data: { text: 'Hello ' } })
    );
    state = reduceProjectEvent(
      state,
      decodeProjectEvent({ ...base, sequence: '2', data: { text: 'world' } })
    );
    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0]).toMatchObject({ type: 'text', text: 'Hello world', sequence: '2' });
  });
});
