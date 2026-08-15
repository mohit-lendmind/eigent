// A run that delegates has to present itself as a workforce, and the Project's
// stored mode — stamped before anything about the run is known — must not be
// what pins it to single-agent forever.
import {
  inferSessionModeFromTask,
  resolveSessionMode,
} from '@/lib/sessionMode';
import { SessionMode } from '@/types/constants';
import { describe, expect, it } from 'vitest';

const orchestrator = { type: 'single_agent' };
const worker = { type: 'worker_agent' };

describe('inferSessionModeFromTask', () => {
  it('reads a run with no fan-out as single agent', () => {
    expect(inferSessionModeFromTask({ taskAssigning: [orchestrator] })).toBe(
      SessionMode.SINGLE_AGENT
    );
  });

  it('reads a run that staffed workers as a workforce', () => {
    // The orchestrator's own card is always there, so a fan-out carries both
    // kinds. Reading the single-agent card first is what used to leave every
    // delegating run labelled — and panelled — as one agent.
    expect(
      inferSessionModeFromTask({ taskAssigning: [orchestrator, worker] })
    ).toBe(SessionMode.WORKFORCE);
  });

  it('prefers a mode the task states outright when nothing delegated', () => {
    expect(
      inferSessionModeFromTask({
        sessionMode: SessionMode.SINGLE_AGENT,
        taskAssigning: [orchestrator],
      })
    ).toBe(SessionMode.SINGLE_AGENT);
  });

  it('overrides a stated single-agent mode once workers are on the run', () => {
    // The stated mode is stamped at submit time from the Project's mode, before
    // the run has done anything — so on its own it would keep every delegating
    // session labelled, and panelled, as one agent.
    expect(
      inferSessionModeFromTask({
        sessionMode: SessionMode.SINGLE_AGENT,
        taskAssigning: [orchestrator, worker],
      })
    ).toBe(SessionMode.WORKFORCE);
  });

  it('leaves a stated workforce session alone', () => {
    expect(
      inferSessionModeFromTask({
        sessionMode: SessionMode.WORKFORCE,
        taskAssigning: [orchestrator],
      })
    ).toBe(SessionMode.WORKFORCE);
  });

  it('returns the fallback while nothing is known yet', () => {
    expect(inferSessionModeFromTask({ taskAssigning: [] }, null)).toBeNull();
  });
});

describe('resolveSessionMode', () => {
  it('upgrades a Project stamped single-agent once a run delegates', () => {
    expect(
      resolveSessionMode(SessionMode.SINGLE_AGENT, SessionMode.WORKFORCE)
    ).toBe(SessionMode.WORKFORCE);
  });

  it('never downgrades a Project created as a workforce', () => {
    expect(
      resolveSessionMode(SessionMode.WORKFORCE, SessionMode.SINGLE_AGENT)
    ).toBe(SessionMode.WORKFORCE);
  });

  it('keeps the stored mode when the turn says nothing', () => {
    expect(resolveSessionMode(SessionMode.SINGLE_AGENT, null)).toBe(
      SessionMode.SINGLE_AGENT
    );
  });

  it('falls back to the turn when the Project has no stamp', () => {
    expect(resolveSessionMode(undefined, SessionMode.SINGLE_AGENT)).toBe(
      SessionMode.SINGLE_AGENT
    );
  });

  it('stays undetermined when neither side knows', () => {
    // The side panel renders empty rather than flashing the wrong mode.
    expect(resolveSessionMode(undefined, null)).toBeNull();
  });
});
