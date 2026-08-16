// A parked run is the one state where "wait" and "do something" are opposite
// advice and the run looks identical either way, so the blocking flag — not the
// label — is what these tests hold to. The labels themselves come from the
// backend's own vocabulary and this build never enumerates them: an unfamiliar
// one still has to render, because a label this client cannot name is exactly
// when the user most needs to be told the run stopped.
import { describe, expect, it } from 'vitest';

import type { RunRecoveryState } from '@/api/aion/v1/reducer';
import { runRecoveryMessage } from '@/store/aionChatBridge';

function recovery(overrides: Partial<RunRecoveryState> = {}): RunRecoveryState {
  return {
    label: 'uncertain_provider_dispatch',
    blocking: false,
    sequence: '5',
    ...overrides,
  };
}

describe('runRecoveryMessage', () => {
  it('tells a waiting run to wait', () => {
    const msg = runRecoveryMessage(recovery());
    expect(msg).toContain('uncertain_provider_dispatch');
    expect(msg).toContain('resume on its own');
    expect(msg).toContain('no action needed');
    // The advice for a blocked run must not leak onto one that settles itself.
    expect(msg).not.toContain('operator');
  });

  it('tells a blocked run that waiting will not clear it', () => {
    const msg = runRecoveryMessage(
      recovery({ label: 'blocked_poison_event', blocking: true })
    );
    expect(msg).toContain('blocked_poison_event');
    expect(msg).toContain('will not continue on its own');
    expect(msg).toContain('operator');
    expect(msg).not.toContain('no action needed');
  });

  it('says the composer is closed on both sides of the split', () => {
    // A parked run still holds the Project's active-run slot either way, so a
    // next message is refused either way. Only the blocking side offers the
    // cancel, because on the other side the run is expected to resume.
    expect(
      runRecoveryMessage(recovery({ blocking: true }))
    ).toContain('Cancel the run');
    expect(runRecoveryMessage(recovery())).not.toContain('Cancel the run');
  });

  it('carries the backend detail through when there is one', () => {
    const msg = runRecoveryMessage(
      recovery({
        label: 'blocked_poison_event',
        blocking: true,
        detail: 'poison outbox record 7: rpc error: code = InvalidArgument',
      })
    );
    expect(msg).toContain('poison outbox record 7');
  });

  it('reads without a dangling separator when the detail is absent', () => {
    // The detail is optional on the wire, and an empty string is what a
    // backend that has no cause to give sends — neither may render as a label
    // trailed by a bare separator.
    expect(runRecoveryMessage(recovery())).toContain(
      'uncertain_provider_dispatch.'
    );
    expect(runRecoveryMessage(recovery({ detail: '' }))).toContain(
      'uncertain_provider_dispatch.'
    );
  });

  it('names a label this build has never seen rather than swallowing it', () => {
    // The recovery vocabulary is the backend's and grows without a contract
    // bump; an unknown label still has to reach the user.
    expect(runRecoveryMessage(recovery({ label: 'awaiting_the_unknown' }))).toContain(
      'awaiting_the_unknown'
    );
  });
});
