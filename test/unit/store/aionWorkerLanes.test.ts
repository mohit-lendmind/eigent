// A run's fan-out reaches the work log as one card per worker. The three ways
// a worker arrives degraded — an ephemeral spawn with no identity, an end with
// no start, a start whose end never came — are each meant to read as what they
// are, so the lane's own line is what these tests hold to.
import { describe, expect, it } from 'vitest';

import type { WorkerState } from '@/api/aion/v1/reducer';
import { projectWorkerLanes } from '@/store/aionChatBridge';
import { AgentStatusValue, AgentStep } from '@/types/constants';

function worker(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    workerKey: 'ses_child_01',
    runId: 'run_01',
    childSessionId: 'ses_child_01',
    role: 'researcher',
    name: 'Researcher',
    status: 'running',
    startedSequence: '7',
    ...overrides,
  };
}

const lines = (lane: Agent): Array<string | undefined> =>
  lane.log.map((entry) => entry.data.message ?? entry.data.notice);

describe('projectWorkerLanes', () => {
  it('renders a run that did not fan out as no lanes at all', () => {
    // The negative control the workforce eval asserts through the DOM: absent
    // workers must not produce a lane, or the UI would always draw fan-out.
    expect(projectWorkerLanes('task-1', 'run_01', [])).toEqual([]);
  });

  it('gives each lane its own identity, keyed within the turn', () => {
    const lanes = projectWorkerLanes('task-1', 'run_01', [
      worker(),
      worker({ workerKey: 'ses_child_02', name: 'Writer', role: 'writer' }),
    ]);
    expect(lanes.map((lane) => lane.agent_id)).toEqual([
      'task-1-worker-ses_child_01',
      'task-1-worker-ses_child_02',
    ]);
    expect(lanes.map((lane) => lane.name)).toEqual(['Researcher', 'Writer']);
    // Every lane carries the same type; they are told apart by name, so the
    // group header never falls back to the orchestrator's live label.
    expect(lanes.every((lane) => lane.type === 'worker_agent')).toBe(true);
    // Only the orchestrator's tool calls project onto a Project, so a lane
    // never claims a task list of its own.
    expect(lanes.every((lane) => lane.tasks.length === 0)).toBe(true);
  });

  it('falls back to the role, then to a generic label, when unnamed', () => {
    expect(
      projectWorkerLanes('t', 'run_01', [worker({ name: undefined })])[0].name
    ).toBe('researcher');
    expect(
      projectWorkerLanes('t', 'run_01', [
        worker({ name: undefined, role: undefined }),
      ])[0].name
    ).toBe('Worker');
  });

  it('leaves a running worker open, with no outcome claimed', () => {
    const [lane] = projectWorkerLanes('t', 'run_01', [worker()]);
    expect(lane.status).toBe(AgentStatusValue.RUNNING);
    expect(lane.log).toHaveLength(1);
    expect(lane.log[0].step).toBe(AgentStep.ACTIVATE_AGENT);
    expect(lane.log[0].data.message).toBe('Joined the run as researcher.');
  });

  it('closes a finished worker with the reason the child reported', () => {
    const [lane] = projectWorkerLanes('t', 'run_01', [
      worker({ status: 'succeeded', reason: 'completed', endedSequence: '9' }),
    ]);
    expect(lane.status).toBe(AgentStatusValue.COMPLETED);
    expect(lane.log.map((entry) => entry.step)).toEqual([
      AgentStep.ACTIVATE_AGENT,
      AgentStep.NOTICE,
      AgentStep.DEACTIVATE_AGENT,
    ]);
    expect(lane.log[1].data.notice).toBe('Finished: completed.');
  });

  it('keeps a failed worker error text verbatim', () => {
    const [lane] = projectWorkerLanes('t', 'run_01', [
      worker({ status: 'failed', error: 'tool budget exhausted' }),
    ]);
    expect(lane.status).toBe(AgentStatusValue.FAILED);
    expect(lane.log[1].data.notice).toBe('Failed: tool budget exhausted.');
  });

  it('still names a failure that arrived without any detail', () => {
    const [lane] = projectWorkerLanes('t', 'run_01', [
      worker({ status: 'failed' }),
    ]);
    expect(lane.log[1].data.notice).toBe('Failed: no detail reported.');
  });

  it('fails closed on an unresolved worker rather than implying success', () => {
    // `unknown` has no counterpart in the closed status set, and both readers
    // of the field only ask whether the lane is still working. Claiming
    // COMPLETED here would report an outcome nobody sent.
    const [lane] = projectWorkerLanes('t', 'run_01', [
      worker({ status: 'unknown' }),
    ]);
    expect(lane.status).toBe(AgentStatusValue.FAILED);
    expect(lane.log[1].data.notice).toBe(
      'The run ended before this worker reported an outcome.'
    );
  });

  it('distinguishes an ephemeral spawn from an end that never arrived', () => {
    // No child session id means the worker was never persisted, so there is no
    // identity for an end to be matched against — a different statement from a
    // worker whose end was simply lost.
    const [lane] = projectWorkerLanes('t', 'run_01', [
      worker({ status: 'unknown', childSessionId: '', workerKey: '7' }),
    ]);
    expect(lane.log[1].data.notice).toBe(
      'This worker was not persisted, so no outcome could be matched to it.'
    );
  });

  it('says so when only the end of a worker was delivered', () => {
    const [lane] = projectWorkerLanes('t', 'run_01', [
      worker({
        status: 'succeeded',
        reason: 'completed',
        startedSequence: undefined,
        endedSequence: '9',
      }),
    ]);
    expect(lines(lane)[0]).toBe(
      'Only the end of this worker was delivered; its start never arrived.'
    );
    // The outcome is still reported: half a pair is not a reason to drop it.
    expect(lines(lane)[1]).toBe('Finished: completed.');
  });

  it('addresses every lane log entry to the run that spawned it', () => {
    const [lane] = projectWorkerLanes('t', 'run_02', [
      worker({ status: 'succeeded', reason: 'completed' }),
    ]);
    expect(
      lane.log.every((entry) => entry.data.process_task_id === 'run_02')
    ).toBe(true);
  });
});
