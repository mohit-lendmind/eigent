// A run stopped by its spending ceiling must read as a limit, not as a
// breakage — and must not invite the retry that cannot work. Everything else
// keeps the generic wording, including reasons this build has never seen:
// the wire's reason set is open, so an unknown one still has to render.
import { describe, expect, it } from 'vitest';

import { runTerminalMessage } from '@/store/aionChatBridge';

describe('runTerminalMessage', () => {
  it('names a budget-exhausted run and says a retry will not help', () => {
    const msg = runTerminalMessage(
      'failed',
      'REASON_RUN_BUDGET_EXHAUSTED',
      'aioninference: run budget exhausted'
    );
    expect(msg).toContain('budget exhausted');
    expect(msg).toMatch(/same point/);
    // The raw backend string never reaches the user for a named terminal.
    expect(msg).not.toContain('aioninference');
    expect(msg).not.toContain('Run failed');
  });

  it('keeps the generic wording for a provider fault', () => {
    expect(
      runTerminalMessage('failed', 'REASON_PROVIDER_ERROR', 'upstream 529')
    ).toBe('❌ Run failed: upstream 529');
  });

  it('renders an unknown reason rather than swallowing it', () => {
    expect(runTerminalMessage('failed', 'REASON_FROM_THE_FUTURE', undefined)).toBe(
      '❌ Run failed: REASON_FROM_THE_FUTURE'
    );
  });

  it('labels a cancel as a cancel', () => {
    expect(runTerminalMessage('cancelled', 'cancel requested', undefined)).toBe(
      '⏹️ Run cancelled: cancel requested'
    );
  });

  it('falls back to a bare label when the terminal carries nothing', () => {
    expect(runTerminalMessage('failed', undefined, undefined)).toBe(
      '❌ Run failed.'
    );
  });
});
